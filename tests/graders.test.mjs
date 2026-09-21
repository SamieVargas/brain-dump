// The rule graders on hand-built plans, and the fixtures' shape. No key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

import { gradeSort, capRespected, bannedPhrasing, routingConsistent, schemaValid, emergencyOneThing, revisionPreserves, strategyNamed } from '../evals/graders.js';
import { ENERGY_STATES } from '../worker/contracts.js';

const plan = (over = {}) => ({ output_type: 'task_heavy', focus_subtitle: 's', cta_text: 'c', buckets: { do_it: ['send the contract'], decide_later: ['gym'], capture_it: [], release_it: ['the party is not a verdict on you'] }, focus: [{ task: 'send the contract. just attach and press send.', strategy: '5-min rule' }], gentle_anchor: '', gentle_note: '', ...over });

test('a clean plan passes every rule', () => {
  const g = gradeSort({ text: JSON.stringify(plan()), stopReason: 'end_turn', state: 'overwhelmed', fixture: { expect_output_type: 'task_heavy' } });
  assert.equal(g.valid_json, true);
  assert.equal(g.parse, 'native');
  assert.equal(g.any, false, JSON.stringify(g.violations));
});

test('caps: do_it and focus per state', () => {
  const six = plan({ buckets: { do_it: ['a', 'b', 'c', 'd', 'e', 'f'], decide_later: [], capture_it: [], release_it: [] } });
  assert.equal(capRespected(six, 'overwhelmed').length, 1);
  assert.equal(capRespected(six, 'foggy').length, 1);
  const twoFocus = plan({ focus: [{ task: 'a', strategy: '5-min rule' }, { task: 'b', strategy: 'pair it' }] });
  assert.equal(capRespected(twoFocus, 'anxious').length, 0);
  assert.equal(capRespected(twoFocus, 'foggy').length, 1);
});

test('banned phrasing: the shared list everywhere, should and need to only when anxious', () => {
  const p = plan({ focus: [{ task: 'you should send the contract', strategy: '5-min rule' }] });
  assert.deepEqual(bannedPhrasing(p, 'overwhelmed'), []);
  assert.deepEqual(bannedPhrasing(p, 'anxious'), ['should']);
  const q = plan({ gentle_note: 'stop procrastinating and just do it' });
  assert.deepEqual(bannedPhrasing(q, 'foggy'), ['just do it', 'stop procrastinating']);
});

test('routing: foggy keeps one item, mental_load needs an anchor, the fixture expectation is checked', () => {
  assert.equal(routingConsistent(plan(), 'foggy', {}).length, 0);
  const three = plan({ focus: [{ task: 'a', strategy: 'one gesture' }, { task: 'b', strategy: 'one gesture' }, { task: 'c', strategy: 'one gesture' }] });
  assert.equal(routingConsistent(three, 'foggy', {}).length, 1);
  assert.equal(routingConsistent(plan({ output_type: 'mental_load', gentle_anchor: '' }), 'anxious', {}).length, 1);
  assert.equal(routingConsistent(plan(), 'anxious', { expect_output_type: 'mental_load' }).length, 1);
});

test('schema, strategies, and the emergency shape', () => {
  assert.deepEqual(schemaValid(plan()), []);
  assert.ok(schemaValid({ ...plan(), extra: 1 }).some((p) => /extra key/.test(p)));
  assert.ok(schemaValid({ ...plan(), output_type: 'chill' }).length);
  assert.deepEqual(strategyNamed(plan({ focus: [{ task: 'a', strategy: 'vibes' }] })), ['vibes']);
  assert.deepEqual(emergencyOneThing({ one_thing: 'open the email.', why: 'it is the smallest.' }), []);
  assert.ok(emergencyOneThing({ one_thing: 'open the email. then reply. then file it.', why: 'x' }).length);
  assert.ok(emergencyOneThing({ one_thing: 'x', why: 'y', extra: 1 }).length);
});

test('a revision keeps everything the user did not mention', () => {
  const before = plan();
  const kept = plan({ buckets: { do_it: [], decide_later: ['gym', 'send the contract'], capture_it: [], release_it: ['the party is not a verdict on you'] } });
  assert.deepEqual(revisionPreserves(before, kept, ['contract']), []);
  const lost = plan({ buckets: { do_it: ['send the contract'], decide_later: [], capture_it: [], release_it: [] } });
  assert.deepEqual(revisionPreserves(before, lost, ['contract']), ['gym', 'the party is not a verdict on you']);
});

test('a truncated or non-JSON response is a hard fail, and a fenced one is recovered', () => {
  const cut = gradeSort({ text: '{"output_type": "task_heavy", "buckets": {', stopReason: 'max_tokens', state: 'foggy', fixture: {} });
  assert.equal(cut.hard_fail, true);
  const fenced = gradeSort({ text: '```json\n' + JSON.stringify(plan()) + '\n```', stopReason: 'end_turn', state: 'foggy', fixture: {} });
  assert.equal(fenced.parse, 'recovered');
  assert.equal(fenced.hard_fail, false);
});

test('the fixtures are sound: twenty dumps with an expected shape, five follow-ups that point at a dump', async () => {
  const dumps = (await readdir(new URL('../evals/fixtures/dumps/', import.meta.url))).filter((f) => f.endsWith('.json'));
  assert.equal(dumps.length, 20);
  const ids = new Set();
  for (const f of dumps) {
    const d = JSON.parse(await readFile(new URL(`../evals/fixtures/dumps/${f}`, import.meta.url), 'utf8'));
    assert.ok(d.dump.trim().length, `${f} has a dump`);
    assert.ok(['task_heavy', 'mental_load'].includes(d.expect_output_type), `${f} expects a shape`);
    ids.add(d.id);
  }
  const follows = (await readdir(new URL('../evals/fixtures/followups/', import.meta.url))).filter((f) => f.endsWith('.json'));
  assert.equal(follows.length, 5);
  for (const f of follows) {
    const x = JSON.parse(await readFile(new URL(`../evals/fixtures/followups/${f}`, import.meta.url), 'utf8'));
    assert.ok(ids.has(x.base), `${f} points at a dump`);
    assert.ok(ENERGY_STATES.includes(x.energy_state) && ENERGY_STATES.includes(x.energy_state_after), `${f} states`);
    assert.ok(Array.isArray(x.mentioned) && x.follow_up, `${f} follow-up`);
  }
});
