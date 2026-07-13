// seo-bot · onpage-fixes — ready-to-merge fix generators for every on-page surface (E9).
//
// Every generator ends in the SAME payloads the PR adapter (apply/nextjs.mjs) already
// ships: patch {file, find, replace} (exact, unique find/replace in a source file) or
// fileWrite {path, content} (a full-file artifact). No advice — diffs.
//
// Contract (all generators):
//  • DETERMINISTIC first — the fix is derived only from the page's OWN parsed content and
//    the client config's REAL data (NAP, services, booking URL). Nothing is invented: no
//    fabricated prices, dates, reviewers, or claims — a generator missing its real input
//    returns { refused: true, reason } (fail closed → human supplies the data).
//  • LLM-needing fixes (answer capsules, passage splits, content optimization) run ONLY
//    through src/llm.mjs (llmAvailable/complete) and fail CLOSED to a human-queue item
//    { queued: true, worksheet } when no model is available or the output fails the
//    deterministic validators (word window, ≤17-word sentences, no new numbers, no promo).
//  • A patch is emitted only when the caller can name the source file (cfg.onpage.fileFor /
//    cfg.sculpt.fileFor or explicit ctx.file) — otherwise the proposal is advisory
//    (autoApplicable:false), mirroring sculpt.mjs. Uniqueness of `find` is re-verified by
//    apply/nextjs.mjs at apply time, so a non-unique find fails safe there.
//  • June-2026 guards intact: freshnessFix REFUSES without real-content-diff evidence
//    (fake-refresh guard); imageAltFix REFUSES before/after imagery (FTC/HIPAA — human);
//    robots artifacts only include validated disallow paths (never block crawl on garbage).
//
// Evidence: research/inhouse-seo-engine-plan.md + research/aeo-deep-research-2026.md
// (capsule window + 17-word ceiling), research/searchatlas-100x-aeo-engine-plan.md
// (patch-shape apply lane), research/spam-update-june-2026 memory (fake-refresh guard).

import { countWords } from './util.mjs';
import { tightenText } from './decide.mjs';
import { splitSentences } from './passage.mjs';

const CAPSULE_MIN = 40, CAPSULE_MAX = 60, SENT_CEILING = 17;
const PROMO_RE = /\b(best|#1|number one|leading|ultimate|amazing|revolutionary|world[- ]class|premier|unmatched|unrivaled|guaranteed|cutting[- ]edge|state[- ]of[- ]the[- ]art|top[- ]rated|finest|luxurious|exclusive)\b/i;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const refuse = (reason) => ({ refused: true, reason });

/** JSON-LD <script> with `<` escaped so `</script>` can never break out of the block. */
export function jsonLdScript(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj, null, 2).replace(/</g, '\\u003c')}</script>`;
}

/** Resolve the source file for a URL from cfg.onpage.fileFor / cfg.sculpt.fileFor. */
export function fileForUrl(cfg, url) {
  const norm = (u) => String(u || '').split('#')[0].replace(/\/$/, '');
  const maps = [cfg?.onpage?.fileFor, cfg?.sculpt?.fileFor].filter(Boolean);
  for (const m of maps) { if (m[url]) return m[url]; if (m[norm(url)]) return m[norm(url)]; }
  return null;
}

/** Shared proposal shape (same fields decide.mjs / sculpt.mjs emit). */
function fix({ type, page, severity = 'low', current = '', proposed = '', rationale = '', patch = null, fileWrite = null, evidence }) {
  return {
    type, page, severity,
    autoApplicable: !!(patch || fileWrite),
    current, proposed, rationale,
    ...(patch ? { patch } : {}),
    ...(fileWrite ? { fileWrite } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

// ---------------------------------------------------------------------------
// DETERMINISTIC head fixes (titles/meta, canonical, OG/Twitter, lang, noindex)
// ---------------------------------------------------------------------------

/** Clamp an over-length <title>. find = the exact current title tag (unique per page). */
export function titleFix(parsed, cfg, { file = null } = {}) {
  const max = cfg?.audit?.titleMax || 60;
  if (!parsed?.title) return refuse('no <title> text to clamp — authoring a title from nothing needs a human (or the propose lane)');
  if (parsed.titleLen <= max) return refuse(`title is ${parsed.titleLen} chars (<= ${max}) — nothing to fix`);
  const proposed = tightenText(parsed.title, max);
  if (!proposed || proposed === parsed.title) return refuse('clamp produced no change — refusing a no-op patch');
  return fix({
    type: 'title', page: parsed.url, severity: 'medium',
    current: parsed.title, proposed,
    rationale: `Title ${parsed.titleLen} chars > ${max}; deterministic word-boundary clamp.`,
    patch: file ? { file, find: `<title>${parsed.title}</title>`, replace: `<title>${proposed}</title>` } : null,
  });
}

/** Clamp an over-length meta description, or insert one derived from the page's OWN lead text. */
export function metaFix(parsed, cfg, { file = null } = {}) {
  const max = cfg?.audit?.metaMax || 160;
  if (parsed?.metaDesc && parsed.metaLen > max) {
    const proposed = tightenText(parsed.metaDesc, max);
    if (!proposed || proposed === parsed.metaDesc) return refuse('clamp produced no change — refusing a no-op patch');
    return fix({
      type: 'meta', page: parsed.url, severity: 'low',
      current: parsed.metaDesc, proposed,
      rationale: `Meta description ${parsed.metaLen} chars > ${max}; deterministic clamp of the page's own text.`,
      patch: file ? { file, find: parsed.metaDesc, replace: proposed } : null,
    });
  }
  if (!parsed?.metaDesc) {
    // Derive from the page's own answer paragraph (never invent copy). No source text → human.
    const src = clean(parsed?.answerText || '');
    if (countWords(src) < 8) return refuse('no substantial lead paragraph to derive a meta description from — human authors it');
    if (!parsed?.title) return refuse('no <title> tag to anchor the insertion — human places the meta tag');
    const proposed = tightenText(src, max);
    const anchor = `<title>${parsed.title}</title>`;
    return fix({
      type: 'meta', page: parsed.url, severity: 'high',
      current: '(missing meta description)', proposed,
      rationale: `Missing meta description; derived verbatim-tightened from the page's own lead paragraph (no invention).`,
      patch: file ? { file, find: anchor, replace: `${anchor}\n    <meta name="description" content="${escAttr(proposed)}" />` } : null,
    });
  }
  return refuse(`meta description is ${parsed.metaLen} chars (<= ${max}) — nothing to fix`);
}

