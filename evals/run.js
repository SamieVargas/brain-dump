#!/usr/bin/env node
// Brain Dump evals, rule-graded, no labels.
//
//   node evals/run.js                       20 dumps × 3 levels × anxious off/on × 2 contracts × N runs, plus the 5 follow-ups
//   node evals/run.js --runs=1              cheaper pass (default 5)
//   node evals/run.js --ablation            20 runs per arm on one dump: prompt as is vs examples + bans removed
//   node evals/run.js --levels=none,"a little" --anxious=on --contracts=native
//   node evals/run.js --keep-text ...     also write every raw reply to <stem>-replies.jsonl
//
// A cell is a level with the anxious switch off or on, so the full grid has
// six: plenty, a little, none, and each again with "+ anxious".
//
// A filtered run (any --levels, --anxious, --contracts or --runs) gets its own
// stem, <date>-<levels>[-anxious|-not_anxious]-<contracts>-x<runs>, so a probe
// never overwrites the grid.
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

import { MODEL, MAX_TOKENS, ENERGY_LEVELS, CONTRACTS, PRICES, costUsd, sortSchema } from '../worker/contracts.js';
import { buildSystem, sortDynamic, dumpWithCarried, PROMPT_VERSION, sortStatic } from '../worker/prompts.js';
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

/** The label a cell goes by in the tables: the level, plus "+ anxious". */
export const cellLabel = (level, anxious) => (anxious ? `${level} + anxious` : level);
const ANXIOUS_MODES = [false, true];

const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');

// Dollars, four places. A null cost is a row with no usage to price: the
// follow-ups and the ablation did not keep usage before this date.
export const NOT_RECORDED = 'not recorded before 2026-09-23';
const usd = (x) => (x === null || x === undefined ? NOT_RECORDED : x.toFixed(4));
const sum = (xs) => xs.reduce((n, x) => n + x, 0);

