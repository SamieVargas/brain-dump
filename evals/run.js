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

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODEL, MAX_TOKENS, ENERGY_STATES, CONTRACTS, sortSchema } from '../worker/contracts.js';
import { buildSystem, PROMPT_VERSION, sortStatic } from '../worker/prompts.js';
import { gradeSort, revisionPreserves, validJson } from './graders.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const RUNS = Number(opt('runs', 5));
const STATES = opt('states', ENERGY_STATES.join(',')).split(',');
const CONTRACT_ARMS = opt('contracts', CONTRACTS.join(',')).split(',');
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set. The offline half is `npm test`.');
  process.exit(2);
}

async function loadDir(sub) {
  const dir = join(root, 'evals/fixtures', sub);
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(names.map(async (n) => JSON.parse(await readFile(join(dir, n), 'utf8'))));
}

async function call({ system, messages, contract }) {
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
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

async function main() {
  const dumps = await loadDir('dumps');
  const follows = await loadDir('followups');
  const ranAt = new Date().toISOString();
  const report = { ran_at: ranAt, model: MODEL, prompt_version: PROMPT_VERSION, runs: RUNS, rows: [], followups: [], ablation: null };

  if (args.includes('--ablation')) {
    const target = dumps.find((d) => d.id === 'D02_invites_should');
    const arms = { as_written: sortStatic(), examples_and_bans_removed: sortStatic({ ablate: true }) };
    const out = {};
    for (const [arm, stat] of Object.entries(arms)) {
      const grades = [];
      for (let i = 0; i < 20; i++) {
        process.stdout.write(`\r  ${arm} ${i + 1}/20   `);
        const system = [{ type: 'text', text: stat, cache_control: { type: 'ephemeral' } }, { type: 'text', text: "The user's current energy state is: anxious" }];
        const r = await call({ system, messages: [{ role: 'user', content: target.dump }], contract: 'native' });
        grades.push(gradeSort({ text: r.text, stopReason: r.stopReason, state: 'anxious', fixture: target }));
      }
      out[arm] = {
        runs: grades.length,
        banned_phrasing: grades.filter((g) => g.violations?.banned_phrasing?.length).length,
        cap_respected: grades.filter((g) => !g.violations?.cap_respected?.length).length,
        hard_fails: grades.filter((g) => g.hard_fail).length,
      };
    }
    process.stdout.write('\n');
    report.ablation = { fixture: target.id, state: 'anxious', ...out };
  } else {
    for (const d of dumps) {
      for (const state of STATES) {
        for (const contract of CONTRACT_ARMS) {
          for (let i = 0; i < RUNS; i++) {
            process.stdout.write(`\r  ${d.id} · ${state} · ${contract} · ${i + 1}/${RUNS}      `);
            const system = buildSystem('sort', state);
            let r;
            try {
              r = await call({ system, messages: [{ role: 'user', content: d.dump }], contract });
            } catch (err) {
              report.rows.push({ id: d.id, state, contract, error: String(err.message) });
              continue;
            }
            const g = gradeSort({ text: r.text, stopReason: r.stopReason, state, fixture: d });
            report.rows.push({ id: d.id, state, contract, parse: g.parse, valid_json: g.valid_json, hard_fail: g.hard_fail, violations: g.violations, usage: r.usage, ms: r.ms });
          }
        }
      }
    }
    process.stdout.write('\n');
    // Follow-ups: the base plan first, then the follow-up under the same contract.
    for (const f of follows) {
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

  await save(report);
}

function summarize(report) {
  const rows = report.rows.filter((r) => !r.error);
  const byState = {};
  for (const state of STATES) {
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
  for (const c of CONTRACT_ARMS) {
    const rs = rows.filter((r) => r.contract === c);
    byContract[c] = { runs: rs.length, native: rs.filter((r) => r.parse === 'native').length, recovered: rs.filter((r) => r.parse === 'recovered').length, failed: rs.filter((r) => r.parse === 'failed').length, cap: rs.filter((r) => r.violations?.cap_respected?.length).length };
  }
  const nativeFails = rows.filter((r) => r.contract === 'native' && r.parse === 'failed').length;
  const cacheReads = rows.map((r) => r.usage?.cache_read_input_tokens ?? 0);
  const cacheShare = rows.length ? cacheReads.filter((x) => x > 0).length / rows.length : 0;
  return { byState, byContract, native_hard_fails: nativeFails, cache_read_share: cacheShare, mean_ms: rows.length ? Math.round(rows.reduce((n, r) => n + r.ms, 0) / rows.length) : null, errors: report.rows.length - rows.length };
}

function render(report) {
  const s = summarize(report);
  const lines = [`# Brain Dump evals — ${report.ran_at.slice(0, 10)}`, '', `Model \`${report.model}\` · prompt ${report.prompt_version} · ${report.runs} runs per cell`, ''];
  if (report.rows.length) {
    lines.push('## Violation rate per rule, per state', '', '| State | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [state, v] of Object.entries(s.byState)) lines.push(`| ${state} | ${v.runs} | ${v.hard_fails} | ${pct(v.cap, v.runs)} | ${pct(v.banned, v.runs)} | ${pct(v.routing, v.runs)} | ${pct(v.schema, v.runs)} | ${pct(v.strategy, v.runs)} |`);
    lines.push('', '## Parse outcome per contract', '', '| Contract | Runs | Native | Recovered | Failed | Cap violations |', '| --- | --- | --- | --- | --- | --- |');
    for (const [c, v] of Object.entries(s.byContract)) lines.push(`| ${c} | ${v.runs} | ${v.native} | ${v.recovered} | ${v.failed} | ${pct(v.cap, v.runs)} |`);
    lines.push('', `Hard fail on the native path (valid_json failing): **${s.native_hard_fails}** · cache reads on ${pct(Math.round(s.cache_read_share * report.rows.length), report.rows.length)} of runs · mean latency ${s.mean_ms} ms · errors ${s.errors}`);
  }
  if (report.followups.length) {
    lines.push('', '## Follow-ups: revision preserves', '', '| Conversation | Parsed | Items lost |', '| --- | --- | --- |');
    for (const f of report.followups) lines.push(`| ${f.id} | ${f.error ? f.error : f.revised_parsed ? 'yes' : 'no'} | ${f.lost ? f.lost.length ? f.lost.join('; ') : 'none' : '—'} |`);
  }
  if (report.ablation) {
    const a = report.ablation;
    lines.push('', `## Ablation · ${a.fixture} · anxious · 20 runs per arm`, '', '| Arm | Banned phrasing violations | Cap respected | Hard fails |', '| --- | --- | --- | --- |');
    for (const arm of ['as_written', 'examples_and_bans_removed']) lines.push(`| ${arm.replace(/_/g, ' ')} | ${a[arm].banned_phrasing}/${a[arm].runs} | ${a[arm].cap_respected}/${a[arm].runs} | ${a[arm].hard_fails} |`);
    lines.push('', 'A tie is a tie. The arms are paired: same dump, same state, same session.');
  }
  lines.push('');
  return lines.join('\n');
}

async function save(report) {
  const dir = join(root, 'evals/results');
  await mkdir(dir, { recursive: true });
  const md = render(report);
  await writeFile(join(dir, `${report.ran_at.slice(0, 10)}${report.ablation ? '-ablation' : ''}.md`), md);
  await writeFile(join(dir, 'latest.json'), JSON.stringify({ ...report, summary: report.rows.length ? summarize(report) : null }, null, 2));
  console.log(md);
  const hard = report.rows.filter((r) => r.contract === 'native' && r.parse === 'failed').length;
  process.exit(hard ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
