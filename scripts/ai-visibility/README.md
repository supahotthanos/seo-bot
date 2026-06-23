# AI Visibility Tracker (no-API)

Measures how **No BS Med Spa Reviews** shows up in AI answer engines the way real
users see them — by driving the actual consumer web apps (ChatGPT, Perplexity,
Google AI Overviews) with a real browser, **not** the API.

This is the same approach Peec / Profound / Otterly use, and the reason they don't
use the API: the API is a different product (no/inconsistent web search, ~25% of
answers carry no sources, only ~4% source overlap with the real ChatGPT UI). To
measure what customers actually see, you must read the consumer surface.

## What it captures

Per prompt × engine: **Visibility** (are we mentioned?), **Position** (rank among
tracked brands by first appearance), **Mentions** (count), and **Citations**
(which URLs the engine pulled, and whether our domain is one of them). It writes a
timestamped JSON to `data/ai-visibility/` and prints a summary table.

## Setup (one time)

```bash
npm install                 # playwright is already a devDependency
npx playwright install chromium
```

## Configure

Edit `scripts/ai-visibility/prompts.json`:
- `brand` / `aliases` / `domain` — what counts as "us"
- `competitors` — who to measure share-of-voice against
- `engines` — `perplexity`, `google_aio`, `chatgpt`
- `prompts` — the buyer queries to track (keep it focused; ~8–20)

## Run

```bash
npm run track:ai                 # headless, default config
HEADFUL=1 npm run track:ai       # watch the browser (recommended — beats anti-bot)
```

### Proxies (recommended for scale / geo)
The engines bot-block and geolocate answers. Run from a residential IP or proxy,
and pin a country:

```bash
PROXY_SERVER=http://gw.proxyprovider.com:7000 \
PROXY_USERNAME=user PROXY_PASSWORD=pass \
HEADFUL=1 npm run track:ai
```

### ChatGPT (needs a logged-in session)
ChatGPT requires auth. Capture a session once, then point the tracker at it:

```bash
# 1. Log in manually; Playwright saves the session to chatgpt-auth.json
npx playwright open --save-storage=chatgpt-auth.json https://chatgpt.com
#    (sign in, then close the window)

# 2. Run with that session + add "chatgpt" to engines[] in prompts.json
CHATGPT_STORAGE=./chatgpt-auth.json HEADFUL=1 npm run track:ai
```
`chatgpt-auth.json` is gitignored — never commit it.

## Output

`data/ai-visibility/<timestamp>.json`:
```json
{
  "summary": {
    "perplexity": { "visibility_pct": 38, "cited_pct": 12, "avg_position": 2.4, "answered": 8 },
    "google_aio": { "visibility_pct": 25, "cited_pct": 25, "avg_position": 1.8, "answered": 6 }
  },
  "results": [ { "engine":"perplexity","prompt":"...","mentioned":true,"position":2,"cited":true,"citedDomains":[...],"competitorsMentioned":[...],"answerExcerpt":"..." } ]
}
```
Re-run weekly and diff the JSONs to track trend + catch new competitor citations.
The `citedDomains` you're NOT in = your source-gap work order.

## Caveats (be honest about these)

- **Selectors drift.** The engines change their DOM often; if an engine returns
  empty, update its selectors in `track.mjs` (each adapter is small + isolated).
- **Anti-bot is real.** Headless from a datacenter IP gets blocked/CAPTCHA'd most.
  Use `HEADFUL=1` + a residential proxy; keep volume modest; add delay.
- **Google AI Overviews** doesn't appear for every query — "no AI Overview shown"
  is a valid (and useful) result, not an error.
- **ToS:** this automates consumer apps. It's a measurement tool for your own
  brand visibility (standard GEO practice) — keep it low-volume and respectful.
