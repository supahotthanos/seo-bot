#!/usr/bin/env python3
"""Reddit intel via STEALTH (Scrapling StealthyFetcher / Camoufox) on old.reddit.com.
Reddit's .json is hard-403'd even through a browser, but old.reddit HTML returns 200
via Camoufox (it solves the JS wall). Runs on the Mac Mini (residential IP), ~/seo-stealth venv.
Ranks people by TOPICAL CONCENTRATION (share of their activity in SEO/marketing subs) +
in-thread score, not raw karma — so it surfaces actual SEO practitioners, not generalists who
wandered into r/SEO once. Everything here is a CLAIM, not a fact."""
import json, sys, re, time, urllib.parse
from datetime import datetime, timezone
from bs4 import BeautifulSoup
from scrapling.fetchers import StealthyFetcher

NOW = datetime.now(timezone.utc).timestamp()
BUDGET, USED = 58, 0
SUBS = ["SEO", "bigseo", "juststart"]
SEO_SUBS = {"SEO", "bigseo", "juststart", "TechSEO", "Agentic_SEO", "SEO_Xpert", "grumpyseoguy",
            "localseo", "PPC", "marketing", "digital_marketing", "content_marketing", "DigitalMarketing",
            "GoogleMyBusiness", "GoogleBusinessProfile", "Entrepreneur", "smallbusiness", "SaaS", "ecommerce",
            "Wordpress", "webdev", "analytics", "advertising", "AskMarketing", "marketingautomation", "Affiliatemarketing"}
QUERIES = ["AEO answer engine optimization", "generative engine optimization", "ChatGPT citations SEO",
           "AI overviews traffic", "Search Atlas OTTO", "med spa SEO", "programmatic SEO", "local SEO map pack"]
RELEVANT = re.compile(r"\b(seo|rank|google|search|gbp|business profile|llm|chatgpt|perplexity|aeo|geo|"
                      r"citation|schema|backlink|med ?spa|local pack|ai overview|otto|search atlas|crawl|serp)\b", re.I)
WATCH = ["glenn gabe", "aleyda", "cyrus shepard", "lily ray", "marie haynes", "barry schwartz", "rand fishkin",
         "kevin indig", "mike king", "ipullrank", "koray", "metehan", "search atlas", "otto", "surfer",
         "frase", "ahrefs", "semrush", "screaming frog", "profound", "peec", "athenahq", "brightlocal", "rankmath"]
mentions = {}
def note(t):
    for u in re.findall(r"(?:^|\s)/?u/([A-Za-z0-9_-]{3,20})", t or ""): mentions[u.lower()] = mentions.get(u.lower(), 0) + 1
    low = (t or "").lower()
    for w in WATCH:
        if w in low: mentions["~" + w] = mentions.get("~" + w, 0) + 1

def fetch(url):
    global USED
    if USED >= BUDGET: return None
    USED += 1
    for attempt in range(2):
        try:
            p = StealthyFetcher.fetch(url, solve_cloudflare=True, headless=True, network_idle=True, timeout=90000)
            b = getattr(p, "body", b"") or b""
            if isinstance(b, (bytes, bytearray)): b = b.decode("utf-8", "replace")
            t = b or str(p)
            if "theme-beta" in t[:300] and len(t) < 200000:
                print(f"[blocked] {url[:70]}", file=sys.stderr); time.sleep(3); continue
            return t
        except Exception as e:
            print(f"[err] {str(e)[:80]} {url[:60]}", file=sys.stderr); time.sleep(3)
    return None

def txt(el): return el.get_text(" ", strip=True) if el else ""
def num(s):
    m = re.search(r"-?\d[\d,]*", s or ""); return int(m.group(0).replace(",", "")) if m else 0
def bare(s): return re.sub(r"^/?r/", "", (s or "").strip())

