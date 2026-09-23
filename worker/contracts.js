// The constants the prompts, the schemas, the graders and the client all
// read. One source, so the four buckets, the five energy states and the
// per-state caps cannot drift between the prompt that asks for them and the
// code that checks them.

export const MODEL = 'claude-sonnet-5';
// 4,096, measured on 2026-09-22: at 1,024 Sonnet 5 was cut off on 483 of 500
// native runs, and at 2,048 on 6 of 20. The plans that finished ran 943 to
// 1,966 tokens (median 1,445), and a six-character dump produced 1,544, so the
// length is the model's, not the input's. Unused budget costs nothing; a
// cut-off plan costs the whole call.
export const MAX_TOKENS = 4096;

// List prices in USD per million tokens, the one place the evals and the
// README compute dollars from. Read 2026-09-23 from an offline reference
// dated 2026-06-24 that lists claude-sonnet-5 at $2.00 in and $10.00 out (the
// previous Sonnet generation was $3 / $15, so do not carry that figure over).
// Re-check against https://www.anthropic.com/pricing before quoting these
// anywhere. Cache writes and reads use the standard multipliers on the input
// price (1.25x for a five-minute write, 0.1x for a read).
export const PRICES = Object.freeze({
  'claude-sonnet-5': Object.freeze({ input: 2.0, output: 10.0, cache_write: 2.5, cache_read: 0.2, read_on: '2026-09-23' }),
});

/**
 * Dollars for one call from the `usage` object the API returns, or null
 * when there is no usage to compute from (a row that predates recording,
 * or a call that errored). Every token field the API reports is counted:
 * uncached input, cache writes, cache reads, and output, which on Sonnet 5
 * includes the thinking tokens.
 */
export function costUsd(usage, model = MODEL) {
  const p = PRICES[model];
  if (!p || !usage || typeof usage !== 'object') return null;
  const fields = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];
  if (!fields.some((k) => typeof usage[k] === 'number')) return null;
  const n = (k) => Number(usage[k] ?? 0) || 0;
  const micro = n('input_tokens') * p.input + n('cache_creation_input_tokens') * p.cache_write + n('cache_read_input_tokens') * p.cache_read + n('output_tokens') * p.output;
  return micro / 1e6;
}

export const MODES = Object.freeze(['sort', 'emergency']);
export const ENERGY_STATES = Object.freeze(['overwhelmed', 'scattered', 'anxious', 'low energy', 'foggy']);
export const BUCKETS = Object.freeze(['do_it', 'decide_later', 'capture_it', 'release_it']);
export const OUTPUT_TYPES = Object.freeze(['task_heavy', 'mental_load']);
export const CONTRACTS = Object.freeze(['native', 'prompt']);

// Per-state caps on do_it and on the focus list. These are prompt
// instructions today; the native contract carries the same numbers.
export const CAPS = Object.freeze({
  overwhelmed: { do_it: 5, focus: 3 },
  scattered: { do_it: 5, focus: 3 },
  anxious: { do_it: 3, focus: 2 },
  'low energy': { do_it: 2, focus: 1 },
  foggy: { do_it: 1, focus: 1 },
});

// Phrasing the prompt bans in task and note text. The anxious state bans
// "should" and "need to" outright; the rest of the list holds everywhere.
export const BANNED_PHRASES = Object.freeze({
  all: ['you must', 'you have to', 'just do it', 'stop procrastinating', 'lazy'],
  anxious: ['should', 'need to'],
});

// The strategies the client can expand; the prompt is told to pick from them.
export const STRATEGIES = Object.freeze([
  '5-min rule', 'eat the frog', 'body doubling', 'temptation bundling', 'micro-commitment',
  'physical reset', 'pre-decided task', 'time boxing', 'pair it', 'one gesture',
]);

// The follow-up chips the client offers under a plan.
export const FOLLOW_UP_CHIPS = Object.freeze(['I have 20 minutes', 'Move the first one to tomorrow', 'Done with the top two']);
export const HISTORY_TURN_CAP = 6;
export const DUMP_MAX_CHARS = 8000;
export const FOLLOW_UP_MAX_CHARS = 500;

/** The sort contract as a JSON Schema. Built from the constants above. */
export function sortSchema() {
  const strings = { type: 'array', items: { type: 'string' } };
  return {
    type: 'object',
    properties: {
      output_type: { type: 'string', enum: [...OUTPUT_TYPES] },
      focus_subtitle: { type: 'string' },
      cta_text: { type: 'string' },
      buckets: {
        type: 'object',
        properties: Object.fromEntries(BUCKETS.map((b) => [b, strings])),
        required: [...BUCKETS],
        additionalProperties: false,
      },
      focus: {
        type: 'array',
        items: {
          type: 'object',
          properties: { task: { type: 'string' }, strategy: { type: 'string' } },
          required: ['task', 'strategy'],
          additionalProperties: false,
        },
      },
      gentle_anchor: { type: 'string' },
      gentle_note: { type: 'string' },
    },
    required: ['output_type', 'focus_subtitle', 'cta_text', 'buckets', 'focus', 'gentle_anchor', 'gentle_note'],
    additionalProperties: false,
  };
}

/** The emergency one-thing contract. */
export function emergencySchema() {
  return {
    type: 'object',
    properties: { one_thing: { type: 'string' }, why: { type: 'string' } },
    required: ['one_thing', 'why'],
    additionalProperties: false,
  };
}

/** The hard-coded fallback when the emergency call fails. Never the model's. */
export const EMERGENCY_FALLBACK = Object.freeze({
  one_thing: 'pick the smallest thing on your list and open it. just open it.',
  why: "couldn't reach the sorter, so here's the rule that always works.",
});
