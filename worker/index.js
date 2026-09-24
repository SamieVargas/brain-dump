// The Brain Dump worker.
//
// v1 proxied whatever system prompt the page sent. v2 owns the prompts: the
// client posts a mode, an energy level, the anxious switch, the dump, any kept
// carry-overs and an optional history, and nothing else gets through. That is what makes the key safe to leave on a
// public endpoint, together with the rate limit, the size caps, the daily
// budget and the session token below.
//
//   GET  /session          a signed, time-limited token the page attaches to every POST
//   POST /sort             { mode: "sort"|"emergency", energy_state, anxious?, dump, carried?, history?, stream? }
//   GET  /health           model, contract, budget
//
// Logs carry mode, level, the anxious switch, sizes, model, usage and
// timings. Never the dump, never the carried items, never the plan, never the
// history.

import { MODEL, MAX_TOKENS, MODES, ENERGY_LEVELS, CONTRACTS, HISTORY_TURN_CAP, DUMP_MAX_CHARS, FOLLOW_UP_MAX_CHARS, CARRIED_MAX_ITEMS, CARRIED_MAX_CHARS, sortSchema, emergencySchema } from './contracts.js';
import { buildSystem, dumpWithCarried, PROMPT_VERSION } from './prompts.js';
import { parseJson } from './parse.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

// ── the doors ───────────────────────────────────────────────────────────────

export const RATE = { max: 20, windowMs: 60_000 }; // per IP; matches the binding's one-minute period
const buckets = new Map(); // in-memory fallback; the RATE_LIMITER binding is the real one

async function rateLimited(env, key, now) {
  if (env.RATE_LIMITER?.limit) {
    const { success } = await env.RATE_LIMITER.limit({ key });
    return !success;
  }
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + RATE.windowMs });
    return false;
  }
  b.count += 1;
  return b.count > RATE.max;
}