/** Insert a self-referential canonical when none exists (anchored after the title tag). */
export function canonicalFix(parsed, url, { file = null } = {}) {
  if (parsed?.canonical) return refuse(`canonical already present (${parsed.canonical}) — conflicting-canonical judgement stays human`);
  let href;
  try { href = new URL(url || parsed?.url).href; } catch { return refuse('page URL is not a valid absolute URL — cannot build a canonical (fail closed)'); }
  if (!parsed?.title) return refuse('no <title> tag to anchor the insertion — human places the canonical');
  const anchor = `<title>${parsed.title}</title>`;
  return fix({
    type: 'canonical', page: href, severity: 'medium',
    current: '(no canonical)', proposed: `<link rel="canonical" href="${escAttr(href)}" />`,
    rationale: 'Self-referential canonical consolidates duplicate-URL signals (query strings, trailing slashes).',
    patch: file ? { file, find: anchor, replace: `${anchor}\n    <link rel="canonical" href="${escAttr(href)}" />` } : null,
  });
}

/** Emit og:* + twitter:* tags built ONLY from the page's existing title/description. */
export function ogTwitterFix(parsed, url, { file = null } = {}) {
  if (parsed?.ogTitle) return refuse('og:title already present — partial-OG refinement stays human');
  const title = clean(parsed?.title);
  if (!title) return refuse('no <title> to mirror into OG tags — human authors it');
  let href = '';
  try { href = new URL(url || parsed?.url).href; } catch { /* og:url omitted when unknown */ }
  const desc = clean(parsed?.metaDesc);
  const lines = [
    `<meta property="og:title" content="${escAttr(title)}" />`,
    ...(desc ? [`<meta property="og:description" content="${escAttr(desc)}" />`] : []),
    ...(href ? [`<meta property="og:url" content="${escAttr(href)}" />`] : []),
    `<meta property="og:type" content="website" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escAttr(title)}" />`,
    ...(desc ? [`<meta name="twitter:description" content="${escAttr(desc)}" />`] : []),
  ];
  const block = lines.join('\n    ');
  return fix({
    type: 'og-twitter', page: href || parsed?.url || '', severity: 'low',
    current: '(no Open Graph / Twitter tags)', proposed: block,
    rationale: 'OG/Twitter tags mirrored 1:1 from the existing title/meta (no new copy) — social + Discover cards.',
    patch: file ? { file, find: '</head>', replace: `    ${block}\n</head>` } : null,
  });
}

/** Add lang to the exact raw <html …> open tag (caller supplies it verbatim from source). */
export function langFix(htmlOpenTag, lang = 'en', { file = null, page = '' } = {}) {
  const tag = String(htmlOpenTag || '');
  if (!/^<html(\s|>)/i.test(tag)) return refuse('need the verbatim <html …> open tag from the source file (fail closed)');
  if (/\slang\s*=/i.test(tag)) return refuse('lang attribute already present — nothing to fix');
  if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(String(lang))) return refuse(`"${lang}" is not a valid BCP-47 primary tag — refusing`);
  const replace = tag.replace(/^<html/i, `<html lang="${lang}"`);
  return fix({
    type: 'lang', page, severity: 'low',
    current: tag, proposed: replace,
    rationale: 'Missing <html lang> — accessibility + language signal (a11y overlap fix).',
    patch: file ? { file, find: tag, replace } : null,
  });
}

/** Materialize an index-discipline 'noindex' decision as a robots meta patch. */
export function noindexFix(decision, parsed, { file = null } = {}) {
  if (!decision || decision.action !== 'noindex') return refuse(`index-discipline action is "${decision?.action || 'unknown'}" — only 'noindex' is materialized here (301s go through the redirect map; 'wait' holds)`);
  if (/noindex/i.test(parsed?.robotsMeta || '')) return refuse('page already carries noindex — nothing to fix');
  if (!parsed?.title) return refuse('no <title> tag to anchor the insertion — human places the robots meta');
  const anchor = `<title>${parsed.title}</title>`;
  return fix({
    type: 'robots-noindex', page: decision.url || parsed.url, severity: 'medium',
    current: parsed.robotsMeta || '(no robots meta)', proposed: '<meta name="robots" content="noindex, follow" />',
    rationale: `Index discipline: ${decision.reason} — noindex the thin page instead of earning a scaled-content demotion.`,
    patch: file ? { file, find: anchor, replace: `${anchor}\n    <meta name="robots" content="noindex, follow" />` } : null,
    evidence: { decision },
  });
}

