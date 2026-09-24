// Dollars from usage: the price table, the helper, the rows the runner adds,
// and the recost script that re-prices the committed results. No key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MODEL, PRICES, costUsd } from '../worker/contracts.js';
import { main, summarize, renderTables, NOT_RECORDED } from '../evals/run.js';
import { recost, recostMarkdown } from '../scripts/recost.mjs';

const results = new URL('../evals/results/', import.meta.url);
const plan = JSON.stringify({ now: [{ label: 'send the contract', detail: 'just attach and press send.', why: 'you said "the contract is the one"', strategy: '5-min rule' }], later: [{ text: 'gym', tag: 'decide' }], let_go: ['the party is not a verdict on you'] });
const usage = { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 3000, output_tokens: 2000 };
const reply = () => ({ text: plan, stopReason: 'end_turn', usage: { ...usage }, ms: 1 });
const quiet = async (fn) => {
  const { log } = console;
  const write = process.stdout.write;
  console.log = () => {};
  process.stdout.write = () => true;
  try { return await fn(); } finally { console.log = log; process.stdout.write = write; }
};

test('the price table covers the model the worker calls, with the date it was read', () => {
  const p = PRICES[MODEL];
  assert.ok(p, `no price for ${MODEL}`);
  for (const k of ['input', 'output', 'cache_write', 'cache_read']) assert.equal(typeof p[k], 'number', k);
  assert.match(p.read_on, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(p.output > p.input && p.cache_write > p.input && p.cache_read < p.input, 'the multipliers point the right way');
});

test('costUsd prices every token field and is null with nothing to price', () => {
  const p = PRICES[MODEL];
  const expected = (100 * p.input + 3000 * p.cache_read + 2000 * p.output) / 1e6;
  assert.equal(costUsd(usage), expected);
  assert.equal(costUsd({ input_tokens: 131, cache_creation_input_tokens: 3339, cache_read_input_tokens: 0, output_tokens: 2257 }), (131 * p.input + 3339 * p.cache_write + 2257 * p.output) / 1e6);
  assert.equal(costUsd({ output_tokens: 1000 }), p.output / 1000, 'missing fields count as zero');
  assert.equal(costUsd(null), null);
  assert.equal(costUsd(undefined), null);
  assert.equal(costUsd({ first: usage, second: usage }), null, 'a wrapper with no token fields is not a usage');
  assert.equal(costUsd(usage, 'no-such-model'), null);
});

test('a run prices every plan, the follow-ups and the ablation, and the tables carry the columns', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-cost-'));
  const each = costUsd(usage);
  await quiet(() => main({ call: async () => reply(), runs: 1, levels: ['a little'], anxious: [true], contracts: ['native'], out }));
  await quiet(() => main({ call: async () => reply(), ablation: true, out }));
  const latest = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8'));
  assert.equal(latest.rows.length, 20);
  assert.ok(latest.rows.every((r) => r.cost_usd === each), 'every row carries its cost');
  assert.ok(latest.followups.every((f) => f.cost_usd === 2 * each && f.usage.first && f.usage.second), 'a follow-up carries both calls');
  const c = latest.summary.cost;
  assert.equal(c.plans_priced, 20);
  assert.equal(c.per_plan_usd.min, each);
  assert.equal(c.per_plan_usd.median, each);
  assert.equal(c.per_plan_usd.max, each);
  assert.ok(Math.abs(c.grid_usd - 20 * each) < 1e-12);
  assert.ok(Math.abs(c.followups_usd - 10 * each) < 1e-12);
  assert.ok(Math.abs(c.run_usd - 30 * each) < 1e-12, 'the grid run prices the grid and its follow-ups');
  assert.ok(Math.abs(latest.summary.byState['a little + anxious'].cost_per_plan_usd - each) < 1e-12, 'the per-state mean');
  assert.ok(Math.abs(latest.ablation.as_written.cost_usd - 20 * each) < 1e-12, 'the ablation arm total');
  const ablation = JSON.parse(await readFile(join(out, (await readdir(out)).find((f) => f.endsWith('-ablation.json'))), 'utf8'));
  assert.ok(Math.abs(ablation.summary.cost.ablation_usd - 40 * each) < 1e-12);
  assert.ok(Math.abs(ablation.summary.cost.run_usd - 40 * each) < 1e-12, 'the ablation run prices its forty calls');
  const md = await readFile(join(out, (await readdir(out)).find((f) => /-a_little-anxious-native-x1\.md$/.test(f))), 'utf8');
  assert.match(md, /\| Level \| .* \| Let go unique \| Why given \| Carried placed \| Cost per plan \(mean, USD\) \| Cost, all runs \(USD\) \|/);
  assert.match(md, new RegExp(`\\| a little \\+ anxious \\| 20 \\| .* \\| ${each.toFixed(4)} \\| ${(20 * each).toFixed(4)} \\|`));
  assert.match(md, /\| Conversation \| Parsed \| Items lost \| Cost, both calls \(USD\) \|/);
  assert.match(md, /## Cost\n\nPrices for `claude-sonnet-5`: \$2\.00 in, \$10\.00 out/);
  assert.match(md, new RegExp(`\\| Whole run, everything above that was priced \\| ${(30 * each).toFixed(4)} \\|`));
  assert.doesNotMatch(md, new RegExp(NOT_RECORDED));
});

test('rows without usage read "not recorded", in the JSON and in the tables', () => {
  const report = { ran_at: '2026-09-22T00:00:00.000Z', model: MODEL, prompt_version: 'sort@v2', runs: 1, states: ['anxious'], contracts: ['native'], rows: [{ id: 'D01', state: 'anxious', contract: 'native', parse: 'native', valid_json: true, hard_fail: false, violations: {}, stop_reason: 'end_turn', usage: { ...usage }, ms: 1 }], followups: [{ id: 'F01', revised_parsed: true, lost: [], violations: {} }], ablation: { fixture: 'D02_invites_should', state: 'anxious', as_written: { runs: 20, banned_phrasing: 1, cap_respected: 20, hard_fails: 0, truncated: 0 }, examples_and_bans_removed: { runs: 20, banned_phrasing: 1, cap_respected: 20, hard_fails: 0, truncated: 0 } }, planned: 1, planned_followups: 1, partial: false, stopped_by: null };
  const s = summarize(report);
  assert.equal(s.cost.grid_usd, costUsd(usage), 'a row recorded before cost_usd existed is priced from its usage');
  assert.equal(s.cost.followups_usd, null);
  assert.equal(s.cost.ablation_usd, null);
  assert.equal(s.cost.run_usd, costUsd(usage), 'the whole run is what was priced, nothing estimated');
  const t = renderTables(report);
  assert.match(t.followups, new RegExp(`\\| F01 \\| yes \\| none \\| ${NOT_RECORDED} \\|`));
  assert.match(t.ablation, new RegExp(`\\| as written \\| 1/20 \\| 20/20 \\| 0 \\| 0 \\| ${NOT_RECORDED} \\|`));
  assert.match(t.cost, new RegExp(`\\| Follow-ups, 1 conversations, two calls each \\| ${NOT_RECORDED} \\|`));
});

test('recost is a no-op on a table the runner just wrote, and rebuilds one whose cost section was removed', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-recost-'));
  await quiet(() => main({ call: async () => reply(), runs: 1, levels: ['none'], anxious: [false], contracts: ['native'], out }));
  const name = (await readdir(out)).find((f) => f.endsWith('.md'));
  const fresh = await readFile(join(out, name), 'utf8');
  assert.deepEqual(await recost(out), [], 'nothing to rewrite');
  const stripped = fresh.slice(0, fresh.indexOf('## Cost')).replace(/\| [\d.]+ \| [\d.]+ \|\n/g, ' |\n');
  await writeFile(join(out, name), stripped);
  assert.deepEqual(await recost(out, { check: true }), [name.slice(0, -3)]);
  assert.equal(await readFile(join(out, name), 'utf8'), stripped, '--check writes nothing');
  await recost(out);
  assert.equal(await readFile(join(out, name), 'utf8'), fresh, 'the tables and the Cost section come back exactly');
});

