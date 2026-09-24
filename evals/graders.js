// Rule graders for the sort contract. All deterministic, no labels, no
// model: each one checks a rule the prompt states, so the eval measures
// whether the prompt's rules hold, per level, with and without the anxious
// switch, per contract, before anyone tunes them.

import { BUCKETS, LATER_TAGS, CAPS, BANNED_PHRASES, STRATEGIES } from '../worker/contracts.js';
import { parseJson } from '../worker/parse.js';

/** valid_json: native, recovered, or failed. */
export function validJson(text, stopReason) {
  return parseJson(text, { stopReason });
}

const isStr = (x) => typeof x === 'string';
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** schema_valid: the shape the client renders from, with no extra keys. */
export function schemaValid(plan) {
  const problems = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return ['not an object'];
  for (const k of Object.keys(plan)) if (!BUCKETS.includes(k)) problems.push(`extra key ${k}`);
  if (!Array.isArray(plan.now)) problems.push('now not an array');
  else for (const t of plan.now) {
    if (!t || typeof t !== 'object') { problems.push('now item shape'); continue; }
    for (const k of Object.keys(t)) if (!['label', 'detail', 'why', 'strategy'].includes(k)) problems.push(`now item extra key ${k}`);
    for (const k of ['label', 'detail', 'why', 'strategy']) if (!isStr(t[k])) problems.push(`now item ${k} not a string`);
  }
  if (!Array.isArray(plan.later)) problems.push('later not an array');
  else for (const t of plan.later) {
    if (!t || !isStr(t.text)) problems.push('later item shape');
    else if (!LATER_TAGS.includes(t.tag)) problems.push(`later tag ${t.tag}`);
  }
  if (!Array.isArray(plan.let_go) || plan.let_go.some((x) => !isStr(x))) problems.push('let_go not a list of strings');
  return problems;
}

/** cap_respected: now within the level's cap. */
export function capRespected(plan, level) {
  const n = plan.now?.length ?? 0;
  return n > CAPS[level] ? [`now ${n} > ${CAPS[level]}`] : [];
}

/**
 * banned_phrasing: the list from the prompt constants, with "should" and
 * "need to" only when anxious. `why` is left out on purpose: it quotes the
 * person's own words back to them, and the page shows it as a quote.
 */
export function bannedPhrasing(plan, anxious = false) {
  const texts = [
    ...(plan.now ?? []).flatMap((t) => [t?.label, t?.detail]),
    ...(plan.later ?? []).map((t) => t?.text),
    ...(plan.let_go ?? []),
  ].filter(isStr).join('\n').toLowerCase();
  const banned = [...BANNED_PHRASES.all, ...(anxious ? BANNED_PHRASES.anxious : [])];
  return banned.filter((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(texts));
}

/**
 * routing_consistent: now is never empty, and a dump the fixture marks as
 * mental load gets one gentle item in now, whatever the level.
 */
export function routingConsistent(plan, level, fixture = {}) {
  const problems = [];
  const n = plan.now?.length ?? 0;
  if (!n) problems.push('now is empty');
  if (fixture.expect_output_type === 'mental_load' && n > 1) problems.push(`mental load returned ${n} now items, expected 1`);
  return problems;
}

/** let_go_unique: nothing in let_go also sits in now or later. */
export function letGoUnique(plan) {
  const letGo = (plan.let_go ?? []).map(norm).filter(Boolean);
  const hit = (s) => { const n = norm(s); return n && letGo.some((l) => l === n || l.startsWith(n + ' ') || n.startsWith(l + ' ')); };
  return [...(plan.now ?? []).map((t) => t?.label), ...(plan.later ?? []).map((t) => t?.text)].filter((s) => isStr(s) && hit(s));
}

/** strategy_named: each now strategy comes from the list the prompt gives. */
export function strategyNamed(plan) {
  return (plan.now ?? []).map((t) => t?.strategy).filter((s) => !STRATEGIES.includes(s));
}

/** why_given: each now item says why, so "+ why this one" is never empty. */
export function whyGiven(plan) {
  return (plan.now ?? []).filter((t) => !isStr(t?.why) || !t.why.trim()).map((t) => t?.label ?? '?');
}

/**
 * carried_placed: every carry-over the person kept is somewhere in the plan.
 * A loose match, since the sorter may reword it: every word of four or more
 * letters from the carried item appears in one placed item.
 */
export function carriedPlaced(plan, carried = []) {
  const placed = flatItems(plan).map(norm);
  return carried.filter((c) => {
    const words = norm(c).split(' ').filter((w) => w.length >= 4);
    return !placed.some((p) => (words.length ? words.every((w) => p.includes(w)) : p.includes(norm(c))));
  });
}

/** emergency_one_thing: exactly the two strings, both short, one sentence each. */
export function emergencyOneThing(out) {
  const problems = [];
  if (!out || typeof out !== 'object') return ['not an object'];
  for (const k of Object.keys(out)) if (!['one_thing', 'why'].includes(k)) problems.push(`extra key ${k}`);
  if (typeof out.one_thing !== 'string' || !out.one_thing.trim()) problems.push('one_thing missing');
  if (typeof out.why !== 'string' || !out.why.trim()) problems.push('why missing');
  if (typeof out.one_thing === 'string' && out.one_thing.split(/[.!?]\s+/).filter(Boolean).length > 2) problems.push('one_thing is more than one action');
  return problems;
}

/** Every item in a plan as text: now labels, later texts, let_go statements. */
export function flatItems(plan) {
  return [
    ...(plan?.now ?? []).map((t) => t?.label),
    ...(plan?.later ?? []).map((t) => t?.text),
    ...(plan?.let_go ?? []),
  ].filter(isStr);
}

/**
 * revision_preserves: after a follow-up, every item the user did not
 * mention is still somewhere in the plan. `mentioned` is the fixture's list
 * of items the follow-up talks about; everything else in the previous plan
 * has to survive, in any bucket.
 */
export function revisionPreserves(previous, revised, mentioned = []) {
  const before = flatItems(previous);
  const after = new Set(flatItems(revised).map((s) => s.toLowerCase()));
  return before.filter((item) => !mentioned.some((m) => item.toLowerCase().includes(m.toLowerCase())) && !after.has(item.toLowerCase()));
}

/** Grade one sort output end to end. */
export function gradeSort({ text, stopReason, level, anxious = false, fixture = {} }) {
  const parsed = validJson(text, stopReason);
  if (!parsed.ok) return { parse: parsed.path, valid_json: false, hard_fail: true, violations: { parse: [parsed.error] } };
  const plan = parsed.value;
  const schema = schemaValid(plan);
  // A plan with the wrong shape fails schema and nothing else can be read from it.
  if (schema.length && (!Array.isArray(plan.now) || !Array.isArray(plan.later) || !Array.isArray(plan.let_go))) {
    return { parse: parsed.path, valid_json: true, plan, violations: { schema_valid: schema }, hard_fail: false, any: true };
  }
  const violations = {
    schema_valid: schema,
    cap_respected: capRespected(plan, level),
    banned_phrasing: bannedPhrasing(plan, anxious),
    routing_consistent: routingConsistent(plan, level, fixture),
    let_go_unique: letGoUnique(plan),
    strategy_named: strategyNamed(plan),
    why_given: whyGiven(plan),
    carried_placed: carriedPlaced(plan, fixture.carried ?? []),
  };
  return { parse: parsed.path, valid_json: true, plan, violations, hard_fail: false, any: Object.values(violations).some((v) => v.length) };
}