// ---------------------------------------------------------------------------
// Heading structure (visible text → PR-only, never edge; human merges the PR)
// ---------------------------------------------------------------------------

/** Insert a missing <h1> mirroring the page's own title (visible text ⇒ PR lane only). */
export function h1Fix(parsed, { file = null, bodyOpenTag = '<body>' } = {}) {
  if (Array.isArray(parsed?.h1s) && parsed.h1s.length > 0) return refuse(`${parsed.h1s.length} H1(s) already present — demoting extras is a human editorial call`);
  const title = clean(parsed?.title).replace(/\s*[|·–-]\s*[^|·–-]*$/, '').trim() || clean(parsed?.title);
  if (!title) return refuse('no <title> to derive an H1 from — human authors it');
  return fix({
    type: 'h1', page: parsed?.url || '', severity: 'high',
    current: '(no <h1>)', proposed: `<h1>${escAttr(title)}</h1>`,
    rationale: 'Missing H1 derived from the page\'s own title (brand suffix stripped). Visible text — ships as a PR a human merges, NEVER an edge override (cloaking guard).',
    patch: file ? { file, find: bodyOpenTag, replace: `${bodyOpenTag}\n    <h1>${escAttr(title)}</h1>` } : null,
  });
}

// ---------------------------------------------------------------------------
// Schema pack (comprehension-only JSON-LD; no FAQ/HowTo rich-result chasing)
// ---------------------------------------------------------------------------

/** BreadcrumbList JSON-LD derived from the URL path (deterministic; names from slug or map). */
export function breadcrumbSchemaFix(url, { file = null, titleByPath = {} } = {}) {
  let u;
  try { u = new URL(url); } catch { return refuse('invalid URL — cannot derive a breadcrumb trail (fail closed)'); }
  const segs = u.pathname.split('/').filter(Boolean);
  if (!segs.length) return refuse('homepage has no breadcrumb trail — nothing to emit');
  const human = (s) => s.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${u.origin}/` }];
  let path = '';
  segs.forEach((seg, i) => {
    path += `/${seg}`;
    items.push({ '@type': 'ListItem', position: i + 2, name: titleByPath[path] || human(seg), item: `${u.origin}${path}` });
  });
  const jsonLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items };
  const block = jsonLdScript(jsonLd);
  return fix({
    type: 'schema-breadcrumb', page: u.href, severity: 'low',
    current: '(no BreadcrumbList)', proposed: block,
    rationale: 'BreadcrumbList from the real URL hierarchy — comprehension + SERP path display (rich-eligible 2026).',
    patch: file ? { file, find: '</head>', replace: `    ${block}\n</head>` } : null,
    evidence: { jsonLd },
  });
}

/** Article JSON-LD from the page's OWN title + real dates only (never a fabricated date). */
export function articleSchemaFix(parsed, url, cfg = {}, { file = null } = {}) {
  const title = clean(parsed?.title);
  if (!title) return refuse('no title — cannot emit Article schema (fail closed)');
  if ((parsed?.jsonLdTypes || []).some((t) => /^(article|blogposting|newsarticle)$/i.test(String(t)))) return refuse('Article-family schema already present — nothing to emit');
  let href = ''; try { href = new URL(url || parsed?.url).href; } catch { return refuse('invalid URL for Article mainEntityOfPage (fail closed)'); }
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: title.slice(0, 110),
    mainEntityOfPage: href,
    ...(parsed?.metaDesc ? { description: clean(parsed.metaDesc) } : {}),
    ...(parsed?.modified ? { dateModified: parsed.modified } : {}), // REAL date only — omitted when unknown, never invented
    ...(cfg?.brand ? { publisher: { '@type': 'Organization', name: cfg.brand, ...(cfg.baseUrl ? { url: cfg.baseUrl } : {}) } } : {}),
  };
  const block = jsonLdScript(jsonLd);
  return fix({
    type: 'schema-article', page: href, severity: 'low',
    current: '(no Article schema)', proposed: block,
    rationale: 'Article JSON-LD mirrored from existing on-page facts (headline/description/real dateModified only).',
    patch: file ? { file, find: '</head>', replace: `    ${block}\n</head>` } : null,
    evidence: { jsonLd },
  });
}

/**
 * The full comprehension schema pack from the client's REAL config data:
 * Organization/(Medical)LocalBusiness (+NAP/geo/hours), Service+Offer per service
 * (price ONLY when a real price is configured), Person/Physician per provider,
 * ReserveAction from the real booking URL. Missing NAP → refused (human supplies it).
 * Output is a full-file artifact the PR adapter ships (fileWrite).
 */
export function schemaPackArtifact(cfg = {}) {
  const nap = cfg?.listings?.canonicalNap;
  if (!nap || !nap.name || !nap.street || !nap.city || !nap.phone) {
    return refuse('listings.canonicalNap incomplete (need name/street/city/phone) — REAL NAP data is human-supplied, never invented');
  }
  const isMedspa = cfg.vertical === 'medspa';
  const bizType = isMedspa ? 'MedicalBusiness' : 'LocalBusiness';
  const bizId = `${cfg.baseUrl || ''}#business`;
  const biz = {
    '@type': bizType, '@id': bizId,
    name: nap.name,
    address: { '@type': 'PostalAddress', streetAddress: nap.street, addressLocality: nap.city, ...(nap.state ? { addressRegion: nap.state } : {}), ...(nap.zip ? { postalCode: nap.zip } : {}) },
    telephone: nap.phone,
    ...(cfg.baseUrl ? { url: cfg.baseUrl } : {}),
    ...(Array.isArray(nap.sameAs) && nap.sameAs.length ? { sameAs: nap.sameAs } : {}),
    ...(nap.geo?.lat != null && nap.geo?.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: nap.geo.lat, longitude: nap.geo.lng } } : {}),
    ...(nap.hours ? { openingHoursSpecification: nap.hours } : {}),
  };
  const graph = [biz];
  // Service + Offer — price included ONLY when the config carries a real one.
  for (const s of (Array.isArray(cfg.services) ? cfg.services : [])) {
    const name = typeof s === 'string' ? s : s?.name;
    if (!name) continue;
    const price = typeof s === 'object' ? (s.price ?? s.priceRange ?? null) : null;
    graph.push({
      '@type': 'Service', name, provider: { '@id': bizId },
      ...(price != null && String(price).trim() ? { offers: { '@type': 'Offer', price: String(price), priceCurrency: (typeof s === 'object' && s.currency) || 'USD' } } : {}),
    });
  }
  // Person/Physician — named, credentialed providers from config (never fabricated).
  for (const r of (Array.isArray(cfg.reviewers) ? cfg.reviewers : [])) {
    if (!r?.name) continue;
    const medical = /\b(MD|DO)\b/i.test(r.credentials || '');
    graph.push({ '@type': medical ? 'Physician' : 'Person', name: r.name, ...(r.credentials ? { honorificSuffix: r.credentials } : {}), worksFor: { '@id': bizId } });
  }
  // ReserveAction — only with a real booking URL.
  const bookingUrl = cfg.bookingUrl || cfg.listings?.bookingUrl || null;
  if (bookingUrl) {
    graph.push({ '@type': 'ReserveAction', target: { '@type': 'EntryPoint', urlTemplate: bookingUrl }, object: { '@id': bizId } });
  }
  const jsonLd = { '@context': 'https://schema.org', '@graph': graph };
  return fix({
    type: 'schema-pack', page: cfg.baseUrl || '', severity: 'high',
    current: '(no site schema pack)', proposed: `${graph.length} entities (@graph, shared @id ${bizId})`,
    rationale: `Comprehension-only ${bizType} pack from REAL config data. No FAQPage/HowTo (rich results deprecated May 2026). Prices/providers only where configured — nothing invented.`,
    fileWrite: { path: 'seo-bot/schema-pack.jsonld', content: JSON.stringify(jsonLd, null, 2) + '\n' },
    evidence: { jsonLd },
  });
}