# 1) SEARCH SEO subs -> threads
posts = {}
print("=== search ===", file=sys.stderr)
for sub in SUBS:
    for q in QUERIES:
        if USED >= 16: break
        html = fetch(f"https://old.reddit.com/r/{sub}/search?q={urllib.parse.quote(q)}&restrict_sr=1&sort=top&t=year&limit=12")
        if not html: continue
        soup = BeautifulSoup(html, "lxml")
        for r in soup.select(".search-result-link"):
            a = r.select_one("a.search-title"); cm = r.select_one("a.search-comments")
            if not cm: continue
            link = cm.get("href", "")
            pid = link.rstrip("/").split("/comments/")[-1].split("/")[0] if "/comments/" in link else link
            posts[pid] = {"id": pid, "title": txt(a), "permalink": link, "sub": bare(txt(r.select_one(".search-subreddit-link"))),
                          "author": txt(r.select_one(".search-author")).replace("by ", ""),
                          "score": num(txt(r.select_one(".search-score"))), "comments": num(txt(cm))}
            note(txt(a))
print(f"  {len(posts)} threads", file=sys.stderr)

# 2) THREADS -> comments -> authors
authors = {}
print("=== threads ===", file=sys.stderr)
for p in sorted(posts.values(), key=lambda p: p["score"] + p["comments"] * 2, reverse=True):
    if USED >= 38: break
    html = fetch(p["permalink"] + "?limit=40&sort=top")
    if not html: continue
    soup = BeautifulSoup(html, "lxml")
    for c in soup.select("div.thing.comment")[:30]:
        a = c.get("data-author") or ""
        body = txt(c.select_one(".entry .md"))
        note(body)
        if not a or a in ("[deleted]", "AutoModerator") or len(body) < 90 or not RELEVANT.search(body): continue
        sc = c.select_one(".score.unvoted")
        score = num(sc.get("title") or txt(sc)) if sc else 0
        r = authors.setdefault(a, {"author": a, "comments": [], "score_sum": 0, "n": 0})
        r["comments"].append({"score": score, "len": len(body), "sub": p["sub"], "body": body[:700], "thread": p["title"]})
        r["score_sum"] += max(score, 0); r["n"] += 1
print(f"  {len(authors)} authors", file=sys.stderr)

# 3) PROFILE a wide pool, then rank by TOPICAL CONCENTRATION
pool = sorted(authors.values(), key=lambda r: r["score_sum"] + r["n"] * 3, reverse=True)[:20]
print(f"=== profiling {len(pool)} ===", file=sys.stderr)
for r in pool:
    r["seo_focus"] = 0.0
    if USED >= BUDGET: continue
    html = fetch(f"https://old.reddit.com/user/{urllib.parse.quote(r['author'])}/")
    if not html: continue
    soup = BeautifulSoup(html, "lxml")
    pk = soup.select_one("span.karma:not(.comment-karma)"); ck = soup.select_one("span.comment-karma")
    age_el = soup.select_one(".age time")
    r["comment_karma"] = num(txt(ck)); r["link_karma"] = num(txt(pk))
    if age_el and age_el.get("datetime"):
        try: r["age_years"] = round((NOW - datetime.fromisoformat(age_el["datetime"].replace("Z", "+00:00")).timestamp()) / (365 * 86400), 1)
        except Exception: pass
    subs = {}
    for th in soup.select("div.thing"):
        s = bare(th.get("data-subreddit") or "")
        if s: subs[s] = subs.get(s, 0) + 1
    total = sum(subs.values()) or 1
    r["seo_focus"] = round(sum(v for s, v in subs.items() if s in SEO_SUBS) / total, 2)
    r["seo_subs"] = [s for s, _ in sorted(subs.items(), key=lambda x: -x[1]) if s in SEO_SUBS][:8]
    r["profile_subs"] = [s for s, _ in sorted(subs.items(), key=lambda x: -x[1])][:8]

