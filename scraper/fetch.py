#!/usr/bin/env python3
"""
seo-bot · Scrapling stealth sidecar.

The Node bot shells out to this for ONE thing the platform-native fetchers can't
do: pull pages behind Cloudflare / JS walls (`--mode stealth`). The cheap modes
(tweet / page / rss) also work here as a Python-only fallback, but the Node side
(seo-bot/src/research/fetcher.mjs) normally does those itself with no Python at all.

Verified against Scrapling 0.4.9 (PyPI, 2026-06-07; Python >=3.10):
  from scrapling.fetchers import Fetcher, AsyncFetcher, StealthyFetcher, DynamicFetcher
  Fetcher.get(url, impersonate='chrome', stealthy_headers=True)         # curl_cffi TLS impersonation
  StealthyFetcher.fetch(url, solve_cloudflare=True, timeout=60000, ...)  # Camoufox anti-bot (needs timeout>=60000)
NOTE: there is NO `PlayWrightFetcher` in 0.4.9 — the browser class is `DynamicFetcher`.

Setup (one time):
  pip install "scrapling[fetchers]"
  scrapling install            # downloads the Camoufox/Chromium browser binaries

If Scrapling isn't installed, tweet/page/rss still work via the stdlib; stealth
returns ok:false with a clear note. Output: exactly one JSON object on stdout.

CAVEATS (do not forget):
  * Stealth bypasses bot-detection, NOT login walls. x.com's logged-out timeline
    and LinkedIn's authwall are login walls — no stealth browser defeats them.
  * The syndication endpoint returns ONE tweet (no threads/timelines/search) and
    is undocumented — best-effort, can change without notice.
  * Read-only, low-volume, attributed. Never inject a logged-in cookie.
"""

import argparse
import json
import math
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz"


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.flush()


def num_to_base36(n):
    """Replicate JS Number.prototype.toString(36) for a float (yt-dlp token math)."""
    if n == 0:
        return "0"
    sign = "-" if n < 0 else ""
    n = abs(n)
    ip = int(n)
    frac = n - ip
    if ip == 0:
        out = "0"
    else:
        out = ""
        while ip > 0:
            out = DIGITS[ip % 36] + out
            ip //= 36
    if frac > 0:
        out += "."
        count = 0
        while frac > 0 and count < 24:
            frac *= 36
            d = int(frac)
            out += DIGITS[d]
            frac -= d
            count += 1
    return sign + out


def syndication_token(tweet_id):
    """yt-dlp's deterministic token: base36((id/1e15)*pi) with '0' and '.' stripped."""
    try:
        val = (int(tweet_id) / 1e15) * math.pi
        return num_to_base36(val).translate(str.maketrans("", "", "0."))
    except Exception:
        return "a"


def _scrapling():
    try:
        from scrapling.fetchers import Fetcher, StealthyFetcher  # noqa
        return Fetcher, StealthyFetcher
    except Exception:
        return None, None


def http_get(url, timeout=20):
    """stdlib GET fallback (no Scrapling). Returns (status, text)."""
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:
        return 0, f"__error__:{e}"


def _as_text(resp):
    """Scrapling Response.body is bytes; decode to str robustly."""
    b = getattr(resp, "body", None)
    if isinstance(b, (bytes, bytearray)):
        return b.decode("utf-8", "replace")
    if isinstance(b, str):
        return b
    t = getattr(resp, "text", None)
    if isinstance(t, str):
        return t
    return str(resp)


def fetch_text(url, timeout, prefer_scrapling=False):
    """page mode: Scrapling Fetcher.get if available, else stdlib. Always returns str."""
    Fetcher, _ = _scrapling()
    if Fetcher is not None:
        try:
            resp = Fetcher.get(url, impersonate="chrome", stealthy_headers=True,
                               timeout=int(timeout / 1000) or 20)
            return getattr(resp, "status", 200), _as_text(resp), True
        except Exception:
            pass
    status, text = http_get(url, timeout=int(timeout / 1000) or 20)
    return status, text, False