/** ReserveAction / tel: booking-funnel fix from REAL config data only (CRO overlap). */
export function bookingActionFix(cfg = {}, { file = null } = {}) {
  const bookingUrl = cfg.bookingUrl || cfg.listings?.bookingUrl || null;
  const phone = cfg?.listings?.canonicalNap?.phone || null;
  if (!bookingUrl && !phone) return refuse('no real booking URL or canonical phone in config — CRO fix data is human-supplied (never invented)');
  const graph = [];
  if (bookingUrl) graph.push({ '@context': 'https://schema.org', '@type': 'ReserveAction', target: { '@type': 'EntryPoint', urlTemplate: bookingUrl } });
  const block = graph.length ? jsonLdScript(graph.length === 1 ? graph[0] : graph) : '';
  const telLine = phone ? `<a href="tel:${escAttr(String(phone).replace(/[^\d+]/g, ''))}">${escAttr(phone)}</a>` : '';
  const proposed = [block, telLine].filter(Boolean).join('\n');
  return fix({
    type: 'cro-booking', page: cfg.baseUrl || '', severity: 'medium',
    current: '(no machine-readable booking action / tel link)', proposed,
    rationale: 'ReserveAction + tap-to-call from the REAL configured booking URL/phone — machine-readable "book" for AI agents + funnel leak fix. Money-path pages queue for a human under policy regardless.',
    patch: file && block ? { file, find: '</head>', replace: `    ${block}\n</head>` } : null,
    evidence: { bookingUrl, phone },
  });
}

// ---------------------------------------------------------------------------
// hreflang + pagination
// ---------------------------------------------------------------------------

