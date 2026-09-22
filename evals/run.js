#!/usr/bin/env node
// Brain Dump evals, rule-graded, no labels.
//
//   node evals/run.js                       20 dumps × 5 states × 2 contracts × N runs, plus the 5 follow-ups
//   node evals/run.js --runs=1              cheaper pass (default 5)
//   node evals/run.js --ablation            20 runs per arm on one dump: prompt as is vs examples + bans removed
//   node evals/run.js --states=foggy,anxious --contracts=native
//
// Needs ANTHROPIC_API_KEY. Every grader is deterministic (evals/graders.js);
// the offline half of this suite is `npm test`, which proves the graders and
// the fixtures without a key. Results land in evals/results/<date>.md and
// latest.json.
//
// Ctrl+C once, or the API refusing five calls in a row (credit running out
// mid-run), stops the grid and writes what completed to <date>-partial.md
// and .json, marked PARTIAL, with exit code 130. latest.json is left alone.
// A second Ctrl+C aborts outright.
//
// Every run keeps its own JSON (<date>.json, <date>-ablation.json) and
// latest.json accumulates: a grid run keeps the last ablation, an ablation run
// keeps the last grid, so neither overwrites the other's rows.

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL, MAX_TOKENS, ENERGY_STATES, CONTRACTS, sortSchema } from '../worker/contracts.js';
import { buildSystem, PROMPT_VERSION, sortStatic } from '../worker/prompts.js';
import { gradeSort, revisionPreserves, validJson } from './graders.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONSECUTIVE_ERRORS = 5;

