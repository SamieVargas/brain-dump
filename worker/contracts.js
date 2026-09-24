// The constants the prompts, the schemas, the graders and the client all
// read. One source, so the three buckets, the three energy levels and the
// per-level caps cannot drift between the prompt that asks for them and the
// code that checks them.

export const MODEL = 'claude-sonnet-5';
// 4,096, measured on 2026-09-22: at 1,024 Sonnet 5 was cut off on 483 of 500
// native runs, and at 2,048 on 6 of 20. The plans that finished ran 943 to
// 1,966 tokens (median 1,445), and a six-character dump produced 1,544, so the
// length is the model's, not the input's. Unused budget costs nothing; a
// cut-off plan costs the whole call.
//
// 4,096 held on the twenty anxious-state eval dumps (longest reply 3,542),
// then cut off a real overwhelmed-state dump on the live page on 2026-09-23:
// long dumps in the high-cap states run past it, thinking included. Replies
// stream, so there is no request timeout to protect, and 16,000 leaves room
// for the longest dump the Worker accepts (8,000 characters).
export const MAX_TOKENS = 16000;

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

// How hard the model thinks before it answers (output_config.effort). On
// Sonnet 5 thinking is on by default at "high", and latency tracks output
// tokens almost exactly (the 2026-09-24 run: ~1.5 s plus ~11 ms per output
// token, thinking included), so effort is the speed lever. "medium" is the
// default; the Worker's EFFORT var overrides it, and `--effort` on the eval
// runner measures each level before it goes live.
export const EFFORTS = Object.freeze(['low', 'medium', 'high']);
export const DEFAULT_EFFORT = 'medium';
export const effortFrom = (value) => (EFFORTS.includes(value) ? value : DEFAULT_EFFORT);

// Three levels replace the five states of v2: plenty took overwhelmed and
// scattered, a little took anxious without its tone rules, none took low
// energy and foggy. "Feeling anxious" is its own switch now (`anxious` on the
// request) and carries the old anxious tone rules at any level. The names are
// what the page shows; the design's alternates were wired · worried · wiped
// and full tank · half tank · fumes.
export const ENERGY_LEVELS = Object.freeze(['plenty', 'a little', 'none']);
export const BUCKETS = Object.freeze(['now', 'later', 'let_go']);
// The tags the sorter gives a later item. "carried" marks a carry-over the
// person kept from last time; "over cap" and "moved" are added by the page.
export const LATER_TAGS = Object.freeze(['do', 'decide', 'idea', 'carried']);
export const CONTRACTS = Object.freeze(['native', 'prompt']);

// The cap on "now", per level. The prompt asks for it, the schema does not
// clip, and the page clips anything over it into later tagged "over cap".
export const CAPS = Object.freeze({ plenty: 3, 'a little': 2, none: 1 });
// The task timer per level, in minutes; the page reads the same numbers.
export const TIMER_MIN = Object.freeze({ plenty: 25, 'a little': 15, none: 5 });

// Phrasing the prompt bans in task and note text. "Feeling anxious" bans
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

// The re-plan pills the client offers under a plan.
export const FOLLOW_UP_CHIPS = Object.freeze(['I have 20 minutes', 'move this to tomorrow', 'done with the top two']);
export const HISTORY_TURN_CAP = 6;
export const DUMP_MAX_CHARS = 8000;
export const FOLLOW_UP_MAX_CHARS = 500;
// Carry-overs: unfinished items from the last plan the person chose to keep.
export const CARRIED_MAX_ITEMS = 10;
export const CARRIED_MAX_CHARS = 200;

/** The sort contract as a JSON Schema. Built from the constants above. */
export function sortSchema() {
  return {
    type: 'object',
    properties: {
      now: {
        type: 'array',
        items: {
          type: 'object',
          properties: { label: { type: 'string' }, detail: { type: 'string' }, why: { type: 'string' }, strategy: { type: 'string' } },
          required: ['label', 'detail', 'why', 'strategy'],
          additionalProperties: false,
        },
      },
      later: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, tag: { type: 'string', enum: [...LATER_TAGS] } },
          required: ['text', 'tag'],
          additionalProperties: false,
        },
      },
      let_go: { type: 'array', items: { type: 'string' } },
    },
    required: [...BUCKETS],
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
