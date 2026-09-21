#!/usr/bin/env node
// The public-door numbers: how many requests the worker refuses under a
// burst, and where the daily budget stops the spend. Runs the handler in
// Node with a stub upstream, so it costs nothing and needs no key; the same
// code paths run on Cloudflare.
//
//   node scripts/load-test.mjs [--requests=200] [--ips=5] [--budget=50000]

import { handle, resetCounters, RATE } from '../worker/index.js';

const arg = (k, d) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const REQUESTS = arg('requests', 200);
const IPS = arg('ips', 5);
const BUDGET = arg('budget', 50_000);
const TOKENS_PER_CALL = 1900; // a cached sort: ~1800 cached input + ~100 new + output

const upstream = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"one_thing":"x","why":"y"}' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: TOKENS_PER_CALL - 140 } }) });
const env = { ANTHROPIC_API_KEY: 'k', ALLOWED_ORIGINS: '*', CONTRACT: 'native', DAILY_TOKEN_BUDGET: String(BUDGET), SESSION_SECRET: 'load' };
const quiet = console.log;
console.log = () => {};

resetCounters();
const tally = { ok: 0, no_session: 0, rate_limited: 0, resting: 0, other: 0 };
const now = Date.now();
const session = await (await handle(new Request('https://w.test/session'), env, { now: () => now })).json();

// A scripted caller with no session first.
const bare = await handle(new Request('https://w.test/sort', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '0.0.0.1' }, body: JSON.stringify({ mode: 'emergency', dump: 'x' }) }), env, { fetchImpl: upstream, now: () => now });
if (bare.status === 401) tally.no_session += 1;

for (let i = 0; i < REQUESTS; i++) {
  const ip = `10.0.0.${i % IPS}`;
  const res = await handle(
    new Request('https://w.test/sort', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'x-bd-session': session.token }, body: JSON.stringify({ mode: 'emergency', dump: 'x' }) }),
    env,
    { fetchImpl: upstream, now: () => now }
  );
  if (res.status === 200) tally.ok += 1;
  else if (res.status === 429) tally.rate_limited += 1;
  else if (res.status === 503) tally.resting += 1;
  else tally.other += 1;
}
console.log = quiet;

const spent = tally.ok * TOKENS_PER_CALL;
console.log(`# Load test — ${REQUESTS} requests from ${IPS} addresses in one burst, budget ${BUDGET} tokens\n`);
console.log('| Outcome | Count |');
console.log('| --- | --- |');
console.log(`| Served | ${tally.ok} |`);
console.log(`| Refused, no session token | ${tally.no_session} (the scripted caller) |`);
console.log(`| Refused, rate limit (${RATE.max} per ${RATE.windowMs / 60000} min per address) | ${tally.rate_limited} |`);
console.log(`| Refused, daily budget (resting until tomorrow) | ${tally.resting} |`);
console.log(`| Spend capped at | ${spent} tokens (${Math.round((spent / BUDGET) * 100)}% of the budget) |`);
console.log(`\nWithout the doors, ${REQUESTS} requests would have spent about ${REQUESTS * TOKENS_PER_CALL} tokens.`);