def mode_tweet(tweet_id, timeout):
    tid = str(tweet_id).strip().split("/")[-1].split("?")[0]
    notes = []
    for token in ("a", syndication_token(tid)):
        url = f"https://cdn.syndication.twimg.com/tweet-result?id={tid}&lang=en&token={token}"
        status, text, used_scrapling = fetch_text(url, timeout)
        if status == 200 and text and not text.startswith("__error__") and text.strip() not in ("", "{}", "null"):
            try:
                d = json.loads(text)
            except Exception:
                notes.append(f"token={token}: unparseable body")
                continue
            if not d or d.get("__typename") == "TweetTombstone":
                notes.append(f"token={token}: tombstone/empty (deleted/protected/age-gated)")
                continue
            u = d.get("user", {}) or {}
            return {
                "ok": True, "mode": "tweet", "id": tid, "fetched_at": now_iso(),
                "used_stealth": False, "via": "scrapling" if used_scrapling else "stdlib",
                "text": d.get("text", ""),
                "created_at": d.get("created_at"),
                "user": {"screen_name": u.get("screen_name"), "name": u.get("name"),
                         "verified": bool(u.get("verified") or u.get("is_blue_verified"))},
                "favorite_count": d.get("favorite_count"),
                "conversation_count": d.get("conversation_count"),
                "urls": [e.get("expanded_url") for e in (d.get("entities", {}) or {}).get("urls", []) if e.get("expanded_url")],
                "photos": [p.get("url") for p in (d.get("photos") or []) if p.get("url")],
                "notes": notes,
            }
        notes.append(f"token={token}: status={status}")
    return {"ok": False, "mode": "tweet", "id": tid, "fetched_at": now_iso(),
            "notes": notes + ["syndication endpoint returned no tweet (try stealth mode on the x.com URL, ToS-restricted)"]}


def _looks_blocked(html, status):
    """A challenge/consent/empty page is NOT real data. Return (blocked, why) so callers can set
    ok=False — otherwise serp.mjs/geogrid.mjs persist a blocked scrape as genuine 'not ranking'."""
    try:
        if int(status) in (401, 403, 407, 429, 503): return True, "status=%s" % status
    except Exception:
        pass
    low = (html or "").lower()
    if not low.strip(): return True, "empty body"
    for sig in ("unusual traffic", "detected unusual", "are you a robot", "verify you are human",
                "verify you're human", "enable javascript and cookies", "/sorry/index",
                "before you continue to google", "just a moment", "checking your browser",
                "cf-challenge", "cf_chl_", "px-captcha", "g-recaptcha", "hcaptcha"):
        if sig in low: return True, sig
    return False, ""


def mode_page(url, timeout):
    status, text, used_scrapling = fetch_text(url, timeout)
    ok = status == 200 and bool(text) and not text.startswith("__error__")
    blocked, why = _looks_blocked(text, status) if ok else (False, "")
    if blocked: ok = False
    return {"ok": ok, "mode": "page", "url": url, "status": status, "fetched_at": now_iso(),
            "used_stealth": False, "via": "scrapling" if used_scrapling else "stdlib",
            "blocked": blocked, "html": text if ok else "",
            "notes": ([f"blocked: {why}"] if blocked else []) if not (ok) else []}


def mode_stealth(url, timeout, proxy=None):
    _, StealthyFetcher = _scrapling()
    if StealthyFetcher is None:
        return {"ok": False, "mode": "stealth", "url": url, "fetched_at": now_iso(),
                "notes": ['Scrapling not installed. Run: pip install "scrapling[fetchers]" && scrapling install']}
    t = max(int(timeout), 60000)  # solve_cloudflare requires >=60000
    try:
        page = StealthyFetcher.fetch(url, headless=True, network_idle=True,
                                     solve_cloudflare=True, timeout=t, block_ads=True,
                                     google_search=True, proxy=proxy)
        html = _as_text(page)
        status = getattr(page, "status", 200) or 200
        blocked, why = _looks_blocked(html, status)
        if blocked:
            return {"ok": False, "mode": "stealth", "url": url, "status": status,
                    "fetched_at": now_iso(), "used_stealth": True, "via": "scrapling",
                    "blocked": True, "html": "", "notes": [f"blocked: {why} (challenge/consent — NOT a real result)"]}
        return {"ok": True, "mode": "stealth", "url": url, "status": status,
                "fetched_at": now_iso(), "used_stealth": True, "via": "scrapling",
                "blocked": False, "html": html, "notes": ["stealth bypasses bot-detection, not login walls"]}
    except Exception as e:
        return {"ok": False, "mode": "stealth", "url": url, "fetched_at": now_iso(),
                "used_stealth": True, "notes": [f"StealthyFetcher failed: {e}"]}


def mode_rss(url, timeout):
    status, text, used_scrapling = fetch_text(url, timeout)
    items = []
    if status == 200 and text and not text.startswith("__error__"):
        try:
            import feedparser  # optional
            feed = feedparser.parse(text)
            for e in feed.entries[:40]:
                items.append({"title": e.get("title", ""), "link": e.get("link", ""),
                              "published": e.get("published", ""), "summary": (e.get("summary", "") or "")[:600]})
        except Exception:
            # minimal stdlib XML fallback
            import re
            for m in re.finditer(r"<(?:item|entry)\b.*?</(?:item|entry)>", text, re.S | re.I):
                blk = m.group(0)
                t = re.search(r"<title[^>]*>(.*?)</title>", blk, re.S | re.I)
                l = re.search(r'<link[^>]*href="([^"]+)"', blk) or re.search(r"<link[^>]*>(.*?)</link>", blk, re.S | re.I)
                items.append({"title": re.sub(r"<[^>]+>", "", (t.group(1) if t else "")).strip(),
                              "link": (l.group(1) if l else "").strip(), "published": "", "summary": ""})
                if len(items) >= 40:
                    break
    return {"ok": bool(items), "mode": "rss", "url": url, "status": status,
            "fetched_at": now_iso(), "used_stealth": False, "items": items,
            "notes": [] if items else [f"no items (status={status})"]}


