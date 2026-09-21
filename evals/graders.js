// Rule graders for the sort contract. All deterministic, no labels, no
// model: each one checks a rule the prompt states, so the eval measures
// whether the prompt's rules hold, per state, per contract, before anyone
// tunes them.

import { BUCKETS, OUTPUT_TYPES, CAPS, BANNED_PHRASES, STRATEGIES } from '../worker/contracts.js';
import { parseJson } from '../worker/parse.js';

/** valid_json: native, recovered, or failed. */
export function validJson(text, stopReason) {
  return parseJson(text, { stopReason });
}

/** schema_valid: the shape the client renders from, with no extra keys. */
export function schemaValid(plan) {
  const problems = [];
  if (!plan || typeof plan !== 'object') return ['not an object'];
  const allowed = new Set(['output_type', 'focus_subtitle', 'cta_text', 'buckets', 'focus', 'gentle_anchor', 'gentle_note']);
  for (const k of Object.keys(plan)) if (!allowed.has(k)) problems.push(`extra key ${k}`);
  if (!OUTPUT_TYPES.includes(plan.output_type)) problems.push(`output_type ${plan.output_type}`);
  for (const k of ['focus_subtitle', 'cta_text', 'gentle_anchor', 'gentle_note']) if (typeof plan[k] !== 'string') problems.push(`${k} not a string`);
  if (!plan.buckets || typeof plan.buckets !== 'object') problems.push('buckets missing');
  else for (const b of BUCKETS) if (!Array.isArray(plan.buckets[b]) || plan.buckets[b].some((x) => typeof x !== 'string')) problems.push(`bucket ${b}`);
  if (!Array.isArray(plan.focus)) problems.push('focus not an array');
  else for (const f of plan.focus) if (!f || typeof f.task !== 'string' || typeof f.strategy !== 'string') problems.push('focus item shape');
  return problems;
}

/** cap_respected: do_it and focus within the state's caps. */
export function capRespected(plan, state) {
  const cap = CAPS[state];
  const problems = [];
  if ((plan.buckets?.do_it?.length ?? 0) > cap.do_it) problems.push(`do_it ${plan.buckets.do_it.length} > ${cap.do_it}`);
  if (plan.output_type === 'task_heavy' && (plan.focus?.length ?? 0) > cap.focus) problems.push(`focus ${plan.focus.length} > ${cap.focus}`);
  return problems;
}

/** banned_phrasing: the list from the prompt constants, per state. */
export function bannedPhrasing(plan, state) {
  const texts = [...(plan.focus ?? []).map((f) => f.task), plan.gentle_note ?? '', plan.gentle_anchor ?? '', ...BUCKETS.flatMap((b) => plan.buckets?.[b] ?? [])].join('\n').toLowerCase();
  const banned = [...BANNED_PHRASES.all, ...(state === 'anxious' ? BANNED_PHRASES.anxious : [])];
  return banned.filter((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(texts));
}

/**
 * routing_consistent: foggy and low energy return one anchor-shaped focus
 * (a single item, or the mental-load shape); a dump the fixture marks as
 * task-heavy returns the list shape.
 */
export function routingConsistent(plan, state, fixture) {
  const problems = [];
  if (fixture.expect_output_type && plan.output_type !== fixture.expect_output_type) problems.push(`output_type ${plan.output_type}, expected ${fixture.expect_output_type}`);
  if (['foggy', 'low energy'].includes(state) && plan.output_type === 'task_heavy' && (plan.focus?.length ?? 0) > CAPS[state].focus) problems.push(`${state} returned ${plan.focus.length} focus items`);
  if (plan.output_type === 'mental_load' && !plan.gentle_anchor) problems.push('mental_load with no anchor');
  return problems;
}

/** strategy_named: each focus strategy comes from the list the prompt gives. */
export function strategyNamed(plan) {
  return (plan.focus ?? []).map((f) => f.strategy).filter((s) => !STRATEGIES.includes(s));
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

/**
 * revision_preserves: after a follow-up, every item the user did not
 * mention is still somewhere in the plan. `mentioned` is the fixture's list
 * of items the follow-up talks about; everything else in the previous plan
 * has to survive, in any bucket.
 */
export function revisionPreserves(previous, revised, mentioned = []) {
  const flat = (p) => BUCKETS.flatMap((b) => p.buckets?.[b] ?? []);
  const before = flat(previous);
  const after = new Set(flat(revised).map((s) => s.toLowerCase()));
  const lost = before.filter((item) => !mentioned.some((m) => item.toLowerCase().includes(m.toLowerCase())) && !after.has(item.toLowerCase()));
  return lost;
}

/** Grade one sort output end to end. */
export function gradeSort({ text, stopReason, state, fixture }) {
  const parsed = validJson(text, stopReason);
  if (!parsed.ok) return { parse: parsed.path, valid_json: false, hard_fail: true, violations: { parse: [parsed.error] } };
  const plan = parsed.value;
  const violations = {
    schema_valid: schemaValid(plan),
    cap_respected: capRespected(plan, state),
    banned_phrasing: bannedPhrasing(plan, state),
    routing_consistent: routingConsistent(plan, state, fixture),
    strategy_named: strategyNamed(plan),
  };
  return { parse: parsed.path, valid_json: true, plan, violations, hard_fail: false, any: Object.values(violations).some((v) => v.length) };
}
