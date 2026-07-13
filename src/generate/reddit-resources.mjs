// seo-bot · generate/reddit-resources — the "Reddit-resources page" play (Edward Show
// E1091, Callum Kennard/ClickSlice — verified operator source, see KB
// operators/edward-show-e1091-geo-vs-seo): searchers type "best <keyword> reddit"
// WITHOUT site:reddit.com, so the client's OWN domain can rank for those queries with
// a curated /<topic>-reddit-resources page — real Reddit threads, hand-verified, plus
// a brand-context block ("what llms.txt should have been"). White-hat, owned pages.
//
// HARD REFUSALS (fail-closed):
//   · NO fabricated Reddit URLs, EVER — thread candidates come only from real artifacts
//     already on disk (sources/measure/fanout captures), each with {url, foundIn}
//     provenance; a topic with no known real threads is emitted needsCuration:true
//     with an EMPTY list (empty is correct; invented is a firing offense)
//   · unique-value guard: no brand, or no service/topic derivable → refuse with a reason
//   · plan is HARD-capped at 10 pages (June-2026 spam-update guard: this is a
//     handful-of-curated-pages play, never a mass templated network) via the existing
//     capProgrammatic plan-cap
//   · sibling-dedup: a topic whose slug already has a draft (here or in the gated
//     content drafts dir) is skipped, never overwritten
//
// Nothing here publishes. Output = drafts under reports/<client>/reddit-resources/
// with status 'draft-needs-human-review'; publishing rides the existing gated content
// path (human verifies every thread link → score → approve → PR). Deterministic,
// zero LLM calls, no network.

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from '../config.mjs';
import { slugify, nowIso } from '../util.mjs';
import { capProgrammatic } from '../content/index.mjs';

const MAX_PAGES = 10;            // hard cap — never raisable above 10, even by config
const MAX_THREADS_PER_PAGE = 10; // a curated page, not a link dump
const MAX_HARVEST_FILES = 300;   // bound the artifact scan
const MAX_HARVEST_BYTES = 2 * 1024 * 1024;
// Real Reddit THREAD urls only (must contain /comments/) — subreddit homepages and
// reddit.com/search/?q= monitoring links (offsite/execute.mjs writes those) are not threads.
const REDDIT_URL_RE = /https?:\/\/(?:www\.|old\.|new\.)?reddit\.com\/[^\s"'<>()[\]\\]+/g;
const isThreadUrl = (u) => /reddit\.com\/(?:r\/[^/]+\/)?comments\//i.test(u) && !/reddit\.com\/search/i.test(u);

const titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ')
  .split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const cleanQueryTopic = (s) => String(s || '').replace(/\breddit\b/gi, '').replace(/\bbest\b/gi, '')
  .replace(/[?"]/g, '').replace(/\s+/g, ' ').trim();

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; } // corrupt = missing, never a crash
}

function deepStrings(v, out = [], depth = 0) {
  if (depth > 8) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) deepStrings(x, out, depth + 1);
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) deepStrings(v[k], out, depth + 1);
  return out;
}

/**
 * Unique-value guard (fail-closed): a Reddit-resources page without a real brand behind
 * it, or without a single genuine service/topic, is exactly the thin templated page the
 * June-2026 spam update targets. Returns null when OK, else a refusal reason string.
 */