// Daily token budget, per isolate (a KV counter is the version that holds
// across isolates; the README says so). Exhausted means "resting until
// tomorrow", never a stack trace.
const budget = { day: null, used: 0 };
function roll(now) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (budget.day !== day) Object.assign(budget, { day, used: 0 });
}
function spend(usage, now) {
  roll(now);
  budget.used += (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
}
function budgetState(env, now) {
  roll(now);
  const limit = Number(env.DAILY_TOKEN_BUDGET) > 0 ? Number(env.DAILY_TOKEN_BUDGET) : null;
  return { limit, used: budget.used, exhausted: limit !== null && budget.used >= limit };
}
/** Tests only: forget the in-memory counters. */
export function resetCounters() {
  buckets.clear();
  Object.assign(budget, { day: null, used: 0 });
}

// Session tokens: HMAC over an issue time, no server state. A scripted
// caller without one is refused; one that fetches /session first is still
// held to the rate limit and the budget.
export const SESSION_TTL_MS = 12 * 60 * 60_000;
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function issueSession(secret, now) {
  const issued = String(now);
  return `${issued}.${await hmac(secret, issued)}`;
}
export async function verifySession(secret, token, now) {
  if (!token || typeof token !== 'string') return false;
  const [issued, sig] = token.split('.');
  if (!/^\d+$/.test(issued ?? '') || !sig) return false;
  if (now - Number(issued) > SESSION_TTL_MS || Number(issued) > now + 60_000) return false;
  return (await hmac(secret, issued)) === sig;
}

// ── validation ──────────────────────────────────────────────────────────────

const ALLOWED_FIELDS = new Set(['mode', 'energy_state', 'anxious', 'dump', 'carried', 'history', 'stream', 'contract']);

/** @returns {string|null} the first problem, or null when the body is clean */
export function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object';
  for (const k of Object.keys(body)) if (!ALLOWED_FIELDS.has(k)) return `unknown field "${k}"`;
  if (!MODES.includes(body.mode)) return `mode must be one of ${MODES.join(', ')}`;
  if (body.mode === 'sort' && !ENERGY_LEVELS.includes(body.energy_state)) return `energy_state must be one of ${ENERGY_LEVELS.join(', ')}`;
  if (body.anxious !== undefined && typeof body.anxious !== 'boolean') return 'anxious must be a boolean';
  if (typeof body.dump !== 'string' || !body.dump.trim()) return 'dump is required';
  if (body.dump.length > DUMP_MAX_CHARS) return `dump is over ${DUMP_MAX_CHARS} characters`;
  if (body.carried !== undefined) {
    if (body.mode !== 'sort') return 'carried is only for a sort';
    if (!Array.isArray(body.carried)) return 'carried must be an array';
    if (body.carried.length > CARRIED_MAX_ITEMS) return `carried is over ${CARRIED_MAX_ITEMS} items`;
    for (const c of body.carried) {
      if (typeof c !== 'string' || !c.trim()) return 'carried items must be non-empty strings';
      if (c.length > CARRIED_MAX_CHARS) return `a carried item is over ${CARRIED_MAX_CHARS} characters`;
    }
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') return 'stream must be a boolean';
  if (body.contract !== undefined && !CONTRACTS.includes(body.contract)) return `contract must be one of ${CONTRACTS.join(', ')}`;
  if (body.history !== undefined) {
    if (!Array.isArray(body.history)) return 'history must be an array';
    if (body.history.length > HISTORY_TURN_CAP + 2) return `history is over ${HISTORY_TURN_CAP + 2} turns`;
    for (const t of body.history) {
      if (!t || typeof t !== 'object') return 'history turns must be objects';
      if (!['user', 'assistant'].includes(t.role)) return 'history roles must be user or assistant';
      if (typeof t.content !== 'string') return 'history content must be a string';
      if (t.content.length > Math.max(DUMP_MAX_CHARS, FOLLOW_UP_MAX_CHARS * 8)) return 'a history turn is too long';
    }
  }
  return null;
}

/**
 * The messages for a call. A first plan is one user turn. A follow-up is the
 * history (original dump, plans as assistant turns, follow-ups as user turns)
 * capped to the last HISTORY_TURN_CAP turns with the latest plan always kept,
 * then the new follow-up as the last user turn.
 */
export function buildMessages(body) {
  if (!body.history?.length) return [{ role: 'user', content: dumpWithCarried(body.dump, body.carried) }];
  const turns = body.history.slice();
  let capped = turns.slice(-HISTORY_TURN_CAP);
  const lastPlan = [...turns].reverse().find((t) => t.role === 'assistant');
  if (lastPlan && !capped.includes(lastPlan)) {
    // The plan fell outside the window: carry it forward with the user turn
    // that produced it, then fill the rest of the window from the tail.
    const i = turns.indexOf(lastPlan);
    const lead = turns[i - 1]?.role === 'user' ? [turns[i - 1], lastPlan] : [lastPlan];
    capped = [...lead, ...turns.slice(-(HISTORY_TURN_CAP - lead.length))];
  }
  while (capped.length && capped[0].role !== 'user') capped.shift();
  return [...capped, { role: 'user', content: body.dump }];
}

// ── the call ────────────────────────────────────────────────────────────────

/** The exact body sent upstream. Exported so the tests can see both shapes. */
export function requestBody(body, { contract, stream }) {
  const followUp = !!body.history?.length;
  const system = buildSystem(body.mode, body.energy_state, { anxious: body.anxious === true, followUp });
  const req = { model: MODEL, max_tokens: MAX_TOKENS, system, messages: buildMessages(body), stream };
  if (contract === 'native') {
    req.output_config = { format: { type: 'json_schema', schema: body.mode === 'emergency' ? emergencySchema() : sortSchema() } };
  }
  return req;
}

function log(event, fields) {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...fields }));
}

export const RESTING = { error: 'resting until tomorrow', message: "the sorter has done its day's work. it will be back tomorrow; for tonight, pick the smallest thing and open it." };