/** Parse existing hreflang alternates out of raw HTML (detect lane). */
export function detectHreflang(html) {
  const out = [];
  const re = /<link\b[^>]*rel=["']alternate["'][^>]*>/gi;
  for (const m of String(html || '').match(re) || []) {
    const lang = (m.match(/hreflang=["']([^"']+)["']/i) || [])[1];
    const href = (m.match(/href=["']([^"']+)["']/i) || [])[1];
    if (lang && href) out.push({ hreflang: lang, href });
  }
  return { alternates: out, hasHreflang: out.length > 0, hasXDefault: out.some((a) => a.hreflang.toLowerCase() === 'x-default') };
}

/**
 * hreflang stub: reciprocal alternate links for configured locales. Locales + a URL
 * mapper are REAL config inputs — none configured → refused (fail closed, human decides).
 * @param {string} url         the page being fixed
 * @param {Array<{lang:string, href:string}>} alternates  full alternate set incl. self
 */
export function hreflangFix(url, alternates = [], { file = null } = {}) {
  let u; try { u = new URL(url); } catch { return refuse('invalid page URL (fail closed)'); }
  const valid = (alternates || []).filter((a) => a && /^[a-z]{2}(-[A-Za-z]{2})?$|^x-default$/i.test(a.lang || '') && (() => { try { new URL(a.href); return true; } catch { return false; } })());
  if (valid.length < 2) return refuse('need >=2 valid {lang, href} alternates (incl. self) from config — locale strategy is a human decision');
  const withDefault = valid.some((a) => a.lang.toLowerCase() === 'x-default') ? valid : [...valid, { lang: 'x-default', href: valid[0].href }];
  const lines = withDefault.map((a) => `<link rel="alternate" hreflang="${escAttr(a.lang)}" href="${escAttr(a.href)}" />`);
  const block = lines.join('\n    ');
  return fix({
    type: 'hreflang', page: u.href, severity: 'low',
    current: '(no hreflang alternates)', proposed: block,
    rationale: 'Reciprocal hreflang set (+x-default) from configured locales — every alternate must self-reference on its own page too.',
    patch: file ? { file, find: '</head>', replace: `    ${block}\n</head>` } : null,
  });
}

/** Detect a paginated series from raw HTML/URL (rel prev/next or ?page=/…/page/N). */
export function detectPagination(html, url) {
  const h = String(html || '');
  const relPrev = /<link\b[^>]*rel=["']prev["'][^>]*>/i.test(h);
  const relNext = /<link\b[^>]*rel=["']next["'][^>]*>/i.test(h);
  let pageParam = false;
  try { const u = new URL(url); pageParam = u.searchParams.has('page') || /\/page\/\d+\/?$/.test(u.pathname); } catch { /* not a URL */ }
  return { relPrev, relNext, pageParam, paginated: relPrev || relNext || pageParam };
}

/** Pagination hints: self-canonical + rel prev/next for a KNOWN series (caller supplies real neighbors). */
export function paginationFix(url, { prevUrl = null, nextUrl = null } = {}, { file = null } = {}) {
  let u; try { u = new URL(url); } catch { return refuse('invalid page URL (fail closed)'); }
  const ok = (x) => { try { return x ? new URL(x).href : null; } catch { return null; } };
  const prev = ok(prevUrl), next = ok(nextUrl);
  if (!prev && !next) return refuse('no real prev/next neighbors supplied — guessing a series order would corrupt crawl hints (fail closed)');
  const lines = [
    `<link rel="canonical" href="${escAttr(u.href)}" />`, // each page in a series self-canonicalizes (never canonical→page 1)
    ...(prev ? [`<link rel="prev" href="${escAttr(prev)}" />`] : []),
    ...(next ? [`<link rel="next" href="${escAttr(next)}" />`] : []),
  ];
  const block = lines.join('\n    ');
  return fix({
    type: 'pagination', page: u.href, severity: 'low',
    current: '(no pagination hints)', proposed: block,
    rationale: 'Self-canonical per series page + prev/next hints (Bing still consumes them; Google ignores harmlessly). Never canonicalize deep pages to page 1 — that hides items.',
    patch: file ? { file, find: '</head>', replace: `    ${block}\n</head>` } : null,
  });
}

// ---------------------------------------------------------------------------
// Images (deterministic alt from real page context; before/after ALWAYS human)
// ---------------------------------------------------------------------------

/**
 * Deterministic alt text for a non-before/after image missing alt.
 * alt = "{brand/h1 context} — {filename tokens}" (real tokens only, no scene invention).
 * Before/after imagery is REFUSED — FTC substantiation + HIPAA consent → human.
 * @param {{tagHtml:string, src:string, beforeAfter?:boolean}} img
 * @param {{h1?:string, brand?:string, page?:string}} pageCtx
 */
export function imageAltFix(img = {}, pageCtx = {}, { file = null } = {}) {
  if (img.beforeAfter || /before|after|b-a|results?|transformation/i.test(String(img.src || ''))) {
    return refuse('before/after imagery — NEVER auto-described (FTC substantiation + HIPAA patient consent) — human writes alt + checks consent');
  }
  const tag = String(img.tagHtml || '');
  if (!/^<img\b/i.test(tag)) return refuse('need the verbatim <img …> tag from source to patch (fail closed)');
  if (/\salt\s*=\s*["'][^"']+["']/i.test(tag)) return refuse('image already has non-empty alt — rewriting existing alt is editorial (human)');
  const base = String(img.src || '').split(/[?#]/)[0].split('/').pop() || '';
  const tokens = base.replace(/\.[a-z0-9]+$/i, '').split(/[-_.+\s]+/).filter((t) => t && !/^\d+$/.test(t) && !/^(img|image|dsc|dcim|photo|untitled|screenshot|unnamed)$/i.test(t));
  const ctx = clean(pageCtx.h1 || pageCtx.brand || '');
  if (!tokens.length && !ctx) return refuse('generic filename and no page context — a descriptive alt needs a human (renaming the file is the real fix)');
  const alt = clean([ctx, tokens.join(' ')].filter(Boolean).join(' — ')).slice(0, 120);
  const replace = tag.replace(/\/?>$/, (end) => ` alt="${escAttr(alt)}"${end === '/>' ? ' />' : '>'}`).replace(/\s+\/>/, ' />');
  return fix({
    type: 'img-alt', page: pageCtx.page || '', severity: 'low',
    current: tag, proposed: replace,
    rationale: 'Alt from the image\'s own filename tokens + the page\'s real H1/brand context — no invented scene description.',
    patch: file ? { file, find: tag, replace } : null,
    evidence: { alt, src: img.src },
  });
}

// ---------------------------------------------------------------------------
// Redirect maps, robots/sitemap artifacts, crawl-budget disallows
// ---------------------------------------------------------------------------

/**
 * Turn a redirect map ([{from, to}]) into full-file artifacts for the PR adapter:
 * a Netlify/CF-Pages `_redirects` file + a next.config redirects() snippet.
 * Invalid rows are EXCLUDED and reported (never ship a half-guessed 301).
 */
export function redirectMapArtifact(rows = []) {
  const valid = [], invalid = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const from = String(r?.from || '').trim(), to = String(r?.to || '').trim();
    if (from.startsWith('/') && to && (to.startsWith('/') || /^https?:\/\//.test(to)) && from !== to) valid.push({ from, to });
    else invalid.push(r);
  }
  if (!valid.length) return refuse(`no valid {from, to} rows (${invalid.length} invalid) — redirects are irreversible; nothing shippable (fail closed)`);
  const redirectsFile = valid.map((r) => `${r.from}  ${r.to}  301`).join('\n') + '\n';
  const nextSnippet = [
    '// seo-bot redirect map — paste into next.config.js redirects()',
    'module.exports.redirects = async () => ([',
    ...valid.map((r) => `  { source: ${JSON.stringify(r.from)}, destination: ${JSON.stringify(r.to)}, permanent: true },`),
    ']);', ''].join('\n');
  return fix({
    type: '301-redirect-map', page: '', severity: 'high',
    current: `${valid.length} mapped, ${invalid.length} rejected`, proposed: `_redirects + next.config snippet (${valid.length} × 301)`,
    rationale: '301 map as reviewable artifacts. Redirects are IRREVERSIBLE-ish: a human merges the PR (guardIrreversible: confirm + snapshot).',
    fileWrite: { path: 'seo-bot/_redirects', content: redirectsFile },
    evidence: { valid, invalid, nextSnippet },
  });
}

/** Derive robots.txt Disallow candidates from a crawl-budget waste report (faceted/param templates). */
export function facetedDisallowRules(wasteReport = {}) {
  const out = new Set();
  for (const row of (wasteReport.templates || wasteReport.waste || [])) {
    const bucket = row?.bucket || row?.kind;
    if (bucket !== 'faceted' && bucket !== 'param') continue;
    const t = String(row.template || row.path || '');
    const q = t.split('?')[1];
    if (!q) continue;
    for (const kv of q.split('&')) {
      const key = kv.split('=')[0].replace(/[^A-Za-z0-9_-]/g, '');
      if (key) out.add(`/*?${key}=`); // pattern-disallow the parameter, not the page
    }
  }
  return [...out].sort();
}

/**
 * robots.txt full-file artifact: explicit AI-crawler allows + sitemap refs + VALIDATED
 * disallow paths only. A malformed disallow is dropped (a bad rule can deindex a site —
 * fail closed = don't block what we can't validate).
 */
export function robotsSitemapArtifact(cfg = {}, { disallow = [], sitemaps = [] } = {}) {
  if (!cfg.baseUrl) return refuse('cfg.baseUrl missing — cannot write sitemap references (fail closed)');
  const validDisallow = (disallow || []).map(String).filter((d) => /^\/[\x21-\x7e]*$/.test(d) && !d.includes(' ') && d !== '/');
  const smUrls = (sitemaps && sitemaps.length ? sitemaps : [`${cfg.baseUrl.replace(/\/$/, '')}/sitemap.xml`])
    .filter((s) => { try { new URL(s); return true; } catch { return false; } });
  const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Googlebot', 'Bingbot'];
  const L = ['# robots.txt — generated by seo-bot (review before merge)', ''];
  for (const b of AI_BOTS) L.push(`User-agent: ${b}`, 'Allow: /', '');
  L.push('User-agent: *');
  if (validDisallow.length) for (const d of validDisallow) L.push(`Disallow: ${d}`);
  else L.push('Disallow:');
  L.push('');
  for (const s of smUrls) L.push(`Sitemap: ${s}`);
  L.push('');
  return fix({
    type: 'robots-txt', page: cfg.baseUrl, severity: 'medium',
    current: `${(disallow || []).length - validDisallow.length} disallow rule(s) rejected as unvalidatable`, proposed: `robots.txt (${AI_BOTS.length} AI-crawler allows, ${validDisallow.length} disallows, ${smUrls.length} sitemaps)`,
    rationale: 'Explicit AI-crawler allows (blocking them = invisible in AI answers) + validated crawl-budget disallows only. Never "Disallow: /".',
    fileWrite: { path: 'public/robots.txt', content: L.join('\n') },
    evidence: { validDisallow, rejected: (disallow || []).filter((d) => !validDisallow.includes(String(d))) },
  });
}

// ---------------------------------------------------------------------------
// Freshness (REAL-DIFF-GUARDED — the June-2026 fake-refresh veto)
// ---------------------------------------------------------------------------

/**
 * Re-date a page ONLY when the caller presents evidence of a REAL content change:
 * realDiff = { changedChars:number>=200 | changedWords:number>=30, summary:string }.
 * No evidence → REFUSED. Fake-refresh (re-dating unchanged content) is veto-listed.
 */
export function freshnessFix(parsed, realDiff = null, { file = null, now = new Date() } = {}) {
  const chars = Number(realDiff?.changedChars);
  const words = Number(realDiff?.changedWords);
  const substantive = (Number.isFinite(chars) && chars >= 200) || (Number.isFinite(words) && words >= 30);
  if (!realDiff || !substantive || !clean(realDiff.summary)) {
    return refuse('no evidence of a REAL content update (need changedChars>=200 or changedWords>=30 + a summary) — re-dating unchanged content is fake-refresh spam (June-2026 veto), refusing');
  }
  const iso = new Date(now).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return refuse('invalid clock — refusing to write a garbage date');
  const old = parsed?.modified || '';
  const patch = file && old
    ? { file, find: `"dateModified": "${old}"`, replace: `"dateModified": "${iso}"` }
    : (file && parsed?.title ? { file, find: `<title>${parsed.title}</title>`, replace: `<title>${parsed.title}</title>\n    ${jsonLdScript({ '@context': 'https://schema.org', '@type': 'WebPage', dateModified: iso })}` } : null);
  return fix({
    type: 'freshness', page: parsed?.url || '', severity: 'medium',
    current: old || '(no dateModified)', proposed: `dateModified: ${iso} (real update: ${clean(realDiff.summary).slice(0, 120)})`,
    rationale: `Re-date on a verified REAL update (${Number.isFinite(chars) ? `${chars} chars` : `${words} words`} changed). Never fake-refresh.`,
    patch,
    evidence: { realDiff: { changedChars: Number.isFinite(chars) ? chars : undefined, changedWords: Number.isFinite(words) ? words : undefined, summary: clean(realDiff.summary) } },
  });
}

// ---------------------------------------------------------------------------
// CWV code-level fixes (wraps perf/cwv-template patches into a shippable artifact)
// ---------------------------------------------------------------------------

/** Bundle cwvTemplatePatches() output into one reviewable full-file artifact. */
export function cwvArtifact(patches = []) {
  const rows = (Array.isArray(patches) ? patches : []).filter((p) => p && typeof p.code === 'string' && p.code.trim());
  if (!rows.length) return refuse('no CWV template patches to ship — run cwvDiagnose/cwvTemplatePatches first');
  const L = ['<!-- seo-bot CWV head/template fixes — review + place in the layout/template -->', ''];
  for (const p of rows) {
    L.push(`<!-- ${p.type || 'fix'}${p.title ? `: ${p.title}` : ''} -->`);
    L.push(p.code.trim(), '');
  }
  return fix({
    type: 'cwv-fixes', page: '', severity: 'medium',
    current: `${rows.length} lab-diagnosed opportunities`, proposed: 'seo-bot/cwv-head-fixes.html artifact',
    rationale: 'Code-level CWV fixes (LCP preload/fetchpriority, defer render-blockers, next/image) as one reviewable artifact for the template PR.',
    fileWrite: { path: 'seo-bot/cwv-head-fixes.html', content: L.join('\n') },
  });
}

// ---------------------------------------------------------------------------
// LLM-GATED fixes — via src/llm.mjs ONLY; fail CLOSED to the human queue
// ---------------------------------------------------------------------------

const NUM_RE = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const numbersIn = (s) => (String(s || '').match(NUM_RE) || []).map((n) => n.replace(/[,$%]/g, ''));
/** True when `rewrite` contains a number absent from `source` (fabrication tell). */
function addsNumbers(source, rewrite) {
  const before = new Set(numbersIn(source));
  return numbersIn(rewrite).some((n) => !before.has(n));
}

/** Deterministic capsule validator: word window, ≤17-word sentences, no promo, no new numbers. */
export function validateCapsule(text, sourceText, { min = CAPSULE_MIN, max = CAPSULE_MAX } = {}) {
  const t = clean(text);
  if (!t) return { ok: false, reason: 'empty output' };
  const words = countWords(t);
  if (words < min || words > max) return { ok: false, reason: `capsule is ${words} words (need ${min}-${max})` };
  const long = splitSentences(t).filter((s) => countWords(s) > SENT_CEILING);
  if (long.length) return { ok: false, reason: `${long.length} sentence(s) exceed the ${SENT_CEILING}-word citability ceiling` };
  if (PROMO_RE.test(t)) return { ok: false, reason: 'promotional superlative in output (negative AI-citation signal)' };
  if (addsNumbers(sourceText, t)) return { ok: false, reason: 'output introduces a number not present in the source (fabrication)' };
  return { ok: true, words };
}

/** Uniform human-queue item for a failed/unavailable LLM fix (fail closed). */
function humanQueueItem(type, page, ask, reason) {
  return { queued: true, reason, worksheet: { type, page, severity: 'high', autoApplicable: false, current: '(needs authoring)', proposed: ask, rationale: reason } };
}

/**
 * LLM answer-capsule fix: tighten the page's OWN lead text into a 40-60-word capsule
 * (sentences ≤17 words), then patch it in ABOVE the existing paragraph. Fails closed:
 * no model / unparseable / invalid output → { queued:true, worksheet } for a human.
 * @param {object} page  parsed page (rules.parsePage output)
 * @param {object} cfg
 * @param {{file?:string, paragraphHtml?:string, llm?:{llmAvailable:Function, complete:Function}}} ctx
 */
export async function capsuleFix(page = {}, cfg = {}, { file = null, paragraphHtml = null, llm = null } = {}) {
  const ask = `Write a ${CAPSULE_MIN}-${CAPSULE_MAX} word answer capsule from the page's existing content (sentences ≤${SENT_CEILING} words, no superlatives, no new facts).`;
  const src = clean(page.answerText || page.bodyText || '');
  if (countWords(src) < 20) return humanQueueItem('aeo-answer-capsule', page.url || '', ask, 'not enough source text to derive a capsule — human authors it (never invent)');
  const mod = llm || await import('./llm.mjs');
  if (!mod.llmAvailable()) return humanQueueItem('aeo-answer-capsule', page.url || '', ask, 'no LLM available — capsule rewriting queues for a human (fail closed)');
  let out = null;
  try {
    out = await mod.complete(
      `Write a ${CAPSULE_MIN}-${CAPSULE_MAX} word direct-answer capsule for the top of this page. RULES: use ONLY facts present in the content below (invent nothing — no new numbers, names, or claims); every sentence must be a declarative single claim of ${SENT_CEILING} words or fewer; name the subject explicitly; no superlatives. Return ONLY the capsule.\nPAGE TITLE: ${clean(page.title)}\nCONTENT: ${src.slice(0, 1400)}`,
      { system: 'You are an AEO editor. Output ONLY a self-contained answer capsule, grounded strictly in the provided content.', maxTokens: 200, tag: 'onpage-capsule' });
  } catch { out = null; }
  if (!out) return humanQueueItem('aeo-answer-capsule', page.url || '', ask, 'LLM call failed/unparseable — queued for a human (fail closed)');
  const v = validateCapsule(out, `${page.title || ''} ${src}`);
  if (!v.ok) return humanQueueItem('aeo-answer-capsule', page.url || '', ask, `LLM output rejected by validator: ${v.reason} — queued for a human (fail closed)`);
  const capsule = clean(out);
  return fix({
    type: 'aeo-answer-capsule', page: page.url || '', severity: 'high',
    current: src.slice(0, 160), proposed: capsule,
    rationale: `Validated ${v.words}-word capsule (sentences ≤${SENT_CEILING} words, no new numbers) derived from the page's own text. Visible text → PR lane; a human merges.`,
    patch: file && paragraphHtml ? { file, find: paragraphHtml, replace: `<p>${escAttr(capsule).replace(/&quot;/g, '"')}</p>\n${paragraphHtml}` } : null,
  });
}

/**
 * LLM passage fix: split a chunk's over-ceiling sentences into ≤17-word declaratives with
 * IDENTICAL facts. Fails closed to the human queue (no model / invalid / adds numbers).
 * @param {{text:string, heading?:string, url?:string}} chunk  (passage.chunkPage output)
 */
export async function passageFix(chunk = {}, cfg = {}, { file = null, llm = null } = {}) {
  const ask = `Split the over-long sentences in this passage into single-claim sentences ≤${SENT_CEILING} words (same facts, no additions).`;
  const src = clean(chunk.text || '');
  if (!src) return humanQueueItem('passage-split', chunk.url || '', ask, 'empty chunk — nothing to fix');
  const longs = splitSentences(src).filter((s) => countWords(s) > SENT_CEILING);
  if (!longs.length) return refuse(`no sentence exceeds ${SENT_CEILING} words — chunk is already citable`);
  const mod = llm || await import('./llm.mjs');
  if (!mod.llmAvailable()) return humanQueueItem('passage-split', chunk.url || '', ask, 'no LLM available — passage rewriting queues for a human (fail closed)');
  let out = null;
  try {
    out = await mod.complete(
      `Rewrite this passage so every sentence is a single declarative claim of ${SENT_CEILING} words or fewer. Keep EVERY fact identical — no new numbers, names, claims, or superlatives; do not drop facts. Return ONLY the rewritten passage.\nPASSAGE: ${src.slice(0, 1600)}`,
      { system: 'You are an AEO editor. You split sentences without changing any fact.', maxTokens: 500, tag: 'onpage-passage' });
  } catch { out = null; }
  if (!out) return humanQueueItem('passage-split', chunk.url || '', ask, 'LLM call failed/unparseable — queued for a human (fail closed)');
  const t = clean(out);
  const stillLong = splitSentences(t).filter((s) => countWords(s) > SENT_CEILING);
  if (!t || stillLong.length || addsNumbers(src, t) || PROMO_RE.test(t)) {
    return humanQueueItem('passage-split', chunk.url || '', ask, 'LLM output rejected by validator (long sentences / new numbers / promo tone) — queued for a human (fail closed)');
  }
  return fix({
    type: 'passage-split', page: chunk.url || '', severity: 'medium',
    current: src.slice(0, 160), proposed: t,
    rationale: `Sentences split to ≤${SENT_CEILING} words with identical facts (validated: no new numbers, no promo). Visible text → PR lane; a human merges.`,
    patch: file ? { file, find: src, replace: t } : null,
  });
}

/**
 * TF-IDF content-optimization fix: wraps content/optimize.optimizeDraft and attaches the
 * target file so its constrained-rewrite patches ride the PR lane. No LLM → the term-gap
 * work queues as a human worksheet (fail closed) instead of shipping advisory prose.
 */
export async function contentOptimizeFix(cfg = {}, { query, draft, draftFile, file = null, llm = null, log = () => {} } = {}) {
  const ask = `Weave the competitor term gaps for "${query}" into REAL existing sentences (no new claims).`;
  if (!query) return humanQueueItem('term-gap', '', ask, 'no target query supplied — nothing to optimize against (fail closed)');
  const mod = llm || await import('./llm.mjs');
  if (!mod.llmAvailable() && !process.env.ANTHROPIC_API_KEY) {
    return humanQueueItem('term-gap', draftFile || '', ask, 'no LLM available — constrained rewrites queue for a human (fail closed)');
  }
  const { optimizeDraft } = await import('./content/optimize.mjs');
  let r;
  try { r = await optimizeDraft(cfg, { query, draft, draftFile, log }); }
  catch (e) { return humanQueueItem('term-gap', draftFile || '', ask, `optimizeDraft failed (${String(e.message || e).slice(0, 100)}) — queued for a human (fail closed)`); }
  const proposals = (r.proposals || []).map((p) => (p.patch && file) ? { ...p, patch: { file, ...p.patch } } : p);
  return { score: r.score, proposals, ready: proposals.filter((p) => p.patch?.file).length };
}
