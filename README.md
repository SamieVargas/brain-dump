# Brain dump

**[Try it](https://samievargas.github.io/brain-dump)**

---

## What this is

I built this because I kept having the same problem. I'd sit down to work and my brain would be running 47 tabs at once, some of them tasks, some of them worries, some of them things I felt guilty about not doing yet, and I couldn't figure out which was which. Every productivity app I tried assumed I already knew what I needed to do, but I didn't. I just needed to get it out of my head first.

This is a brain dump tool built specifically for ADHD and ADHD-adjacent brains. You type everything, no filtering, no organizing, no thinking about it. Then the AI reads your dump holistically and sorts it into four buckets: things you have energy for today, things that are real but not for right now, ideas worth keeping, and things that are just weight you're carrying that you can set down. Then it gives you a focus list of 2-3 things matched to how you actually feel that day, with built-in strategies for each one and a Pomodoro timer that queues your tasks automatically so you don't have to decide what's next.

It also noticed I hadn't eaten dinner at 7:30pm and made that my first priority, which is honestly the most helpful thing any productivity tool has ever done for me.

---

## How it works, technically

Brain Dump works directly against the Anthropic Messages API with no framework, routing calls through a Cloudflare Worker so the key never touches the browser, and most of the real work is in a dynamic system prompt that changes its rules, caps, and tone based on the energy state the user picks, then forces a strict JSON contract that the frontend parses and renders straight from, which is prompt-enforced structured output. The model does the classification, sorting every item into one of four buckets and deciding whether the dump is task-heavy or mental-load so the UI can branch on that, and there is a second prompt and schema for an emergency one-thing mode with a hard-coded fallback if the call fails. Early users' feedback drove a single-step simplification to the capture flow. It is a single-turn structured generation, so there is no tool calling, retrieval, or agent loop in it, and I would rather say that plainly.

## v2

The first version built its prompts in the browser and sent them to the Worker, which forwarded whatever it was given. That meant anyone who could reach the Worker could run any prompt on my key, and it meant nothing about the prompt could be tested or cached, because the server never knew what it was. v2 moves the prompts behind the Worker and adds the four smallest real steps after that: the plan becomes a conversation, the JSON contract moves to the API's structured output with the old parser as a fallback, responses stream, and the prompt's rules get a regression suite graded in code. It stays a multi-turn LLM feature rather than an agent: the model never does anything except return the next plan.

**Prompts live on the Worker.** The page posts `{ mode, energy_state, dump, history?, stream? }` and nothing else. The Worker checks every field against a whitelist and the enums, rejects anything unknown, clamps the dump at 8,000 characters, and assembles the system prompt from `worker/prompts.js`. The rules are the ones the page carried before, moved without changing their substance, because the evals have to measure them as they are before anyone tunes them. The assembled prompt per energy state is committed under `worker/snapshots/`, and `npm test` fails if the assembly drifts from the snapshot.

**The endpoint is public now, so it has doors.** A per-address rate limit (20 requests per 10 minutes, through Cloudflare's rate limiting binding, with an in-memory fallback), the size caps, a daily token budget that turns into a "resting until tomorrow" message and never a stack trace, and a session token the page fetches on load and attaches to every request, signed by the Worker with no state to keep. Logs carry mode, energy state, sizes, model, usage and timings, never the dump, the plan or the history, and a test asserts it. `npm run load-test` runs the handler in Node with a stub upstream, so it costs nothing:

| 200 requests from 5 addresses in one burst, budget 50,000 tokens | |
|---|---|
| Served | 27 |
| Refused, no session token | 1 (the scripted caller) |
| Refused, rate limit | 100 |
| Refused, daily budget | 73 |
| Spend | capped at 51,300 tokens against a burst that would have spent about 380,000 |

**Re-planning.** Under the plan there is one input and three chips: "I have 20 minutes", "Move the first one to tomorrow", "Done with the top two". A follow-up sends the conversation so far, the original dump as the first user turn, each plan as the assistant's own JSON, each follow-up as a user turn, capped to the last six turns with the current plan always kept. The Worker adds one rule (revise the plan, keep every item the user did not mention, return the full plan under the same contract). The energy state can change mid-conversation and the caps and tone follow it. State lives on the page and in `sessionStorage`; coming back to the tab shows the last plan.

**Native structured output, parser kept as fallback.** The Worker asks the API for the JSON schema built from the same constants that define the buckets, the output types and the per-state caps (`output_config.format`, no beta header on current models). The fence-stripping parser stays as the fallback and the Worker records which path handled each response. `CONTRACT=prompt` on the Worker, or `contract` on a request, runs the old way so the evals can score both.

**Streaming.** The Worker proxies the API's server-sent events to the page, which fills a small live pane as deltas arrive and renders on the last event, then appends one event of its own with the usage and the parse path. The page keeps time to first token and time to render for its last ten sorts in `sessionStorage` and logs them to the console, so the change can be measured on real dumps once the Worker is deployed. The numbers are not in this README yet, because measuring them needs the deployed Worker and a key.

**Prompt caching.** The static part of the system prompt (the job, every state's rules, the contract, about 1,800 tokens) carries the cache marker; the per-request part (which state, and the follow-up rule) comes after it. Sonnet 5's minimum cacheable prefix is 1,024 tokens, so this is not a no-op. `cache_read_input_tokens` is logged on every call and reported by the evals as the share of runs that read from cache.

**Evals, rule-graded, no labels.** Twenty dumps in `evals/fixtures/dumps/` written to stress the rules (lists over the cap, items that invite "should", mixed task and mental-load content, an almost-empty dump, a dump that only makes sense as a single anchor, two with instruction-shaped lines inside them) and five follow-up conversations. Every grader is deterministic: `valid_json` (native, recovered, failed), `schema_valid`, `cap_respected`, `banned_phrasing` (the list comes from the prompt constants), `routing_consistent`, `strategy_named`, `emergency_one_thing`, `revision_preserves`. `npm run evals` runs every dump under all five states and both contracts, five runs each, plus the follow-ups, and writes the violation rate per rule per state and the parse outcome per contract to `evals/results/`; a `valid_json` failure on the native path is the hard fail. `npm run evals:ablation` runs twenty pairs on one dump with the examples and the banned-phrasing block removed from the prompt, and reports `banned_phrasing` and `cap_respected` per arm; a tie is reported as a tie. The graders and the fixtures are proven offline on every `npm test`; the numbers need a key and are not in this repo yet.

**What is not in v2.** No tool calling, no retrieval, no framework, no accounts, no server-side storage of anything a person wrote. The model pin is `claude-sonnet-5`, the current generation of the tier v1 ran on.

---

## How it works

1. Pick how you're feeling right now (overwhelmed, scattered, anxious, low energy, or foggy, they each produce different output)
2. Start a timer and type everything on your mind, no filtering, no fixing
3. Hit sort it out and the AI reads and sorts your whole dump at once
4. Get a focus list tailored to your energy state with expandable strategy tips
5. Start the first one, the Pomodoro timer loads your tasks in order so you just have to show up

There's also an emergency mode if you just need one thing to do right now, which is honestly most of the time

---

## Why the energy states matter

Most productivity tools treat you the same way on a bad Tuesday as they do on a good Monday, but this one doesn't. Overwhelmed gets you 5 tasks max and grounding language, while anxious gets you 2 tasks and no "should" or "need to" anywhere. Foggy gets you literally one physical gesture and really warm copy because that's all you can do when you're foggy, and low energy protects you from decision tasks entirely because decisions are cognitively expensive when you have nothing left.

The buckets also adapt. Things you'd normally put on a to-do list sometimes belong in "release it" instead, especially the worries and guilt and "what will people think" thoughts that take up space but aren't actually actionable. Those get reframed as release statements, not just listed as anxieties.

---

## Privacy

Your data never leaves your device. The brain dump text goes to the AI to get sorted and is immediately discarded, nothing is logged, stored, or shared anywhere. the only thing that persists locally is your dump count for the streak counter, which lives in your browser's localStorage and goes nowhere.

The code is fully open so you can verify this yourself. There is no database, no accounts, and no analytics.

---

## Architecture

```
Your browser
    |
    v
Cloudflare Worker (holds my API key as a secret, never exposed to the browser)
    |
    v
Anthropic API (claude-sonnet-5)
    |
    v
structured JSON sorted into buckets, focus list, and energy-matched copy
    |
    v
browser renders the output
```

the Cloudflare Worker keeps the API key secret and, since v2, owns the prompts, the rate limit, the budget and the session tokens. you can read it in `worker/index.js`. the frontend has no access to the key at any point.

---

## Deploy your own

**1. Fork this repo**

**2. Deploy the Cloudflare Worker**

```bash
npm install -g wrangler
cd worker
wrangler login
wrangler deploy
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SESSION_SECRET      # openssl rand -base64 32; signs the page's session tokens
```

Paste your Anthropic API key when prompted, and copy the worker URL it gives you.

**3. Update the worker URL in index.html**

Find this line near the top of the script block and replace it with your URL:

```js
const WORKER_URL = "https://brain-dump-proxy.YOUR-SUBDOMAIN.workers.dev";
```

**4. Enable GitHub Pages**

Repo settings -> Pages -> source: main branch, / root. your app will be live at `https://YOUR-USERNAME.github.io/brain-dump`

Note: if you're on Windows ARM, Wrangler won't install via npm. use WSL2 with Ubuntu instead, that's what I did.

---

## Cost

About $0.01 to $0.02 per sort at roughly 2,000 to 3,000 tokens each. Cloudflare Workers free tier covers 100,000 requests per day. for personal use you're probably looking at under $5 a month even if you use it a lot.

---

## What I'd build next

- Shareable output card that looks good as a screenshot
- Optional history so you can see patterns over time
- Dark mode
- Mobile-native feel, it works on mobile now but wasn't designed for it first

---

## Built with:
- Vanilla HTML, CSS, JS, no framework, no build step, one file
- [Anthropic API](https://anthropic.com) using claude-sonnet-4-6
- [Cloudflare Workers](https://workers.cloudflare.com) for the API proxy
- [Playfair Display](https://fonts.google.com/specimen/Playfair+Display) and [DM Sans](https://fonts.google.com/specimen/DM+Sans) from Google Fonts
- [Tabler Icons](https://tabler.io/icons)

---

Built by [Samie Vargas](https://samievargas.github.io) · [LinkedIn](https://linkedin.com/in/samievargas12) · [Kaggle](https://kaggle.com/samievargas)