function cors(env, request) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0] ?? '';
  return {
    'access-control-allow-origin': ok,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-bd-session',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/**
 * The request handler. `fetchImpl` and `now` are injectable so the tests and
 * the load test run it in Node with no network and no clock.
 */
export async function handle(request, env, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const headers = cors(env, request);
  const url = new URL(request.url);
  const t0 = now();

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ ok: true, model: MODEL, prompt_version: PROMPT_VERSION, contract: env.CONTRACT ?? 'native', budget: budgetState(env, t0) }, 200, headers);
  }
  if (request.method === 'GET' && url.pathname === '/session') {
    if (!env.SESSION_SECRET) return json({ error: 'sessions are not configured on this worker' }, 501, headers);
    return json({ token: await issueSession(env.SESSION_SECRET, t0), ttl_ms: SESSION_TTL_MS }, 200, headers);
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, headers);

  if (env.SESSION_SECRET && !(await verifySession(env.SESSION_SECRET, request.headers.get('x-bd-session'), t0))) {
    return json({ error: 'no session', message: 'open the page and try again.' }, 401, headers);
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'anonymous';
  if (await rateLimited(env, ip, t0)) {
    log('refused', { reason: 'rate', ip_hash: (await hmac(env.SESSION_SECRET ?? 'log', ip)).slice(0, 8) });
    return json({ error: 'rate limited', message: "you're moving faster than the sorter can. give it a minute." }, 429, { ...headers, 'retry-after': '60' });
  }

  const b = budgetState(env, t0);
  if (b.exhausted) {
    log('refused', { reason: 'budget', used: b.used, limit: b.limit });
    return json(RESTING, 503, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400, headers);
  }
  const problem = validateBody(body);
  if (problem) return json({ error: problem }, 400, headers);

  const contract = body.contract ?? (CONTRACTS.includes(env.CONTRACT) ? env.CONTRACT : 'native');
  const stream = body.stream === true;
  const req = requestBody(body, { contract, stream });
  const meta = { mode: body.mode, energy_state: body.energy_state ?? null, anxious: body.anxious === true, dump_chars: body.dump.length, carried_items: body.carried?.length ?? 0, history_turns: body.history?.length ?? 0, contract, stream, model: MODEL, prompt_version: PROMPT_VERSION };

  let upstream;
  try {
    upstream = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION },
      body: JSON.stringify(req),
    });
  } catch (err) {
    log('upstream_error', { ...meta, error: String(err.message ?? err).slice(0, 120) });
    return json({ error: 'the sorter is unreachable', message: "couldn't reach the sorter. check your connection and try again." }, 502, headers);
  }
  if (!upstream.ok) {
    log('upstream_status', { ...meta, status: upstream.status });
    return json({ error: `upstream ${upstream.status}`, message: 'the sorter had a bad moment. try again in a little while.' }, 502, headers);
  }

  if (stream) {
    // Proxy the server-sent events as they arrive, and append one event of
    // our own at the end with the usage and the parse path, so the client
    // can render on message_stop and the log line has its numbers.
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let text = '';
    let usage = null;
    let stopReason = null;
    let carry = '';
    const out = new ReadableStream({
      async pull(controller) {
        const { value, done } = await reader.read();
        if (done) {
          const parsed = parseJson(text, { stopReason });
          const finalMeta = { ...meta, usage, stop_reason: stopReason, parse_path: parsed.path, ms: now() - t0 };
          spend(usage, t0);
          log('call', finalMeta);
          controller.enqueue(encoder.encode(`event: bd_meta\ndata: ${JSON.stringify(finalMeta)}\n\n`));
          controller.close();
          return;
        }
        controller.enqueue(value);
        carry += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = carry.indexOf('\n\n')) >= 0) {
          const chunk = carry.slice(0, idx);
          carry = carry.slice(idx + 2);
          const data = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!data) continue;
          try {
            const ev = JSON.parse(data.slice(6));
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text;
            if (ev.type === 'message_start' && ev.message?.usage) usage = { ...ev.message.usage };
            if (ev.type === 'message_delta') {
              if (ev.usage) usage = { ...(usage ?? {}), ...ev.usage };
              if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
            }
          } catch {
            // a partial or non-JSON line; the client sees it as the API sent it
          }
        }
      },
      cancel() {
        reader.cancel();
      },
    });
    return new Response(out, { status: 200, headers: { ...headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
  }

  const data = await upstream.json();
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const parsed = parseJson(text, { stopReason: data.stop_reason });
  spend(data.usage, t0);
  log('call', { ...meta, usage: data.usage ?? null, stop_reason: data.stop_reason ?? null, parse_path: parsed.path, ms: now() - t0 });
  if (!parsed.ok) return json({ error: parsed.error, parse_path: parsed.path }, 502, headers);
  return json({ plan: parsed.value, meta: { contract, parse_path: parsed.path, usage: data.usage ?? null, model: MODEL, prompt_version: PROMPT_VERSION, stop_reason: data.stop_reason ?? null } }, 200, headers);
}

export default { fetch: (request, env) => handle(request, env) };
