// The eval runner on a stub client, no key: an interrupt, or the API refusing
// call after call, writes the partial table instead of losing the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../evals/run.js';

const plan = JSON.stringify({ now: [{ label: 'send the contract', detail: 'just attach and press send.', why: 'you said "the contract is the one"', strategy: '5-min rule' }], later: [{ text: 'gym', tag: 'decide' }], let_go: ['the party is not a verdict on you'] });
const reply = () => ({ text: plan, stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }, ms: 1 });
const quiet = async (fn) => {
  const { log } = console;
  const write = process.stdout.write;
  console.log = () => {};
  process.stdout.write = () => true;
  try { return await fn(); } finally { console.log = log; process.stdout.write = write; }
};

test('an interrupt after six calls writes the partial table and leaves latest.json alone', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  let calls = 0;
  const call = async () => {
    calls += 1;
    if (calls === 6) process.emit('SIGINT');
    return reply();
  };
  const code = await quiet(() => main({ call, runs: 1, levels: ['none'], anxious: [false], contracts: ['native'], out }));
  assert.equal(code, 130);
  const files = (await readdir(out)).sort();
  assert.equal(files.length, 2, files.join(', '));
  assert.ok(files.every((f) => f.includes('-partial.')), files.join(', '));
  assert.ok(!files.includes('latest.json'));
  const md = await readFile(join(out, files.find((f) => f.endsWith('.md'))), 'utf8');
  assert.match(md, /PARTIAL: 6 of 20 runs · 0 of 5 follow-ups/);
  const json = JSON.parse(await readFile(join(out, files.find((f) => f.endsWith('.json'))), 'utf8'));
  assert.equal(json.partial, true);
  assert.equal(json.stopped_by, 'interrupt');
  assert.equal(json.rows.length, 6);
  assert.equal(json.planned, 20);
  assert.equal(json.summary.byState.none.runs, 6);
  assert.equal(process.listenerCount('SIGINT'), 0);
});

test('five errors in a row stop the grid and are named in the table', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  const call = async () => { throw new Error('anthropic 400: credit balance too low'); };
  const code = await quiet(() => main({ call, runs: 2, levels: ['a little'], anxious: [true], contracts: ['native', 'prompt'], out }));
  assert.equal(code, 130);
  const files = await readdir(out);
  const json = JSON.parse(await readFile(join(out, files.find((f) => f.endsWith('.json'))), 'utf8'));
  assert.equal(json.rows.length, 5);
  assert.ok(json.rows.every((r) => r.error));
  assert.match(json.stopped_by, /5 errors in a row, last: anthropic 400/);
  const md = await readFile(join(out, files.find((f) => f.endsWith('.md'))), 'utf8');
  assert.match(md, /PARTIAL: 5 of 80 runs/);
  assert.match(md, /Stopped early: 5 errors in a row/);
});

test('a full run writes <date>.md, <date>.json and latest.json with exit 0', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  const code = await quiet(() => main({ call: async () => reply(), runs: 1, levels: ['none'], anxious: [false], contracts: ['native'], out }));
  assert.equal(code, 0);
  const files = (await readdir(out)).sort();
  assert.ok(files.includes('latest.json'), files.join(', '));
  assert.ok(files.some((f) => /^\d{4}-\d{2}-\d{2}-none-not_anxious-native-x1\.md$/.test(f)), files.join(', '));
  assert.ok(files.some((f) => /^\d{4}-\d{2}-\d{2}-none-not_anxious-native-x1\.json$/.test(f)), files.join(', '));
  const json = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8'));
  assert.equal(json.partial, false);
  assert.equal(json.rows.length, 20);
  assert.equal(json.followups.length, 5);
  assert.equal(json.summary.truncated, 0);
  assert.equal(json.rows[0].stop_reason, 'end_turn');
});

test('an ablation after a grid run keeps the grid rows in latest.json, and the reverse', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  await quiet(() => main({ call: async () => reply(), runs: 1, levels: ['none'], anxious: [false], contracts: ['native'], out }));
  await quiet(() => main({ call: async () => reply(), ablation: true, out }));
  let json = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8'));
  assert.equal(json.rows.length, 20, 'the grid rows survive the ablation run');
  assert.equal(json.ablation.as_written.runs, 20);
  assert.ok(json.ablation_ran_at);
  await quiet(() => main({ call: async () => reply(), runs: 1, levels: ['a little'], anxious: [true], contracts: ['prompt'], out }));
  json = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8'));
  assert.equal(json.rows[0].state, 'a little + anxious', 'the new grid replaces the old');
  assert.equal(json.ablation.as_written.runs, 20, 'and the ablation survives the grid run');
  const files = await readdir(out);
  assert.ok(files.some((f) => f.endsWith('-ablation.json')), files.join(', '));
});

test('a reply cut off at max_tokens is counted, not just failed', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  let calls = 0;
  const call = async () => {
    calls += 1;
    return calls % 2 ? { ...reply(), text: plan.slice(0, 40), stopReason: 'max_tokens' } : reply();
  };
  const code = await quiet(() => main({ call, runs: 1, levels: ['none'], anxious: [false], contracts: ['native'], out }));
  assert.equal(code, 1, 'cut-off replies are hard fails on the native path');
  const json = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8'));
  assert.equal(json.summary.truncated, 10);
  assert.equal(json.summary.native_hard_fails, 10);
  const md = await readFile(join(out, (await readdir(out)).find((f) => /-none-not_anxious-native-x1\.md$/.test(f))), 'utf8');
  assert.match(md, /cut off at max_tokens \(\d+\): 10 of 20/);
});

test('the ablation counts its runs when interrupted', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  let calls = 0;
  const call = async () => {
    calls += 1;
    if (calls === 25) process.emit('SIGINT');
    return reply();
  };
  const code = await quiet(() => main({ call, ablation: true, out }));
  assert.equal(code, 130);
  const files = await readdir(out);
  assert.ok(files.some((f) => f.endsWith('-ablation-partial.md')), files.join(', '));
  const md = await readFile(join(out, files.find((f) => f.endsWith('.md'))), 'utf8');
  assert.match(md, /PARTIAL: 25 of 40 runs/);
  assert.match(md, /\| as written \| \d+\/20 \|/);
  assert.match(md, /\| examples and bans removed \| \d+\/5 \|/);
});

test('a filtered run gets its own stem and --keep-text writes the raw replies', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  const code = await quiet(() => main({ call: async () => reply(), runs: 1, levels: ['a little'], anxious: [false], contracts: ['native'], keepText: true, out }));
  assert.equal(code, 0);
  const files = (await readdir(out)).sort();
  assert.ok(files.some((f) => /^\d{4}-\d{2}-\d{2}-a_little-not_anxious-native-x1\.md$/.test(f)), files.join(', '));
  assert.ok(!files.some((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)), 'the grid stem is untouched');
  const jsonl = await readFile(join(out, files.find((f) => f.endsWith('-replies.jsonl'))), 'utf8');
  const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 20);
  assert.equal(lines[0].stop_reason, 'end_turn');
  assert.equal(lines[0].text, plan);
});
