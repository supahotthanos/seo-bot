#!/usr/bin/env python3
"""
seo-bot · scrape_pioneers — deep-research scrape of the SEO/AEO pioneers in
research/seo-pioneers/manifest.json. RUN THIS ON THE MAC MINI (residential IP +
scrapling installed) — stealth blog scraping needs it; YouTube transcripts + page
mode work anywhere.

  cd <repo>/seo-bot/scraper
  pip install "scrapling[fetchers]" youtube-transcript-api && scrapling install
  python3 scrape_pioneers.py                 # all (anchors + new)
  python3 scrape_pioneers.py --who metehan   # one person (name substring)
  python3 scrape_pioneers.py --include-honorable

Per target it picks the right fetch.py mode:
  youtube.com/@... or /channel/  → --mode youtube  (channel RSS → transcripts)
  x.com|twitter.com /<user>/status/<id> → --mode tweet  (single tweet)
  x.com|twitter.com /<user>            → SKIPPED (timeline is login-walled; stealth ≠ auth)
  anything else (blog/site)            → --mode stealth (Cloudflare/JS-safe)

Output: research/seo-pioneers/<slug>/<n>-<mode>.json  (+ a combined transcripts.txt
and pages.txt per person for easy reading/feeding into the trust map).
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FETCH = HERE / "fetch.py"
OUT = ROOT / "research" / "seo-pioneers"
MANIFEST = OUT / "manifest.json"
PY = sys.executable or "python3"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")[:48] or "x"


def classify(url):
    u = url.lower()
    if "youtube.com" in u and ("/@" in u or "/channel/" in u or "/c/" in u):
        return "youtube"
    if ("x.com" in u or "twitter.com" in u):
        return "tweet" if "/status/" in u else "x-timeline"
    return "stealth"


def run_fetch(mode, url, timeout=70000, mx=20):
    args = [PY, str(FETCH), "--mode", mode, "--url", url, "--timeout", str(timeout)]
    if mode == "youtube":
        args += ["--max", str(mx)]
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout / 1000 + 90)
        try:
            return json.loads(p.stdout)
        except Exception:
            return {"ok": False, "mode": mode, "url": url, "notes": ["unparseable: " + (p.stdout or p.stderr)[:200]]}
    except subprocess.TimeoutExpired:
        return {"ok": False, "mode": mode, "url": url, "notes": ["timeout"]}


def scrape_person(person, mx):
    name = person.get("name", "?")
    sdir = OUT / slug(name)
    sdir.mkdir(parents=True, exist_ok=True)
    print(f"\n== {name} ({person.get('x','')}) [{person.get('hat','')}] ==")
    transcripts, pages = [], []
    for i, url in enumerate(person.get("targets", []), 1):
        mode = classify(url)
        if mode == "x-timeline":
            print(f"  ~ skip (login-walled timeline): {url}")
            continue
        print(f"  → [{mode}] {url}")
        res = run_fetch(mode, url, mx=mx)
        (sdir / f"{i:02d}-{mode}.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), "utf-8")
        if mode == "youtube":
            got = 0
            for v in res.get("videos", []):
                tr = v.get("transcript", "") or ""
                if tr and not tr.startswith("__no_transcript__"):
                    transcripts.append(f"### {v.get('title','')} ({v.get('url','')})\n{tr}\n")
                    got += 1
            print(f"     {res.get('video_count', 0)} videos, {got} with transcripts")
        elif mode == "stealth" and res.get("ok"):
            html = res.get("html", "")
            text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()
            pages.append(f"### {url}\n{text[:20000]}\n")
            print(f"     {len(text)} chars of text")
        time.sleep(2)  # politeness
    if transcripts:
        (sdir / "transcripts.txt").write_text("\n".join(transcripts), "utf-8")
    if pages:
        (sdir / "pages.txt").write_text("\n".join(pages), "utf-8")
    return {"name": name, "dir": str(sdir), "transcripts": len(transcripts), "pages": len(pages)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--who", default=None, help="name substring filter")
    ap.add_argument("--max", type=int, default=20, help="max videos per channel")
    ap.add_argument("--include-honorable", action="store_true")
    a = ap.parse_args()
    if not MANIFEST.exists():
        sys.exit(f"manifest not found: {MANIFEST}")
    m = json.loads(MANIFEST.read_text("utf-8"))
    people = list(m.get("anchors", [])) + list(m.get("new", []))
    if a.include_honorable:
        people += [{**h, "targets": [v for k, v in h.items() if k in ("youtube", "blog") and v and v.startswith("http")] + ([h["x"].replace("@", "https://x.com/")] if h.get("x", "").startswith("@") else [])} for h in m.get("honorable_mentions", [])]
    if a.who:
        people = [p for p in people if a.who.lower() in p.get("name", "").lower()]
    print(f"Scraping {len(people)} people → {OUT}")
    summary = [scrape_person(p, a.max) for p in people]
    (OUT / "scrape-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), "utf-8")
    print(f"\nDone. {sum(s['transcripts'] for s in summary)} transcripts, {sum(s['pages'] for s in summary)} pages across {len(summary)} people.")
    print(f"Summary → {OUT / 'scrape-summary.json'}")


if __name__ == "__main__":
    main()