export function uniqueValueGuard(cfg = {}, { topics = null } = {}) {
  if (!cfg || !String(cfg.brand || '').trim()) {
    return 'unique-value guard: config lacks "brand" — refusing to emit brand-context pages for an anonymous site (fail-closed)';
  }
  const svc = (cfg.services || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
  const kws = cfg.tracking?.keywords || [];
  const explicit = (topics || []).filter(Boolean);
  if (!svc.length && !kws.length && !explicit.length) {
    return 'unique-value guard: config has no services and no tracking.keywords (and no --topics given) — at least 1 real service/topic is required (fail-closed)';
  }
  return null;
}

/**
 * Harvest REAL Reddit thread URLs from artifacts already on disk (SERP/citation/
 * measurement outputs under reports/<client>/ + data/ai-visibility/). Each candidate
 * carries {url, foundIn} provenance. NEVER fabricates — no artifacts → empty list.
 * The generator's own output dir is excluded (no self-reference echo).
 */
export function harvestRedditThreads(cfg = {}, { root = ROOT } = {}) {
  const found = new Map(); // url -> { url, foundIn }
  const dirs = [join(root, 'reports', cfg.name || ''), join(root, 'data', 'ai-visibility')];
  let scanned = 0;
  const walk = (dir) => {
    if (scanned >= MAX_HARVEST_FILES || !existsSync(dir)) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (scanned >= MAX_HARVEST_FILES) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'reddit-resources') continue; // never harvest our own output
        walk(p);
        continue;
      }
      if (!/\.(json|ndjson)$/i.test(e.name)) continue;
      try { if (statSync(p).size > MAX_HARVEST_BYTES) continue; } catch { continue; }
      scanned++;
      let text = '';
      try { text = readFileSync(p, 'utf-8'); } catch { continue; }
      for (const m of text.match(REDDIT_URL_RE) || []) {
        const url = m.replace(/[.,;:!?]+$/, '');
        if (!isThreadUrl(url) || found.has(url)) continue;
        found.set(url, { url, foundIn: relative(root, p).replace(/\\/g, '/') });
      }
    }
  };
  for (const d of dirs) walk(d);
  return [...found.values()];
}