// Runs the suite. `call` is the model client; the tests pass a stub.
// Returns the exit code: 0 clean, 1 with a hard fail, 130 when interrupted.
export async function main({ call, runs = 5, levels = ENERGY_LEVELS, anxious = ANXIOUS_MODES, contracts = CONTRACTS, ablation = false, keepText = false, out = join(root, 'evals/results') }) {
  const dumps = await loadDir('dumps');
  const follows = await loadDir('followups');
  const ranAt = new Date().toISOString();
  const cells = levels.flatMap((level) => anxious.map((anx) => ({ level, anxious: anx, label: cellLabel(level, anx) })));
  const report = { ran_at: ranAt, model: MODEL, prompt_version: PROMPT_VERSION, runs, levels, anxious, states: cells.map((c) => c.label), contracts, rows: [], followups: [], ablation: null, planned: 0, planned_followups: 0, partial: false, stopped_by: null };
  const filtered = !ablation && (runs !== 5 || levels.length !== ENERGY_LEVELS.length || anxious.length !== ANXIOUS_MODES.length || contracts.length !== CONTRACTS.length);
  const texts = keepText ? [] : null;

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
          const system = [{ type: 'text', text: stat, cache_control: { type: 'ephemeral' } }, { type: 'text', text: sortDynamic('a little', { anxious: true }) }];
          let r;
          try {
            r = await call({ system, messages: [{ role: 'user', content: target.dump }], contract: 'native' });
          } catch (err) {
            failed(err);
            continue;
          }
          errorsInARow = 0;
          grades.push({ ...gradeSort({ text: r.text, stopReason: r.stopReason, level: 'a little', anxious: true, fixture: target }), stop_reason: r.stopReason ?? null, usage: r.usage ?? null, cost_usd: costUsd(r.usage) });
        }
        out[arm] = {
          runs: grades.length,
          banned_phrasing: grades.filter((g) => g.violations?.banned_phrasing?.length).length,
          cap_respected: grades.filter((g) => !g.violations?.cap_respected?.length).length,
          hard_fails: grades.filter((g) => g.hard_fail).length,
          truncated: grades.filter((g) => g.stop_reason === 'max_tokens').length,
          // Null until every run in the arm carries usage; a mixed arm is not priced.
          cost_usd: grades.length && grades.every((g) => g.cost_usd !== null) ? sum(grades.map((g) => g.cost_usd)) : null,
        };
      }
      process.stdout.write('\n');
      report.ablation = { fixture: target.id, state: cellLabel('a little', true), ...out };
    } else {
      report.planned = dumps.length * cells.length * contracts.length * runs;
      report.planned_followups = follows.length;
      grid: for (const d of dumps) {
        for (const { level, anxious: anx, label: state } of cells) {
          for (const contract of contracts) {
            for (let i = 0; i < runs; i++) {
              if (report.partial) break grid;
              process.stdout.write(`\r  ${d.id} · ${state} · ${contract} · ${i + 1}/${runs}      `);
              const system = buildSystem('sort', level, { anxious: anx });
              let r;
              try {
                r = await call({ system, messages: [{ role: 'user', content: dumpWithCarried(d.dump, d.carried) }], contract });
              } catch (err) {
                report.rows.push({ id: d.id, state, level, anxious: anx, contract, error: String(err.message) });
                failed(err);
                continue;
              }
              errorsInARow = 0;
              texts?.push({ id: d.id, state, contract, stop_reason: r.stopReason ?? null, output_tokens: r.usage?.output_tokens ?? null, text: r.text });
              const g = gradeSort({ text: r.text, stopReason: r.stopReason, level, anxious: anx, fixture: d });
              report.rows.push({ id: d.id, state, level, anxious: anx, contract, parse: g.parse, valid_json: g.valid_json, hard_fail: g.hard_fail, violations: g.violations, stop_reason: r.stopReason ?? null, usage: r.usage, ms: r.ms, cost_usd: costUsd(r.usage) });
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
        const first = await call({ system: buildSystem('sort', f.energy_state, { anxious: !!f.anxious }), messages: [{ role: 'user', content: base.dump }], contract: 'native' });
        const plan = validJson(first.text, first.stopReason);
        if (!plan.ok) {
          report.followups.push({ id: f.id, error: 'first plan did not parse' });
          continue;
        }
        const history = [{ role: 'user', content: base.dump }, { role: 'assistant', content: first.text }];
        const second = await call({ system: buildSystem('sort', f.energy_state_after, { anxious: !!f.anxious_after, followUp: true }), messages: [...history, { role: 'user', content: f.follow_up }], contract: 'native' });
        const revised = validJson(second.text, second.stopReason);
        const g = revised.ok ? gradeSort({ text: second.text, stopReason: second.stopReason, level: f.energy_state_after, anxious: !!f.anxious_after, fixture: {} }) : null;
        const usage = { first: first.usage ?? null, second: second.usage ?? null };
        const both = costUsd(usage.first) !== null && costUsd(usage.second) !== null ? costUsd(usage.first) + costUsd(usage.second) : null;
        report.followups.push({ id: f.id, revised_parsed: revised.ok, lost: revised.ok ? revisionPreserves(plan.value, revised.value, f.mentioned) : null, violations: g?.violations ?? null, usage, cost_usd: both });
      }
      process.stdout.write('\n');
    }
  } finally {
    process.off('SIGINT', onInterrupt);
  }

  if (report.partial) console.error(`\nstopped (${report.stopped_by}) after ${completed(report)}; writing the partial table`);
  return save(report, out, { filtered, texts });
}

function completed(report) {
  if (report.ablation) return `${Object.values(report.ablation).reduce((n, a) => n + (a?.runs ?? 0), 0)} of ${report.planned} runs`;
  return `${report.rows.length} of ${report.planned} runs · ${report.followups.length} of ${report.planned_followups} follow-ups`;
}

// The cost of a set of rows: null when none carries usage. Rows recorded
// before 2026-09-23 keep their usage, so the grid is priced back to the first
// keyed run; the follow-ups and the ablation only started keeping usage then.
function priced(rows, cost = (r) => r.cost_usd ?? costUsd(r.usage)) {
  const costs = rows.map(cost).filter((c) => c !== null && c !== undefined);
  if (!costs.length) return { priced: 0, total: null, mean: null, min: null, median: null, max: null };
  const sorted = [...costs].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { priced: costs.length, total: sum(costs), mean: sum(costs) / costs.length, min: sorted[0], median, max: sorted[sorted.length - 1] };
}

export function summarize(report) {
  const rows = report.rows.filter((r) => !r.error);
  const byState = {};
  for (const state of rows.length ? report.states : []) {
    const rs = rows.filter((r) => r.state === state);
    const c = priced(rs);
    byState[state] = {
      runs: rs.length,
      hard_fails: rs.filter((r) => r.hard_fail).length,
      cap: rs.filter((r) => r.violations?.cap_respected?.length).length,
      banned: rs.filter((r) => r.violations?.banned_phrasing?.length).length,
      routing: rs.filter((r) => r.violations?.routing_consistent?.length).length,
      schema: rs.filter((r) => r.violations?.schema_valid?.length).length,
      strategy: rs.filter((r) => r.violations?.strategy_named?.length).length,
      let_go_unique: rs.filter((r) => r.violations?.let_go_unique?.length).length,
      why: rs.filter((r) => r.violations?.why_given?.length).length,
      carried: rs.filter((r) => r.violations?.carried_placed?.length).length,
      cost_per_plan_usd: c.mean,
      cost_usd: c.total,
    };
  }
  const byContract = {};
  for (const c of rows.length ? report.contracts : []) {
    const rs = rows.filter((r) => r.contract === c);
    byContract[c] = { runs: rs.length, native: rs.filter((r) => r.parse === 'native').length, recovered: rs.filter((r) => r.parse === 'recovered').length, failed: rs.filter((r) => r.parse === 'failed').length, cap: rs.filter((r) => r.violations?.cap_respected?.length).length, cost_per_plan_usd: priced(rs).mean };
  }
  const nativeFails = rows.filter((r) => r.contract === 'native' && r.parse === 'failed').length;
  const cacheReads = rows.map((r) => r.usage?.cache_read_input_tokens ?? 0);
  const cacheShare = rows.length ? cacheReads.filter((x) => x > 0).length / rows.length : 0;
  const grid = priced(rows);
  const follow = priced(report.followups.filter((f) => !f.error), (f) => f.cost_usd ?? null);
  const arms = report.ablation ? ['as_written', 'examples_and_bans_removed'].map((a) => report.ablation[a]).filter(Boolean) : [];
  const ablationTotal = arms.length && arms.every((a) => a.cost_usd !== null && a.cost_usd !== undefined) ? sum(arms.map((a) => a.cost_usd)) : null;
  // Cost per plan is one case, one pass; the whole run is every case times
  // every pass, plus the follow-ups and the ablation when they were priced.
  const cost = {
    model: report.model,
    prices: PRICES[report.model] ?? null,
    per_plan_usd: { min: grid.min, median: grid.median, max: grid.max, mean: grid.mean },
    plans_priced: grid.priced,
    plans_unpriced: rows.length - grid.priced,
    grid_usd: grid.total,
    followups_usd: report.followups.length ? follow.total : null,
    followups_priced: follow.priced,
    ablation_usd: report.ablation ? ablationTotal : null,
    run_usd: [grid.total, report.followups.length ? follow.total : null, report.ablation ? ablationTotal : null].some((x) => x !== null) ? sum([grid.total, report.followups.length ? follow.total : null, report.ablation ? ablationTotal : null].filter((x) => x !== null)) : null,
  };
  return { byState, byContract, native_hard_fails: nativeFails, truncated: rows.filter((r) => r.stop_reason === 'max_tokens').length, cache_read_share: cacheShare, mean_ms: rows.length ? Math.round(rows.reduce((n, r) => n + r.ms, 0) / rows.length) : null, errors: report.rows.length - rows.length, cost };
}

/**
 * The tables, one string each, so `scripts/recost.mjs` can rewrite a
 * committed table from its JSON without touching the prose around it. Each
 * is null when the report has nothing for it.
 */
export function renderTables(report) {
  const s = summarize(report);
  const t = { state: null, contract: null, footer: null, followups: null, ablation: null, cost: null };
  if (report.rows.length) {
    // The v3 graders add three rules; a report from before them keeps the
    // columns it was written with, so recost leaves its table as it was.
    const v3 = report.rows.some((r) => r.violations && 'let_go_unique' in r.violations);
    const extraHead = v3 ? ' Let go unique | Why given | Carried placed |' : '';
    const extraRule = v3 ? ' --- | --- | --- |' : '';
    const extra = (v) => (v3 ? ` ${pct(v.let_go_unique, v.runs)} | ${pct(v.why, v.runs)} | ${pct(v.carried, v.runs)} |` : '');
    t.state = [`| ${v3 ? 'Level' : 'State'} | Runs | Hard fails | Cap | Banned phrasing | Routing | Schema | Strategy |${extraHead} Cost per plan (mean, USD) | Cost, all runs (USD) |`, `| --- | --- | --- | --- | --- | --- | --- | --- |${extraRule} --- | --- |`,
      ...Object.entries(s.byState).map(([state, v]) => `| ${state} | ${v.runs} | ${v.hard_fails} | ${pct(v.cap, v.runs)} | ${pct(v.banned, v.runs)} | ${pct(v.routing, v.runs)} | ${pct(v.schema, v.runs)} | ${pct(v.strategy, v.runs)} |${extra(v)} ${usd(v.cost_per_plan_usd)} | ${usd(v.cost_usd)} |`)].join('\n');
    t.contract = ['| Contract | Runs | Native | Recovered | Failed | Cap violations | Cost per plan (mean, USD) |', '| --- | --- | --- | --- | --- | --- | --- |',
      ...Object.entries(s.byContract).map(([c, v]) => `| ${c} | ${v.runs} | ${v.native} | ${v.recovered} | ${v.failed} | ${pct(v.cap, v.runs)} | ${usd(v.cost_per_plan_usd)} |`)].join('\n');
    t.footer = `Hard fail on the native path (valid_json failing): **${s.native_hard_fails}** · cut off at max_tokens (${MAX_TOKENS}): ${s.truncated} of ${report.rows.length} · cache reads on ${pct(Math.round(s.cache_read_share * report.rows.length), report.rows.length)} of runs · mean latency ${s.mean_ms} ms · errors ${s.errors}`;
  }
  if (report.followups.length) {
    t.followups = ['| Conversation | Parsed | Items lost | Cost, both calls (USD) |', '| --- | --- | --- | --- |',
      ...report.followups.map((f) => `| ${f.id} | ${f.error ? f.error : f.revised_parsed ? 'yes' : 'no'} | ${f.lost ? f.lost.length ? f.lost.join('; ') : 'none' : '—'} | ${usd(f.cost_usd)} |`)].join('\n');
  }
  if (report.ablation) {
    const a = report.ablation;
    t.ablation = ['| Arm | Banned phrasing violations | Cap respected | Hard fails | Cut off at max_tokens | Cost, all runs (USD) |', '| --- | --- | --- | --- | --- | --- |',
      ...['as_written', 'examples_and_bans_removed'].filter((arm) => a[arm]).map((arm) => `| ${arm.replace(/_/g, ' ')} | ${a[arm].banned_phrasing}/${a[arm].runs} | ${a[arm].cap_respected}/${a[arm].runs} | ${a[arm].hard_fails} | ${a[arm].truncated ?? 0} | ${usd(a[arm].cost_usd)} |`)].join('\n');
  }
  const c = s.cost;
  const p = c.prices;
  const priceLine = p
    ? `Prices for \`${c.model}\`: $${p.input.toFixed(2)} in, $${p.output.toFixed(2)} out, $${p.cache_write.toFixed(2)} cache write, $${p.cache_read.toFixed(2)} cache read, per million tokens, read ${p.read_on} into \`worker/contracts.js\` as an assumption to re-check against the pricing page before quoting. Output tokens include the model's thinking tokens.`
    : `No price for \`${c.model}\` in \`worker/contracts.js\`; nothing below is priced.`;
  const costRows = [];
  if (report.rows.length) {
    costRows.push(`| Per plan, one case one pass: cheapest / median / dearest (${c.plans_priced} of ${report.rows.filter((r) => !r.error).length} plans priced) | ${c.plans_priced ? `${usd(c.per_plan_usd.min)} / ${usd(c.per_plan_usd.median)} / ${usd(c.per_plan_usd.max)}` : NOT_RECORDED} |`);
    costRows.push(`| Per plan, mean | ${usd(c.per_plan_usd.mean)} |`);
    costRows.push(`| The grid, ${c.plans_priced} plans | ${usd(c.grid_usd)} |`);
  }
  if (report.followups.length) costRows.push(`| Follow-ups, ${report.followups.length} conversations, two calls each | ${usd(c.followups_usd)} |`);
  if (report.ablation) costRows.push(`| Ablation, ${['as_written', 'examples_and_bans_removed'].reduce((n, arm) => n + (report.ablation[arm]?.runs ?? 0), 0)} runs | ${usd(c.ablation_usd)} |`);
  costRows.push(`| Whole run, everything above that was priced | ${usd(c.run_usd)} |`);
  t.cost = ['## Cost', '', priceLine, '', '| Measure | USD |', '| --- | --- |', ...costRows].join('\n');
  return t;
}

function render(report) {
  const t = renderTables(report);
  const lines = [`# Brain Dump evals — ${report.ran_at.slice(0, 10)}${report.partial ? ` · PARTIAL: ${completed(report)}` : ''}`, '', `Model \`${report.model}\` · prompt ${report.prompt_version} · ${report.runs} runs per cell`, ''];
  if (report.partial) lines.push(`Stopped early: ${report.stopped_by}. The rows below are the cells that finished, in fixture order, so a partial table over-represents the first dumps.`, '');
  if (t.state) {
    lines.push(`## Violation rate per rule, per ${t.state.startsWith('| Level') ? 'level' : 'state'}`, '', t.state);
    lines.push('', '## Parse outcome per contract', '', t.contract);
    lines.push('', t.footer);
  }
  if (t.followups) lines.push('', '## Follow-ups: revision preserves', '', t.followups);
  if (t.ablation) {
    lines.push('', `## Ablation · ${report.ablation.fixture} · ${report.ablation.state} · 20 runs per arm`, '', t.ablation);
    lines.push('', 'A tie is a tie. The arms are paired: same dump, same state, same session.');
  }
  lines.push('', t.cost, '');
  return lines.join('\n');
}

async function save(report, dir, { filtered = false, texts = null } = {}) {
  await mkdir(dir, { recursive: true });
  const md = render(report);
  const anxTag = report.anxious?.length === 1 ? (report.anxious[0] ? '-anxious' : '-not_anxious') : '';
  const tag = filtered ? `-${(report.levels ?? report.states).join('+')}${anxTag}-${report.contracts.join('+')}-x${report.runs}`.replace(/\s+/g, '_') : '';
  const stem = `${report.ran_at.slice(0, 10)}${report.ablation ? '-ablation' : ''}${tag}${report.partial ? '-partial' : ''}`;
  if (texts) await writeFile(join(dir, `${stem}-replies.jsonl`), texts.map((t) => JSON.stringify(t)).join('\n') + '\n');
  // Always summarized now: an ablation run has no grid rows but has a cost.
  const full = { ...report, summary: summarize(report) };
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
  const anxiousOpt = opt('anxious', 'off,on').split(',');
  const levels = opt('levels', ENERGY_LEVELS.join(',')).split(',').map((l) => l.trim());
  const unknown = levels.filter((l) => !ENERGY_LEVELS.includes(l));
  if (unknown.length) {
    console.error(`unknown level ${unknown.join(', ')}; the levels are ${ENERGY_LEVELS.join(', ')}`);
    process.exit(2);
  }
  main({
    call: apiCall(apiKey),
    runs: Number(opt('runs', 5)),
    levels,
    anxious: ['off', 'on'].filter((m) => anxiousOpt.includes(m)).map((m) => m === 'on'),
    contracts: opt('contracts', CONTRACTS.join(',')).split(','),
    ablation: args.includes('--ablation'),
    keepText: args.includes('--keep-text'),
    out: opt('out', join(root, 'evals/results')),
  }).then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(1);
  });
}
