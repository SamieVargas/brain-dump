// The rule graders on hand-built plans, and the fixtures' shape. No key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

import { gradeSort, capRespected, bannedPhrasing, routingConsistent, schemaValid, emergencyOneThing, revisionPreserves, strategyNamed, letGoUnique, whyGiven, carriedPlaced } from '../evals/graders.js';
import { ENERGY_LEVELS } from '../worker/contracts.js';

const task = (label, over = {}) => ({ label, detail: 'just attach and press send.', why: 'you said "the contract is the one"', strategy: '5-min rule', ...over });
const plan = (over = {}) => ({ now: [task('send the contract')], later: [{ text: 'gym', tag: 'decide' }], let_go: ['the party is not a verdict on you'], ...over });

test('a clean plan passes every rule', () => {
  const g = gradeSort({ text: JSON.stringify(plan()), stopReason: 'end_turn', level: 'plenty', fixture: { expect_output_type: 'task_heavy' } });
  assert.equal(g.valid_json, true);
  assert.equal(g.parse, 'native');
  assert.equal(g.any, false, JSON.stringify(g.violations));
});

test('caps: now per level', () => {
  const three = plan({ now: [task('a'), task('b'), task('c')] });
  assert.equal(capRespected(three, 'plenty').length, 0);
  assert.equal(capRespected(three, 'a little').length, 1);
  assert.equal(capRespected(three, 'none').length, 1);
  assert.equal(capRespected(plan(), 'none').length, 0);
});

test('banned phrasing: the shared list everywhere, should and need to only when anxious, and why is a quote', () => {
  const p = plan({ now: [task('send the contract', { detail: 'you should attach it' })] });
  assert.deepEqual(bannedPhrasing(p, false), []);
  assert.deepEqual(bannedPhrasing(p, true), ['should']);
  const q = plan({ let_go: ['stop procrastinating and just do it'] });
  assert.deepEqual(bannedPhrasing(q, false), ['just do it', 'stop procrastinating']);
  const quoted = plan({ now: [task('call', { why: 'you said "I should probably just call"' })] });
  assert.deepEqual(bannedPhrasing(quoted, true), [], 'the why quote is the person\'s own words');
  const later = plan({ later: [{ text: 'you need to renew the lease', tag: 'do' }] });
  assert.deepEqual(bannedPhrasing(later, true), ['need to']);
});

test('routing: now is never empty, and mental load gets one gentle item', () => {
  assert.equal(routingConsistent(plan(), 'plenty', {}).length, 0);
  assert.equal(routingConsistent(plan({ now: [] }), 'plenty', {}).length, 1);
  const two = plan({ now: [task('a'), task('b')] });
  assert.equal(routingConsistent(two, 'plenty', { expect_output_type: 'mental_load' }).length, 1);
  assert.equal(routingConsistent(two, 'plenty', { expect_output_type: 'task_heavy' }).length, 0);
});

test('let go stays unique, every now item has a why, and carry-overs are placed', () => {
  const dup = plan({ later: [{ text: 'the day-at-a-glance display', tag: 'idea' }], let_go: ['the day-at-a-glance display is allowed to start messy.'] });
  assert.deepEqual(letGoUnique(dup), ['the day-at-a-glance display']);
  assert.deepEqual(letGoUnique(plan()), []);
  assert.deepEqual(whyGiven(plan({ now: [task('a', { why: ' ' })] })), ['a']);
  const carried = plan({ later: [{ text: 'hang the shelf in the hallway this weekend', tag: 'carried' }] });
  assert.deepEqual(carriedPlaced(carried, ['hang the shelf in the hallway', 'reply to the school newsletter']), ['reply to the school newsletter']);
});