test('the committed results carry the costs their JSON implies', async () => {
  const names = (await readdir(results)).filter((n) => n.endsWith('.json') && n !== 'latest.json');
  assert.ok(names.length >= 2, 'the 2026-09-22 results are committed');
  for (const name of names) {
    const stem = name.slice(0, -5);
    const report = JSON.parse(await readFile(new URL(name, results), 'utf8'));
    const md = await readFile(new URL(`${stem}.md`, results), 'utf8');
    assert.equal(recostMarkdown(md, report), md, `${stem}.md is out of date: run node scripts/recost.mjs`);
    assert.match(md, /## Cost/);
  }
  // The first keyed run: twenty priced plans, follow-ups and ablation unpriced.
  const grid = JSON.parse(await readFile(new URL('2026-09-22-anxious-native-x1.json', results), 'utf8'));
  const s = summarize(grid);
  assert.equal(s.cost.plans_priced, 20);
  assert.equal(s.cost.followups_usd, null);
  assert.ok(s.cost.per_plan_usd.min > 0.01 && s.cost.per_plan_usd.max < 0.06, `${s.cost.per_plan_usd.min} to ${s.cost.per_plan_usd.max}`);
  const dir = await mkdtemp(join(tmpdir(), 'bd-committed-'));
  for (const n of ['2026-09-22-anxious-native-x1.json', '2026-09-22-anxious-native-x1.md']) await copyFile(new URL(n, results), join(dir, n));
  assert.deepEqual(await recost(dir, { check: true }), []);
});