def composite(r):
    sub220 = sum(1 for c in r["comments"] if c["len"] > 220)
    return round(r["score_sum"] + 60 * r.get("seo_focus", 0) + min(r.get("comment_karma") or 0, 5000) / 600 + sub220 * 5, 1)
for r in pool: r["quality"] = composite(r)
focused = [r for r in pool if r.get("seo_focus", 0) >= 0.12 or r.get("seo_subs")]
final = sorted(focused or pool, key=lambda r: r["quality"], reverse=True)[:12]

def ser(r):
    best = sorted(r["comments"], key=lambda c: c["score"], reverse=True)[:2]
    return {"author": r["author"], "quality": r["quality"], "seo_focus": r.get("seo_focus"), "in_thread_score": r["score_sum"],
            "n": r["n"], "comment_karma": r.get("comment_karma"), "age_years": r.get("age_years"),
            "seo_subs": r.get("seo_subs") or [], "profile_subs": r.get("profile_subs") or [],
            "top_comments": [{"score": c["score"], "sub": c["sub"], "thread": c["thread"], "excerpt": c["body"][:430]} for c in best]}

people = [ser(r) for r in final]
bigger = sorted([p for p in people if p.get("comment_karma")], key=lambda p: p["comment_karma"], reverse=True)[:10]
referenced = sorted(mentions.items(), key=lambda x: -x[1])[:30]
out = {"generated": datetime.now(timezone.utc).isoformat(), "source": "STEALTH Camoufox on old.reddit.com",
       "fetches": USED, "threads": len(posts), "people": people, "bigger_people": bigger,
       "referenced": referenced, "top_threads": sorted(posts.values(), key=lambda p: p["score"], reverse=True)[:25]}
open("reddit-intel.json", "w").write(json.dumps(out, indent=2))

L = ["# Reddit intel (STEALTH) — med-spa SEO + AEO + Search Atlas/OTTO",
     f"_{out['generated']} · Scrapling StealthyFetcher/Camoufox on old.reddit · {USED} stealth fetches · Mac Mini residential IP_", "",
     "> CLAIMS, not facts. Ranked by topical concentration (share of the author's activity in SEO/marketing subs) + in-thread score, with real old.reddit karma. SEO-focus shown so generalists are visible as such.", "",
     "## People who know what they're talking about (ranked)\n"]
for p in people:
    L.append(f"### u/{p['author']} · quality {p['quality']} · SEO-focus {int((p.get('seo_focus') or 0)*100)}% · {p.get('comment_karma')} comment-karma · {p.get('age_years')}y")
    L.append(f"- SEO/mktg subs: {', '.join('r/'+s for s in p['seo_subs']) or '— (generalist who commented in r/SEO)'} · all-subs: {', '.join('r/'+s for s in p['profile_subs'][:6])}")
    for c in p["top_comments"]:
        L.append(f"- _(+{c['score']}, on \"{c['thread'][:70]}\")_: {c['excerpt']}")
    L.append("")
L.append("## Bigger voices (highest comment-karma)\n")
for p in bigger: L.append(f"- u/{p['author']} — {p['comment_karma']} comment-karma, {p.get('age_years')}y, SEO-focus {int((p.get('seo_focus') or 0)*100)}%")
L.append("\n## Most-referenced experts / tools (in the threads)\n")
for name, n in referenced: L.append(f"- {'expert/tool: ' if name.startswith('~') else 'u/'}{name.lstrip('~')} — {n}×")
L.append("\n## Top threads\n")
for t in out["top_threads"]:
    url = ("https://old.reddit.com" + t["permalink"]) if t["permalink"].startswith("/") else t["permalink"]
    L.append(f"- [{t['score']}↑/{t['comments']}💬] r/{t['sub']} — {t['title']}\n  {url}")
open("reddit-intel.md", "w").write("\n".join(L))
print(f"DONE fetches={USED} threads={len(posts)} authors={len(authors)} people={len(people)}")
