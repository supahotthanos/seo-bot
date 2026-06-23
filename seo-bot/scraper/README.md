# seo-bot · stealth scraper (Scrapling sidecar)

A small Python sidecar the Node bot shells out to for **stealth** fetches —
pages behind Cloudflare / JS walls that the platform-native fetchers can't read.
The cheap modes (tweet / page / rss) also run here, but the Node side
(`../src/research/fetcher.mjs`) normally does those itself with **zero Python**.

Built against **Scrapling 0.4.9** (verified PyPI, 2026-06-07).

## Setup (only needed for stealth mode)

```bash
pip install "scrapling[fetchers]==0.4.9"
scrapling install          # REQUIRED — downloads the Camoufox/Chromium binaries
```

> Skipping `scrapling install` makes `StealthyFetcher` fail silently. Camoufox is
> **not** a transitive pip dependency — `scrapling install` is what provisions it.

## Usage

```bash
python seo-bot/scraper/fetch.py --mode tweet   --url <tweet_id_or_url>
python seo-bot/scraper/fetch.py --mode rss     --url https://www.gsqi.com/feed/
python seo-bot/scraper/fetch.py --mode page    --url https://example.com/post
python seo-bot/scraper/fetch.py --mode stealth --url https://cloudflared.example/post --timeout 60000
```

Each call prints exactly one JSON object on stdout (logs go to stderr).

| mode | engine | use for |
|---|---|---|
| `tweet` | syndication JSON endpoint (no browser) | a single X/Twitter post by id |
| `rss` | HTTP + feedparser | practitioner blog / YouTube channel feeds |
| `page` | `Fetcher.get` (curl_cffi TLS impersonation) | plain HTML / JSON |
| `stealth` | `StealthyFetcher.fetch(solve_cloudflare=True)` | Cloudflare / JS-walled pages |

## The caveats that matter (from the recon)

- **Stealth bypasses bot-detection, NOT login walls.** x.com's logged-out timeline
  and LinkedIn's authwall are *login* walls — no stealth browser defeats them. That's
  why X discovery uses the syndication endpoint + RSS + `site:x.com` SERP reads, not
  the rendered timeline.
- **The syndication endpoint returns ONE tweet** (no threads/timelines/search) and is
  undocumented — best-effort, can change without notice. `token=a` works today; the
  sidecar also tries the yt-dlp deterministic token and retries on empty bodies.
- **Camoufox has degraded** (its own README notes a maintenance gap + weaker fingerprints
  in 2026). Prefer the no-browser paths; treat stealth as escalation, not default.
- **Scrapling isn't magic** — ~58% success / ~29s on hard targets. Budget retries + cache.
  `solve_cloudflare=True` requires `timeout>=60000`.
- **Legal/ToS:** keep it read-only, low-volume, single residential IP, attributed. Public
  data scraping is broadly defensible post-hiQ/Van Buren, but ToS / copyright / GDPR are
  separate live risks. Never inject a logged-in cookie. Reddit: use the approved OAuth
  free tier, not scraping.

## Acquisition ≠ truth

Everything this sidecar returns is a **claim**, not a fact. It flows into the
credibility layer (`../src/research/credibility.mjs`), which tiers the source,
weighs the evidence, requires independent corroboration, and **never lets a scraped
post change the bot's audit rules**. See `../../research/seo-daily/README.md`.
