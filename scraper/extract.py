#!/usr/bin/env python3
"""Tiny helper: read a stealth-fetch JSON file, strip its HTML body to plain text,
print TITLE + first N chars. UTF-8 stdout. Used after stealth pulls to triage."""
import json, re, sys, html as htmlmod

if len(sys.argv) < 2:
    print("usage: extract.py <stealth-json> [maxchars]", file=sys.stderr); sys.exit(1)
path = sys.argv[1]
maxc = int(sys.argv[2]) if len(sys.argv) > 2 else 12000

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

raw = open(path, 'rb').read().decode('utf-8', errors='replace')
m = re.search(r'\{.*\}\s*\Z', raw, re.S)
if not m:
    print(f"no JSON object found at end of {path}", file=sys.stderr); sys.exit(2)
d = json.loads(m.group(0))
h = d.get('html', '')
print(f"OK={d.get('ok')} STATUS={d.get('status')} HTML_LEN={len(h)} NOTES={d.get('notes')}")
print(f"URL={d.get('url')}")
if not h:
    sys.exit(0)

tm = re.search(r'<title[^>]*>(.*?)</title>', h, re.S)
title = re.sub(r'<[^>]+>', '', tm.group(1)).strip() if tm else '(no title)'

candidates = [
    r'<article[^>]*>(.*?)</article>',
    r'<div[^>]*entry-content[^>]*>(.*?)</div>\s*</div>',
    r'<main[^>]*>(.*?)</main>',
    r'<div[^>]*post-content[^>]*>(.*?)</div>\s*</div>',
]
body = None
for pat in candidates:
    bm = re.search(pat, h, re.S | re.I)
    if bm:
        body = bm.group(1)
        break
if body is None:
    body = h

body = re.sub(r'<script[^>]*>.*?</script>', ' ', body, flags=re.S | re.I)
body = re.sub(r'<style[^>]*>.*?</style>', ' ', body, flags=re.S | re.I)
body = re.sub(r'<nav[^>]*>.*?</nav>',     ' ', body, flags=re.S | re.I)
body = re.sub(r'<aside[^>]*>.*?</aside>', ' ', body, flags=re.S | re.I)
body = re.sub(r'<footer[^>]*>.*?</footer>',' ', body, flags=re.S | re.I)
body = re.sub(r'<header[^>]*>.*?</header>',' ', body, flags=re.S | re.I)
text = re.sub(r'<[^>]+>', ' ', body)
text = htmlmod.unescape(text).replace('�', ' ')
text = re.sub(r'\s+', ' ', text).strip()

print(f"TITLE: {title}")
print(f"BODY_LEN: {len(text)}")
print("---")
print(text[:maxc])
