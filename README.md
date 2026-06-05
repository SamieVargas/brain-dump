# Brain dump

**[try it](https://samievargas.github.io/brain-dump)**

---

## What this is

I built this because I kept having the same problem. I'd sit down to work and my brain would be running 47 tabs at once, some of them tasks, some of them worries, some of them things I felt guilty about not doing yet, and I couldn't figure out which was which. Every productivity app I tried assumed I already knew what I needed to do, but I didn't. I just needed to get it out of my head first.

This is a brain dump tool built specifically for ADHD and ADHD-adjacent brains. You type everything, no filtering, no organizing, no thinking about it. Then the AI reads your dump holistically and sorts it into four buckets: things you have energy for today, things that are real but not for right now, ideas worth keeping, and things that are just weight you're carrying that you can set down. Then it gives you a focus list of 2-3 things matched to how you actually feel that day, with built-in strategies for each one and a Pomodoro timer that queues your tasks automatically so you don't have to decide what's next.

It also noticed I hadn't eaten dinner at 7:30pm and made that my first priority, which is honestly the most helpful thing any productivity tool has ever done for me.

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

## privacy

Your data never leaves your device. The brain dump text goes to the AI to get sorted and is immediately discarded, nothing is logged, stored, or shared anywhere. the only thing that persists locally is your dump count for the streak counter, which lives in your browser's localStorage and goes nowhere.

The code is fully open so you can verify this yourself. There is no database, no accounts, and no analytics.

---

## architecture

```
Your browser
    |
    v
Cloudflare Worker (holds my API key as a secret, never exposed to the browser)
    |
    v
Anthropic API (claude-sonnet-4-6)
    |
    v
structured JSON sorted into buckets, focus list, and energy-matched copy
    |
    v
browser renders the output
```

the Cloudflare Worker is about 30 lines of code and its only job is to keep the API key secret. you can read it in `worker/index.js`. the frontend has no access to the key at any point.

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