test('schema, strategies, and the emergency shape', () => {
  assert.deepEqual(schemaValid(plan()), []);
  assert.ok(schemaValid({ ...plan(), extra: 1 }).some((p) => /extra key/.test(p)));
  assert.ok(schemaValid(plan({ later: [{ text: 'x', tag: 'someday' }] })).some((p) => /later tag/.test(p)));
  assert.ok(schemaValid(plan({ now: [{ label: 'x' }] })).length);
  assert.ok(schemaValid({ output_type: 'task_heavy', buckets: {} }).length, 'the v2 shape is not the v3 shape');
  assert.deepEqual(strategyNamed(plan({ now: [task('a', { strategy: 'vibes' })] })), ['vibes']);
  assert.deepEqual(emergencyOneThing({ one_thing: 'open the email.', why: 'it is the smallest.' }), []);
  assert.ok(emergencyOneThing({ one_thing: 'open the email. then reply. then file it.', why: 'x' }).length);
  assert.ok(emergencyOneThing({ one_thing: 'x', why: 'y', extra: 1 }).length);
});

test('a revision keeps everything the user did not mention', () => {
  const before = plan();
  const kept = plan({ now: [], later: [{ text: 'gym', tag: 'decide' }, { text: 'send the contract', tag: 'do' }] });
  assert.deepEqual(revisionPreserves(before, kept, ['contract']), []);
  const lost = plan({ later: [], let_go: [] });
  assert.deepEqual(revisionPreserves(before, lost, ['contract']), ['gym', 'the party is not a verdict on you']);
});

test('a truncated or non-JSON response is a hard fail, a fenced one is recovered, a v2 plan fails schema', () => {
  const cut = gradeSort({ text: '{"now": [{"label": "a"', stopReason: 'max_tokens', level: 'none' });
  assert.equal(cut.hard_fail, true);
  const fenced = gradeSort({ text: '```json\n' + JSON.stringify(plan()) + '\n```', stopReason: 'end_turn', level: 'none' });
  assert.equal(fenced.parse, 'recovered');
  assert.equal(fenced.hard_fail, false);
  const old = gradeSort({ text: JSON.stringify({ output_type: 'task_heavy', buckets: {}, focus: [] }), stopReason: 'end_turn', level: 'plenty' });
  assert.equal(old.any, true);
  assert.ok(old.violations.schema_valid.length);
});

test('the fixtures are sound: twenty dumps with an expected shape, five follow-ups that point at a dump', async () => {
  const dumps = (await readdir(new URL('../evals/fixtures/dumps/', import.meta.url))).filter((f) => f.endsWith('.json'));
  assert.equal(dumps.length, 20);
  const ids = new Set();
  for (const f of dumps) {
    const d = JSON.parse(await readFile(new URL(`../evals/fixtures/dumps/${f}`, import.meta.url), 'utf8'));
    assert.ok(d.dump.trim().length, `${f} has a dump`);
    assert.ok(['task_heavy', 'mental_load'].includes(d.expect_output_type), `${f} expects a shape`);
    if (d.carried !== undefined) assert.ok(Array.isArray(d.carried) && d.carried.every((c) => typeof c === 'string'), `${f} carried`);
    ids.add(d.id);
  }
  const follows = (await readdir(new URL('../evals/fixtures/followups/', import.meta.url))).filter((f) => f.endsWith('.json'));
  assert.equal(follows.length, 5);
  for (const f of follows) {
    const x = JSON.parse(await readFile(new URL(`../evals/fixtures/followups/${f}`, import.meta.url), 'utf8'));
    assert.ok(ids.has(x.base), `${f} points at a dump`);
    assert.ok(ENERGY_LEVELS.includes(x.energy_state) && ENERGY_LEVELS.includes(x.energy_state_after), `${f} levels`);
    assert.equal(typeof x.anxious, 'boolean', `${f} anxious`);
    assert.equal(typeof x.anxious_after, 'boolean', `${f} anxious_after`);
    assert.ok(Array.isArray(x.mentioned) && x.follow_up, `${f} follow-up`);
  }
});
