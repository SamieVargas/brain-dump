#!/usr/bin/env node
// Re-price the committed eval results. Reads every evals/results/<stem>.json
// that has a matching <stem>.md, recomputes the cost cells from the usage the
// JSON already holds and the prices in worker/contracts.js, and rewrites only
// the tables and the Cost section of the .md. The prose around them, the
// header and the JSON itself are left as they are, so a price change or a
// new column never means re-running anything against the API.
//
//   node scripts/recost.mjs            rewrite evals/results/*.md in place
//   node scripts/recost.mjs --check    exit 1 if any .md would change
//   node scripts/recost.mjs --dir=DIR  another results directory

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderTables } from '../evals/run.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The tables are found by their header cell, and a table runs until the
// first line that is not a row. The Cost section runs from its heading to
// the next heading or the end of the file.
const TABLES = [['state', '| State |'], ['contract', '| Contract |'], ['followups', '| Conversation |'], ['ablation', '| Arm |']];

function replaceTable(lines, header, table) {
  const i = lines.findIndex((l) => l.startsWith(header));
  if (i < 0 || !table) return lines;
  let end = i;
  while (end < lines.length && lines[end].startsWith('|')) end += 1;
  return [...lines.slice(0, i), ...table.split('\n'), ...lines.slice(end)];
}

function replaceCost(lines, cost) {
  const i = lines.findIndex((l) => l === '## Cost');
  if (i < 0) {
    // Append, as the runner does: last section, one blank line before it.
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return [...lines, '', ...cost.split('\n'), ''];
  }
  let end = i + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) end += 1;
  while (end > i + 1 && lines[end - 1] === '') end -= 1;
  return [...lines.slice(0, i), ...cost.split('\n'), ...lines.slice(end)];
}

/** Rewrite one .md from its report. Returns the new text. */
export function recostMarkdown(md, report) {
  const t = renderTables(report);
  let lines = md.split('\n');
  for (const [key, header] of TABLES) lines = replaceTable(lines, header, t[key]);
  lines = replaceCost(lines, t.cost);
  return lines.join('\n');
}

/**
 * Re-price every <stem>.json with a <stem>.md beside it. latest.json is an
 * accumulator with no table of its own and is skipped. Returns the stems
 * whose .md changed (or would change, with check).
 */
export async function recost(dir, { check = false } = {}) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json') && n !== 'latest.json').sort();
  const changed = [];
  for (const name of names) {
    const stem = name.slice(0, -5);
    const mdPath = join(dir, `${stem}.md`);
    let md;
    try { md = await readFile(mdPath, 'utf8'); } catch { continue; }
    const report = JSON.parse(await readFile(join(dir, name), 'utf8'));
    const next = recostMarkdown(md, report);
    if (next === md) continue;
    changed.push(stem);
    if (!check) await writeFile(mdPath, next);
  }
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dir = args.find((a) => a.startsWith('--dir='))?.slice(6) ?? join(root, 'evals/results');
  const changed = await recost(dir, { check });
  for (const stem of changed) console.log(`${check ? 'would rewrite' : 'rewrote'} ${join(dir, stem + '.md')}`);
  if (!changed.length) console.log('every results table already carries its cost');
  process.exit(check && changed.length ? 1 : 0);
}
