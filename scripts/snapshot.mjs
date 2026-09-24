#!/usr/bin/env node
// Prompt snapshots. The prompt is assembled in code now, so the text the
// model sees is written out per energy level, with the anxious switch off
// and on, and committed; `--check` diffs
// the current assembly against the committed files and fails on drift.
//
//   node scripts/snapshot.mjs           rewrite worker/snapshots/*.txt
//   node scripts/snapshot.mjs --check   fail if any snapshot differs

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENERGY_LEVELS } from '../worker/contracts.js';
import { renderPrompt } from '../worker/prompts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'worker/snapshots');
const check = process.argv.includes('--check');

/** The snapshot file for one level, the anxious switch and a follow-up. */
const snapshotName = (level, { anxious = false, followUp = false } = {}) =>
  `sort-${level.replace(' ', '-')}${anxious ? '-anxious' : ''}${followUp ? '-followup' : ''}.txt`;

const files = [
  ...ENERGY_LEVELS.flatMap((l) => [false, true].flatMap((anxious) => [false, true].map((followUp) =>
    [snapshotName(l, { anxious, followUp }), renderPrompt('sort', l, { anxious, followUp })]))),
  ['emergency.txt', renderPrompt('emergency')],
];

let drift = 0;
await mkdir(dir, { recursive: true });
for (const [name, text] of files) {
  const path = join(dir, name);
  if (check) {
    const on = await readFile(path, 'utf8').catch(() => null);
    if (on !== text) {
      drift += 1;
      console.log(`✗ ${name} ${on === null ? 'is missing' : 'differs'} — run: node scripts/snapshot.mjs`);
    }
  } else {
    await writeFile(path, text);
    console.log(`wrote ${name}`);
  }
}
if (check) {
  if (!drift) console.log(`✓ ${files.length} prompt snapshots match`);
  process.exit(drift ? 1 : 0);
}