/** Read fan-out planner/capture artifacts and pull query strings containing "reddit". */
function fanoutRedditTopics(cfg = {}, { root = ROOT } = {}) {
  const out = [];
  for (const f of ['fanout-coverage.json', 'fanout-capture.json']) {
    const data = readJsonSafe(join(root, 'reports', cfg.name || '', f));
    if (!data) continue;
    for (const s of deepStrings(data)) {
      if (s.length > 90 || /^https?:\/\//i.test(s) || !/\breddit\b/i.test(s)) continue;
      const t = cleanQueryTopic(s);
      if (t) out.push(t);
    }
  }
  return out;
}

/** A thread candidate belongs to a topic when a meaningful topic token appears in the URL. */
function threadsForTopic(topic, threads = []) {
  const tokens = slugify(topic).split('-').filter((t) => t.length >= 4);
  const need = tokens.length ? tokens : [slugify(topic)];
  return threads
    .filter((t) => { const u = String(t.url).toLowerCase(); return need.some((tok) => u.includes(tok)); })
    .slice(0, MAX_THREADS_PER_PAGE);
}

/**
 * Plan the Reddit-resources pages. Topic candidates: explicit {topics} → config services
 * → tracking.keywords → fan-out queries containing "reddit" → content-plan artifact.
 * Thread candidates come ONLY from real on-disk artifacts (with provenance); a topic
 * with none is needsCuration:true with an EMPTY list. Hard cap 10 pages via the
 * existing plan-cap (capFn injectable for test spies).
 * Returns { plan, cap } or { error, plan: [] } (fail-closed).
 */
export function planRedditResources(cfg = {}, { topics = null, root = ROOT, threads = null, capFn = capProgrammatic } = {}) {
  const guard = uniqueValueGuard(cfg, { topics });
  if (guard) return { error: guard, plan: [] };

  const candidates = []; // { topic, source }
  for (const t of topics || []) candidates.push({ topic: String(t).trim(), source: 'explicit' });
  for (const s of (cfg.services || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean)) {
    candidates.push({ topic: String(s).trim(), source: 'config:services' });
  }
  for (const k of cfg.tracking?.keywords || []) {
    const t = cleanQueryTopic(k);
    if (t) candidates.push({ topic: t, source: 'config:tracking.keywords' });
  }
  for (const t of fanoutRedditTopics(cfg, { root })) candidates.push({ topic: t, source: 'artifact:fanout' });
  const cp = readJsonSafe(join(root, 'reports', cfg.name || '', 'content-plan.json'));
  for (const item of cp?.plan || []) {
    const t = cleanQueryTopic(item?.targetQuery);
    if (t) candidates.push({ topic: t, source: 'artifact:content-plan' });
  }

  const harvested = Array.isArray(threads) ? threads.filter((t) => t?.url && isThreadUrl(t.url)) : harvestRedditThreads(cfg, { root });

  const seen = new Set();
  let plan = [];
  for (const c of candidates) {
    const topic = c.topic.toLowerCase();
    const slug = slugify(`${topic}-reddit-resources`);
    if (!topic || seen.has(slug)) continue;
    seen.add(slug);
    const threadCandidates = threadsForTopic(topic, harvested); // real URLs only — never invented
    plan.push({
      topic, topicTitle: titleCase(topic), slug, url: `/${slug}`, source: c.source,
      targetQueries: [`best ${topic} reddit`, `${topic} reddit`, `${topic} reddit review`],
      threadCandidates, needsCuration: threadCandidates.length === 0,
    });
  }

  // June-2026 guard: HARD cap — config may tighten below 10, never raise above it.
  const max = Math.min(MAX_PAGES, Math.max(1, Number(cfg.content?.maxRedditResourcesPages ?? MAX_PAGES) || MAX_PAGES));
  const capped = capFn(plan, max);
  return { plan: capped.plan, cap: { dropped: capped.dropped, max } };
}

/** Brand-context block — "what llms.txt should have been": plain declarative facts. */
function brandContext(cfg = {}) {
  const services = (cfg.services || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
  const city = cfg.locations?.[0]?.nap?.city || cfg.serviceAreaGeos?.[0] || '';
  const L = [`## About ${cfg.brand}`, ''];
  const who = [`${cfg.brand}${cfg.domain ? ` (${cfg.domain})` : ''} maintains this page.`];
  if (city) who.push(`${cfg.brand} is based in ${city}.`);
  if (services.length) who.push(`Services: ${services.join(', ')}.`);
  L.push(who.join(' '), '');
  L.push(`The threads above are independent Reddit community discussions — ${cfg.brand} did not write them, does not control them, and curates them here purely because they are the real conversations people search for.`);
  return L.join('\n');
}

/**
 * Render ONE planned page to a markdown draft. Deterministic. Every listed thread is a
 * REAL harvested URL with provenance; each carries a TODO-human line because we cannot
 * verify thread content here. Clean, FAQ-free structure. Never publishes.
 */
export function renderRedditResourcesPage(cfg = {}, page = {}) {
  if (!page?.topic) return '';
  const T = page.topicTitle || titleCase(page.topic);
  const L = [`# ${T}: The Best Reddit Threads & Discussions (curated)`, ''];
  L.push(`People researching ${page.topic} add "reddit" to their search because they want real, unfiltered experiences — not marketing copy. This page curates the genuine Reddit discussions about ${page.topic} worth reading, in one place, with context on who is curating them and why.`, '');
  L.push(`## Curated Reddit threads on ${page.topic}`, '');
  if (page.threadCandidates?.length) {
    for (const t of page.threadCandidates) {
      L.push(`- [${t.url}](${t.url}) — TODO-human: open this thread, verify it is real and relevant, and replace this line with one sentence on why it is worth reading. _(found in \`${t.foundIn}\`)_`);
    }
    L.push('');
  } else {
    L.push(`> TODO-human: no verified Reddit threads have been harvested for "${page.topic}" yet. Curate 5–10 REAL threads by hand (search \`best ${page.topic} reddit\`), add each with a one-line reason it is worth reading. This draft must NOT publish with an empty — or invented — thread list.`, '');
  }
  L.push(brandContext(cfg), '');
  return L.join('\n');
}

/**
 * Emit the planned drafts to reports/<client>/reddit-resources/ (the same
 * draft+brief.json convention generate/moat uses). Sibling-dedup: an existing draft
 * with the same slug — here or in the gated content drafts dir — is skipped, never
 * overwritten. Status is ALWAYS 'draft-needs-human-review'; publishing rides the
 * existing gated content path (human verifies every thread link → score → approve → PR).
 */
export function generateRedditResources(cfg = {}, plan = [], { log = () => {}, root = ROOT } = {}) {
  const guard = uniqueValueGuard(cfg, { topics: (plan || []).map((p) => p?.topic) });
  if (guard) { log(`  ⛔ ${guard}`); return { error: guard, written: [], skipped: [] }; }

  const dir = join(root, 'reports', cfg.name, 'reddit-resources');
  const contentDraftsDir = join(root, 'reports', cfg.name, 'drafts');
  mkdirSync(dir, { recursive: true });

  const written = [], skipped = [];
  for (const page of (Array.isArray(plan) ? plan : []).slice(0, MAX_PAGES)) {
    if (!page?.slug || !page?.topic) continue;
    // Sibling-dedup: never emit a second draft targeting an existing slug.
    if (existsSync(join(dir, `${page.slug}.md`)) || existsSync(join(contentDraftsDir, `${page.slug}.md`))) {
      skipped.push({ slug: page.slug, reason: 'sibling-dedup: a draft targeting this slug already exists' });
      continue;
    }
    const draft = renderRedditResourcesPage(cfg, page);
    const T = page.topicTitle || titleCase(page.topic);
    const brief = {
      template: 'reddit_resources',
      title: `${T}: The Best Reddit Threads & Discussions (curated)`,           // carries the "reddit" token
      metaDescription: `Curated list of the best Reddit threads and discussions about ${page.topic} — real community conversations, hand-verified, with context from ${cfg.brand}.`,
      slug: page.slug, url: page.url, topic: page.topic,
      targetQueries: page.targetQueries,
      provenance: { topicSource: page.source, threadCandidates: page.threadCandidates },
      needsCuration: page.needsCuration,
      generatedAt: nowIso(),
      status: 'draft-needs-human-review', // NEVER auto-publishes — repo invariant
    };
    writeFileSync(join(dir, `${page.slug}.md`), draft);
    writeFileSync(join(dir, `${page.slug}.brief.json`), JSON.stringify(brief, null, 2));
    written.push({ slug: page.slug, needsCuration: page.needsCuration, threads: page.threadCandidates.length });
  }

  const manifest = { client: cfg.name, ranAt: nowIso(), planned: plan.length, written, skipped };
  writeFileSync(join(dir, 'reddit-resources-manifest.json'), JSON.stringify(manifest, null, 2));
  const md = [`# Reddit-resources drafts — ${cfg.brand}`, '',
    `${written.length} draft(s) emitted · ${skipped.length} skipped (sibling-dedup) · hard cap ${MAX_PAGES} pages`, '',
    ...written.map((w) => `- [ ] \`/${w.slug}\` — ${w.threads} harvested thread candidate(s)${w.needsCuration ? ' · **needs human curation (zero known real threads — none were invented)**' : ''}`),
    '', '## Next steps (human — REQUIRED before publish)',
    '1. Open every thread URL; delete anything dead/irrelevant; replace each TODO-human line with a real one-liner.',
    '2. Pages marked needs-curation: hand-pick 5–10 real threads. NEVER let a model invent Reddit URLs.',
    '3. Route through the gated content path: `content score` → `content approve` → `content publish` (PR; human merges).',
  ].join('\n');
  writeFileSync(join(dir, 'reddit-resources-plan.md'), md);

  log(`\n  Reddit-resources: ${written.length} draft(s) emitted, ${skipped.length} skipped (dedup) → ${dir}`);
  log(`  All drafts are status=draft-needs-human-review; publishing rides the gated content path — never automatic.\n`);
  return { written, skipped, dir };
}

/** CLI shell: `reddit-resources <client> [--topics a,b]` — plan + emit drafts. */
export function runRedditResources(cfg, { log = () => {}, topics = null } = {}) {
  const { error, plan, cap } = planRedditResources(cfg, { topics });
  if (error) { log(`  ⛔ ${error}`); return { error }; }
  log(`  Planned ${plan.length} Reddit-resources page(s) (cap ${cap.max}; ${cap.dropped} dropped over-cap; ${plan.filter((p) => p.needsCuration).length} need human thread curation)`);
  const res = generateRedditResources(cfg, plan, { log });
  return { plan, cap, ...res };
}