function apiCall(apiKey) {
  return async ({ system, messages, contract }) => {
    const body = { model: MODEL, max_tokens: MAX_TOKENS, system, messages };
    if (contract === 'native') body.output_config = { format: { type: 'json_schema', schema: sortSchema() } };
    const t0 = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return { text: (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(''), stopReason: data.stop_reason, usage: data.usage, ms: Date.now() - t0 };
  };
}

async function loadDir(sub) {
  const dir = join(root, 'evals/fixtures', sub);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8'))));
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

// Runs the suite. `call` is the model client; the tests pass a stub.
// Returns the exit code: 0 clean, 1 with a hard fail, 130 when interrupted.
export async function main({ call, runs = 5, states = ENERGY_STATES, contracts = CONTRACTS, ablation = false, out = join(root, 'evals/results') }) {
  const dumps = await loadDir('dumps');
  const follows = await loadDir('followups');
  const ranAt = new Date().toISOString();
  const report = { ran_at: ranAt, model: MODEL, prompt_version: PROMPT_VERSION, runs, states, contracts, rows: [], followups: [], ablation: null, planned: 0, planned_followups: 0, partial: false, stopped_by: null };

  // One Ctrl+C sets the flag and the loops fall through to the table; the
  // listener is `once`, so a second Ctrl+C gets node's default and aborts.
  const onInterrupt = () => { report.partial = true; report.stopped_by = 'interrupt'; };
  process.once('SIGINT', onInterrupt);
  let errorsInARow = 0;
  const failed = (err) => {
    errorsInARow += 1;
    if (errorsInARow >= CONSECUTIVE_ERRORS && !report.partial) {
      report.partial = true;
      report.stopped_by = `${CONSECUTIVE_ERRORS} errors in a row, last: ${err.message}`;
    }
  };

  try {
    if (ablation) {
      const target = dumps.find((d) => d.id === 'D02_invites_should');
      const arms = { as_written: sortStatic(), examples_and_bans_removed: sortStatic({ ablate: true }) };
      const armRuns = 20;
      report.planned = armRuns * Object.keys(arms).length;
      const out = {};
      for (const [arm, stat] of Object.entries(arms)) {
        const grades = [];
        for (let i = 0; i < armRuns && !report.partial; i++) {
          process.stdout.write(`\r  ${arm} ${i + 1}/${armRuns}   `);
          const system = [{ type: 'text', text: stat, cache_control: { type: 'ephemeral' } }, { type: 'text', text: "The user's current energy state is: anxious" }];
          let r;
          try {
            r = await call({ system, messages: [{ role: 'user', content: target.dump }], contract: 'native' });
          } catch (err) {
            failed(err);
            continue;
          }
          errorsInARow = 0;
          grades.push({ ...gradeSort({ text: r.text, stopReason: r.stopReason, state: 'anxious', fixture: target }), stop_reason: r.stopReason ?? null });
        }
        out[arm] = {
          runs: grades.length,
          banned_phrasing: grades.filter((g) => g.violations?.banned_phrasing?.length).length,
          cap_respected: grades.filter((g) => !g.violations?.cap_respected?.length).length,
          hard_fails: grades.filter((g) => g.hard_fail).length,
          truncated: grades.filter((g) => g.stop_reason === 'max_tokens').length,
        };
      }
      process.stdout.write('\n');
      report.ablation = { fixture: target.id, state: 'anxious', ...out };
    } else {
      report.planned = dumps.length * states.length * contracts.length * runs;
      report.planned_followups = follows.length;
      grid: for (const d of dumps) {
        for (const state of states) {
          for (const contract of contracts) {
            for (let i = 0; i < runs; i++) {
              if (report.partial) break grid;
              process.stdout.write(`\r  ${d.id} · ${state} · ${contract} · ${i + 1}/${runs}      `);
              const system = buildSystem('sort', state);
              let r;
              try {
                r = await call({ system, messages: [{ role: 'user', content: d.dump }], contract });
              } catch (err) {
                report.rows.push({ id: d.id, state, contract, error: String(err.message) });
                failed(err);
                continue;
              }
              errorsInARow = 0;
              const g = gradeSort({ text: r.text, stopReason: r.stopReason, state, fixture: d });
              report.rows.push({ id: d.id, state, contract, parse: g.parse, valid_json: g.valid_json, hard_fail: g.hard_fail, violations: g.violations, stop_reason: r.stopReason ?? null, usage: r.usage, ms: r.ms });
            }
          }
        }
      }
      process.stdout.write('\n');
      // Follow-ups: the base plan first, then the follow-up under the same contract.
      for (const f of follows) {
        if (report.partial) break;
        const base = dumps.find((d) => d.id === f.base);
        process.stdout.write(`\r  ${f.id}            `);
        const first = await call({ system: buildSystem('sort', f.energy_state), messages: [{ role: 'user', content: base.dump }], contract: 'native' });
        const plan = validJson(first.text, first.stopReason);
        if (!plan.ok) {
          report.followups.push({ id: f.id, error: 'first plan did not parse' });
          continue;
        }
        const history = [{ role: 'user', content: base.dump }, { role: 'assistant', content: first.text }];
        const second = await call({ system: buildSystem('sort', f.energy_state_after, { followUp: true }), messages: [...history, { role: 'user', content: f.follow_up }], contract: 'native' });
        const revised = validJson(second.text, second.stopReason);
        const g = revised.ok ? gradeSort({ text: second.text, stopReason: second.stopReason, state: f.energy_state_after, fixture: {} }) : null;
        report.followups.push({ id: f.id, revised_parsed: revised.ok, lost: revised.ok ? revisionPreserves(plan.value, revised.value, f.mentioned) : null, violations: g?.violations ?? null });
      }
      process.stdout.write('\n');
    }
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  if (report.partial) console.error(`\nstopped (${report.stopped_by}) after ${completed(report)}; writing the partial table`);
  return save(report, out);
}

function completed(report) {
  if (report.ablation) return `${Object.values(report.ablation).reduce((n, a) => n + (a?.runs ?? 0), 0)} of ${report.planned} runs`;
  return `${report.rows.length} of ${report.planned} runs · ${report.followups.length} of ${report.planned_followups} follow-ups`;
}

function summarize(report) {
  const rows = report.rows.filter((r) => !r.error);
  const byState = {};
  for (const state of report.states) {
    const rs = rows.filter((r) => r.state === state);
    byState[state] = {
      runs: rs.length,
      hard_fails: rs.filter((r) => r.hard_fail).length,
      cap: rs.filter((r) => r.violations?.cap_respected?.length).length,
      banned: rs.filter((r) => r.violations?.banned_phrasing?.length).length,
      routing: rs.filter((r) => r.violations?.routing_consistent?.length).length,
      schema: rs.filter((r) => r.violations?.schema_valid?.length).length,
      strategy: rs.filter((r) => r.violations?.strategy_named?.length).length,
    };
  }
  const byContract = {};
  for (const c of report.contracts) {
    const rs = rows.filter((r) => r.contract === c);
    byContract[c] = { runs: rs.length, native: rs.filter((r) => r.parse === 'native').length, recovered: rs.filter((r) => r.parse === 'recovered').length, failed: rs.filter((r) => r.parse === 'failed').length, cap: rs.filter((r) => r.violations?.cap_respected?.length).length };
  }
  const nativeFails = rows.filter((r) => r.contract === 'native' && r.parse === 'failed').length;
  const cacheReads = rows.map((r) => r.usage?.cache_read_input_tokens ?? 0);
  const cacheShare = rows.length ? cacheReads.filter((x) => x > 0).length / rows.length : 0;
  return { byState, byContract, native_hard_fails: nativeFails, truncated: rows.filter((r) => r.stop_reason === 'max_tokens').length, cache_read_share: cacheShare, mean_ms: rows.length ? Math.round(rows.reduce((n, r) => n + r.ms, 0) / rows.length) : null, errors: report.rows.length - rows.length };
}

function render(report) {
  const s = summarize(report);
  const lines = [`# Brain Dump evals — ${report.ran_at.slice(0, 10)}${report.partial ? ` · PARTIAL: ${completed(report)}` : ''}`, '', `Model \`${report.model}\` · prompt ${report.prompt_version} · ${report.runs} runs per cell`, ''];
  if (report.partial) lines.push(`Stopped early: ${report.stopped_by}. The rows below are the cells that finished, in fixture order, so a partial table over-represents the first dumps.`, '');
  if (report.rows.length) {
    lines.push('## Violation rate per rule, per state', '', '| State | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [state, v] of Object.entries(s.byState)) lines.push(`| ${state} | ${v.runs} | ${v.hard_fails} | ${pct(v.cap, v.runs)} | ${pct(v.banned, v.runs)} | ${pct(v.routing, v.runs)} | ${pct(v.schema, v.runs)} | ${pct(v.strategy, v.runs)} |`);
    lines.push('', '## Parse outcome per contract', '', '| Contract | Runs | Native | Recovered | Failed | Cap violations |', '| --- | --- | --- | --- | --- | --- |');
    for (const [c, v] of Object.entries(s.byContract)) lines.push(`| ${c} | ${v.runs} | ${v.native} | ${v.recovered} | ${v.failed} | ${pct(v.cap, v.runs)} |`);
    lines.push('', `Hard fail on the native path (valid_json failing): **${s.native_hard_fails}** · cut off at max_tokens (${MAX_TOKENS}): ${s.truncated} of ${report.rows.length} · cache reads on ${pct(Math.round(s.cache_read_share * report.rows.length), report.rows.length)} of runs · mean latency ${s.mean_ms} ms · errors ${s.errors}`);
  }
  if (report.followups.length) {
    lines.push('', '## Follow-ups: revision preserves', '', '| Conversation | Parsed | Items lost |', '| --- | --- | --- |');
    for (const f of report.followups) lines.push(`| ${f.id} | ${f.error ? f.error : f.revised_parsed ? 'yes' : 'no'} | ${f.lost ? f.lost.length ? f.lost.join('; ') : 'none' : '—'} |`);
  }
  if (report.ablation) {
    const a = report.ablation;
    lines.push('', `## Ablation · ${a.fixture} · anxious · 20 runs per arm`, '', '| Arm | Banned phrasing violations | Cap respected | Hard fails | Cut off at max_tokens |', '| --- | --- | --- | --- | --- |');
    for (const arm of ['as_written', 'examples_and_bans_removed']) if (a[arm]) lines.push(`| ${arm.replace(/_/g, ' ')} | ${a[arm].banned_phrasing}/${a[arm].runs} | ${a[arm].cap_respected}/${a[arm].runs} | ${a[arm].hard_fails} | ${a[arm].truncated ?? 0} |`);
    lines.push('', 'A tie is a tie. The arms are paired: same dump, same state, same session.');
  }
  lines.push('');
  return lines.join('\n');
}

async function save(report, dir) {
  await mkdir(dir, { recursive: true });
  const md = render(report);
  const stem = `${report.ran_at.slice(0, 10)}${report.ablation ? '-ablation' : ''}${report.partial ? '-partial' : ''}`;
  const full = { ...report, summary: report.rows.length ? summarize(report) : null };
  await writeFile(join(dir, `${stem}.md`), md);
  await writeFile(join(dir, `${stem}.json`), JSON.stringify(full, null, 2));
  // latest.json accumulates across runs, so a grid run keeps the last ablation
  // and an ablation run keeps the last grid's rows. A partial run never touches it.
  if (!report.partial) {
    let prior = {};
    try { prior = JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')); } catch { /* first run */ }
    const latest = report.ablation
      ? { ...prior, model: report.model, prompt_version: report.prompt_version, ablation: report.ablation, ablation_ran_at: report.ran_at }
      : { ...prior, ...full, ablation: prior.ablation ?? null, ablation_ran_at: prior.ablation_ran_at ?? null };
    await writeFile(join(dir, 'latest.json'), JSON.stringify(latest, null, 2));
  }
  console.log(md);
  console.log(`wrote ${join(dir, stem + '.md')} and .json${report.partial ? '' : ', latest.json updated'}`);
  if (report.partial) return 130;
  const hard = report.rows.filter((r) => r.contract === 'native' && r.parse === 'failed').length;
  return hard ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set. The offline half is `npm test`.');
    process.exit(2);
  }
  main({
    call: apiCall(apiKey),
    runs: Number(opt('runs', 5)),
    states: opt('states', ENERGY_STATES.join(',')).split(','),
    contracts: opt('contracts', CONTRACTS.join(',')).split(','),
    ablation: args.includes('--ablation'),
    out: opt('out', join(root, 'evals/results')),
  }).then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
