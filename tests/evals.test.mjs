// The eval runner on a stub client, no key: an interrupt, or the API refusing
// call after call, writes the partial table instead of losing the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../evals/run.js';

const plan = JSON.stringify({ output_type: 'task_heavy', focus_subtitle: 's', cta_text: 'c', buckets: { do_it: ['send the contract'], decide_later: ['gym'], capture_it: [], release_it: ['the party is not a verdict on you'] }, focus: [{ task: 'send the contract. just attach and press send.', strategy: '5-min rule' }], gentle_anchor: '', gentle_note: '' });
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
  const code = await quiet(() => main({ call, runs: 1, states: ['foggy'], contracts: ['native'], out }));
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
  assert.equal(json.summary.byState.foggy.runs, 6);
  assert.equal(process.listenerCount('SIGINT'), 0);
});

test('five errors in a row stop the grid and are named in the table', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  const call = async () => { throw new Error('anthropic 400: credit balance too low'); };
  const code = await quiet(() => main({ call, runs: 2, states: ['anxious'], contracts: ['native', 'prompt'], out }));
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

test('a full run writes <date>.md and latest.json with exit 0', async () => {
  const out = await mkdtemp(join(tmpdir(), 'bd-evals-'));
  const code = await quiet(() => main({ call: async () => reply(), runs: 1, states: ['foggy'], contracts: ['native'], out }));
  assert.equal(code, 0);
  const files = (await readdir(out)).sort();
  assert.ok(files.includes('latest.json'), files.join(', '));
  assert.ok(files.some((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)), files.join(', '));
  const json = JSON.parse(await readFile(join(out, 'latest.json'), 'utf8'));
  assert.equal(json.partial, false);
  assert.equal(json.rows.length, 20);
  assert.equal(json.followups.length, 5);
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