def _resolve_channel_id(url, timeout):
    """Resolve a YouTube channel handle/url/id → UC... channel id."""
    import re
    u = (url or "").strip()
    if re.fullmatch(r"UC[0-9A-Za-z_-]{20,}", u):
        return u
    if not u.startswith("http"):
        u = "https://www.youtube.com/" + (u if u.startswith("@") else "@" + u.lstrip("@"))
    _, text, _ = fetch_text(u, timeout)
    m = (re.search(r'"channelId":"(UC[0-9A-Za-z_-]{20,})"', text)
         or re.search(r'"externalId":"(UC[0-9A-Za-z_-]{20,})"', text)
         or re.search(r'channel/(UC[0-9A-Za-z_-]{20,})', text))
    return m.group(1) if m else None


def mode_youtube(url, timeout, max_videos=15):
    """Channel handle/url → recent video ids+titles (via RSS) → transcripts."""
    import re
    cid = _resolve_channel_id(url, timeout)
    if not cid:
        return {"ok": False, "mode": "youtube", "url": url, "fetched_at": now_iso(),
                "notes": ["could not resolve channelId from " + str(url)]}
    rss = f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
    _, text, _ = fetch_text(rss, timeout)
    vids = []
    for m in re.finditer(r"<yt:videoId>([\w-]+)</yt:videoId>.*?<title>(.*?)</title>", text, re.S):
        vids.append({"id": m.group(1), "title": re.sub(r"<[^>]+>", "", m.group(2)).strip()})
        if len(vids) >= max_videos:
            break
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        have_api = True
    except Exception:
        have_api = False
    out = []
    for v in vids:
        tr = ""
        if have_api:
            try:
                segs = YouTubeTranscriptApi.get_transcript(v["id"], languages=["en", "en-US", "en-GB"])
                tr = " ".join(s.get("text", "") for s in segs)
            except Exception as e:
                tr = f"__no_transcript__:{e}"
        out.append({"id": v["id"], "title": v["title"],
                    "url": f"https://www.youtube.com/watch?v={v['id']}", "transcript": tr})
    return {"ok": bool(out), "mode": "youtube", "channel_id": cid, "url": url,
            "fetched_at": now_iso(), "video_count": len(out), "videos": out,
            "notes": [] if have_api else ["youtube-transcript-api not installed: "
                                          "pip install youtube-transcript-api (transcripts empty without it)"]}


def main():
    ap = argparse.ArgumentParser(description="seo-bot Scrapling stealth sidecar")
    ap.add_argument("--mode", required=True, choices=["tweet", "page", "stealth", "rss", "youtube"])
    ap.add_argument("--url", required=True, help="URL/tweet-id (tweet) or channel handle/url/id (youtube)")
    ap.add_argument("--timeout", type=int, default=30000)
    ap.add_argument("--max", type=int, default=15, help="max videos for --mode youtube")
    ap.add_argument("--proxy", default=None)
    a = ap.parse_args()
    # Scrapers run on the Mac Mini (residential IP). Cheap modes still work
    # anywhere (with a nudge); stealth is Mac-only since it needs a residential IP.
    import platform, os as _os
    off_mac = platform.system() != "Darwin" and _os.environ.get("ALLOW_NON_MAC") != "1"
    if off_mac:
        sys.stderr.write("[fetch.py] note: scraping belongs on the Mac Mini "
                         "(residential IP), not this host.\n")
    try:
        if a.mode == "tweet":
            emit(mode_tweet(a.url, a.timeout))
        elif a.mode == "page":
            emit(mode_page(a.url, a.timeout))
        elif a.mode == "stealth":
            if off_mac:
                emit({"ok": False, "mode": "stealth", "url": a.url, "fetched_at": now_iso(),
                      "notes": ["stealth scraping is Mac-Mini-only (residential IP); "
                                "run seo-bot on the Mac. Set ALLOW_NON_MAC=1 to override."]})
            else:
                emit(mode_stealth(a.url, a.timeout, a.proxy))
        elif a.mode == "rss":
            emit(mode_rss(a.url, a.timeout))
        elif a.mode == "youtube":
            emit(mode_youtube(a.url, a.timeout, a.max))
    except Exception as e:
        emit({"ok": False, "mode": a.mode, "url": a.url, "fetched_at": now_iso(), "notes": [f"fatal: {e}"]})


if __name__ == "__main__":
    main()
