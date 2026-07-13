// seo-bot · audit rules. Each rule maps to a verified June-2026 ranking/citation
// signal. We parse RAW HTML (cheerio) — what AI crawlers actually see.
//
// Evidence basis (see research/inhouse-seo-engine-plan.md + aeo-deep-research-2026.md):
//  - AI crawlers don't run JS -> server-rendered text is mandatory (binary).
//  - Answer-first 40-60 word capsules + question headings -> Layer-2 citation.
//  - JSON-LD entity binding (sameAs/Wikipedia) -> retrieval + entity resolution.
//  - Freshness: cited content skews fresher; >90d stale is penalized.
//  - Promotional/commodity tone correlates NEGATIVELY with AI citation (2026).
//  - Don't block GPTBot/ClaudeBot/PerplexityBot (site-level, critical).

import * as cheerio from 'cheerio';
import { countWords, absUrl, sameSite } from './util.mjs';

const PROMO_TOKENS = /\b(best|#1|number one|leading|ultimate|amazing|revolutionary|world[- ]class|premier|unmatched|unrivaled|guaranteed|cutting[- ]edge|state[- ]of[- ]the[- ]art|top[- ]rated)\b/gi;
const QUESTION_RE = /\b(how|what|why|when|where|which|who|is|are|can|does|do|should)\b.*\?|\?\s*$/i;
// Citation/review manipulation — Google's May-2026 "buying or altering citations" spam policy + FTC.
const CITATION_MANIPULATION = /\b(buy|bought|paid|purchase|order)\b[^.]{0,40}\b(citations?|backlinks?|mentions?|reviews?)\b|\b(guaranteed|instant)\b[^.]{0,25}\b(rankings?|citations?|reviews?|first page)\b|review (gating|swapp?ing|exchange)|incentiviz\w* reviews?|fake reviews?/i;

function f(rule, severity, message, recommendation, evidence) {
  return { rule, severity, message, recommendation, evidence };
}

/** Parse one page's raw HTML into a structured snapshot. */
export function parsePage(html, url, cfg) {
  const $ = cheerio.load(html || '');
  const head = $('head');

  const title = ($('title').first().text() || '').trim();
  const metaDesc = ($('meta[name="description"]').attr('content') || '').trim();
  const canonical = ($('link[rel="canonical"]').attr('href') || '').trim();
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '').toLowerCase();
  const lang = ($('html').attr('lang') || '').trim();
  const viewport = ($('meta[name="viewport"]').attr('content') || '').trim();
  const ogTitle = ($('meta[property="og:title"]').attr('content') || '').trim();

  const h1s = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const headings = $('h1,h2,h3,h4,h5,h6').map((_, el) => ({ level: Number(el.tagName[1]), text: $(el).text().trim() })).get().filter((h) => h.text);

  // Visible text (strip non-content nodes)
  const $body = cheerio.load(html || '');
  $body('script,style,noscript,svg,template').remove();
  const bodyText = $body('body').text().replace(/\s+/g, ' ').trim();
  const bodyWords = countWords(bodyText);

  // Answer-block candidate: earliest substantial paragraph
  let answerWords = 0, answerText = '';
  const paras = $body('p').map((_, el) => $body(el).text().replace(/\s+/g, ' ').trim()).get();
  for (const p of paras) { if (countWords(p) >= 12) { answerText = p; answerWords = countWords(p); break; } }

  // JSON-LD
  const jsonLdTypes = [];
  let jsonLdInvalidCount = 0, jsonLdCount = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    jsonLdCount++;
    try {
      const data = JSON.parse($(el).contents().text());
      const collect = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) return node.forEach(collect);
        if (node['@type']) [].concat(node['@type']).forEach((t) => jsonLdTypes.push(String(t)));
        if (node['@graph']) collect(node['@graph']);
      };
      collect(data); // only reached if JSON.parse succeeded → types come ONLY from valid blocks
    } catch { jsonLdInvalidCount++; }
  });
  const jsonLdValid = jsonLdInvalidCount === 0;

  // Links (+ anchor-text variety, per Cyrus Shepard's 23M-link study: varied descriptive
  // anchors > raw link count; generic "click here" anchors waste the relevance signal).
  let internal = 0, external = 0;
  const intByTarget = new Map(); // target -> [anchorText]
  $('a[href]').each((_, el) => {
    const abs = absUrl(url, $(el).attr('href'));
    if (!abs) return;
    if (abs.startsWith('mailto:') || abs.startsWith('tel:')) return;
    if (sameSite(abs, url)) {
      internal++;
      const anchor = ($(el).text() || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const t = abs.split('#')[0];
      if (!intByTarget.has(t)) intByTarget.set(t, []);
      intByTarget.get(t).push(anchor);
    } else external++;
  });
  const GENERIC = /^(click here|read more|here|learn more|this|link|more|see more|find out more)$/;
  let genericAnchorCount = 0, lowVarietyTargets = 0;
  for (const anchors of intByTarget.values()) {
    genericAnchorCount += anchors.filter((a) => GENERIC.test(a)).length;
    if (anchors.length >= 3 && new Set(anchors).size === 1) lowVarietyTargets++;
  }

  // Images
  const imgs = $('img');
  const imgsMissingAlt = imgs.filter((_, el) => !($(el).attr('alt') || '').trim()).length;

  // Freshness
  let modified = '';
  const metaMod = $('meta[property="article:modified_time"]').attr('content') || $('meta[name="last-modified"]').attr('content');
  if (metaMod) modified = metaMod;
  if (!modified) {
    const m = (html || '').match(/"dateModified"\s*:\s*"([^"]+)"/);
    if (m) modified = m[1];
  }
  if (!modified) { const t = $('time[datetime]').attr('datetime'); if (t) modified = t; }

  // Promotional tone
  const promoHits = (bodyText.match(PROMO_TOKENS) || []).length;

  // JS-dependence signal
  const looksSpaShell = /__NEXT_DATA__|id=["']root["']|id=["']__next["']|ng-app|data-reactroot/i.test(html || '');

  // Ad density + intrusive UX (strongest measured NEGATIVE ranking signals in the 2024-2026 studies).
  const adSlots = $('ins.adsbygoogle, [id*="google_ads"], [class*="adsbygoogle"], iframe[src*="/ads"], iframe[src*="doubleclick"], [data-ad-client], [data-ad-slot], [class*="advertisement"]').length;
  const intrusiveInterstitial = /onesignal|pushengage|web-?push|push notification|exit-intent|interstitial-ad|popup-overlay/i.test(html || '');
  const citationManipulation = CITATION_MANIPULATION.test(bodyText);

  const medspa = cfg?.vertical === 'medspa' ? medspaFields(html, bodyText, jsonLdTypes, cfg) : null;
  const local = (cfg?.vertical === 'medspa' || cfg?.local) ? localFields(html, bodyText, cfg) : null;

  return {
    url, title, titleLen: title.length, metaDesc, metaLen: metaDesc.length, canonical, robotsMeta, lang, viewport, ogTitle,
    h1s, headings, bodyWords, answerWords, answerText, jsonLdTypes, jsonLdValid, jsonLdInvalidCount, jsonLdCount,
    internal, external, genericAnchorCount, lowVarietyTargets, imgCount: imgs.length, imgsMissingAlt, modified, promoHits, looksSpaShell,
    htmlBytes: Buffer.byteLength(html || '', 'utf8'), medspa, local,
    adSlots, intrusiveInterstitial, citationManipulation,
  };
}

/** Run all per-page rules. Returns findings[]. */
export function auditPage(page, cfg) {
  const a = cfg.audit;
  const out = [];
  if (!page.ok || page.status !== 200) {
    out.push(f('http', page.status >= 500 || page.status === 0 ? 'critical' : 'high',
      `Page returned HTTP ${page.status || 'ERR'}${page.error ? ` (${page.error})` : ''}`,
      'Fix the response — non-200 pages are dropped from indexes and answer engines.'));
    return { url: page.url, status: page.status, findings: out, parsed: null };
  }
  const p = parsePage(page.html, page.finalUrl || page.url, cfg);

  // --- JS-dependence (CRITICAL for AEO) ---
  if (p.bodyWords < 50 && p.looksSpaShell) {
    out.push(f('js-dependence', 'critical',
      `Raw HTML has only ${p.bodyWords} words but looks like a client-rendered shell.`,
      'Server-render this page (SSR/SSG/ISR). AI crawlers (GPTBot/ClaudeBot/PerplexityBot) do not execute JS, so client-only content is invisible to them.',
      { bodyWords: p.bodyWords }));
  }

  // --- noindex (meta[name=robots] OR X-Robots-Tag response header) ---
  const xRobotsTag = (() => {
    const h = page.headers || {};
    // headers may be a plain object; key lookup is case-insensitive
    for (const k of Object.keys(h)) {
      if (k.toLowerCase() === 'x-robots-tag') return String(h[k]).toLowerCase();
    }
    return '';
  })();
  if (/noindex/.test(p.robotsMeta) || /noindex/.test(xRobotsTag)) {
    out.push(f('noindex', 'high', 'Page is marked noindex.', 'Remove noindex if this page should rank/be cited.'));
  }

  // --- title ---
  if (!p.title) out.push(f('title', 'critical', 'Missing <title>.', 'Add a front-loaded, unique title (primary keyword first).'));
  else if (p.titleLen > a.titleMax) out.push(f('title', 'medium', `Title is ${p.titleLen} chars (> ${a.titleMax}); will truncate.`, `Tighten to <= ${a.titleMax} chars, keyword first.`, { title: p.title }));
  else if (p.titleLen < a.titleMin) out.push(f('title', 'medium', `Title is only ${p.titleLen} chars; likely under-descriptive.`, 'Expand with the primary query + qualifier (city/2026).', { title: p.title }));

  // --- meta description ---
  if (!p.metaDesc) out.push(f('meta-description', 'high', 'Missing meta description.', 'Add a 50-160 char description that front-loads a direct answer.'));
  else if (p.metaLen < a.metaMin || p.metaLen > a.metaMax) out.push(f('meta-description', 'low', `Meta description is ${p.metaLen} chars (target ${a.metaMin}-${a.metaMax}).`, 'Right-size it; lead with the answer.'));

  // --- canonical ---
  if (!p.canonical) out.push(f('canonical', 'medium', 'Missing canonical link.', 'Add a self-referential canonical to consolidate signals.'));

  // --- H1 ---
  if (p.h1s.length === 0) out.push(f('h1', 'high', 'No <h1> on the page.', 'Add exactly one descriptive H1 matching search intent.'));
  else if (p.h1s.length > 1) out.push(f('h1', 'low', `${p.h1s.length} H1s found.`, 'Use a single H1; demote the rest to H2.'));

  // --- answer block (Layer-2 AEO) ---
  // When vertical=medspa and the URL matches a service path, auditMedspaPage emits
  // 'answer-capsule-medspa' which covers BOTH answerWords===0 AND answerWords>max+40.
  // Skip the generic 'answer-block' rule in both cases to avoid two findings for the same gap.
  const _medspaCoversMissingAnswer = cfg.vertical === 'medspa' &&
    (p.answerWords === 0 || p.answerWords > a.answerWordsMax + 40) &&
    (() => { try { return reTest(cfg.servicePathRe, new URL(p.url).pathname); } catch { return false; } })();
  if (p.bodyWords >= a.minWords && !_medspaCoversMissingAnswer) {
    if (p.answerWords === 0) out.push(f('answer-block', 'high', 'No direct-answer paragraph found near the top.', `Open with a ${a.answerWordsMin}-${a.answerWordsMax} word direct answer to the page's core question.`));
    else if (p.answerWords > a.answerWordsMax + 40) out.push(f('answer-block', 'medium', `Lead paragraph is ${p.answerWords} words; answer engines prefer a tight ${a.answerWordsMin}-${a.answerWordsMax} word capsule first.`, 'Add a concise answer capsule before the long intro.'));
  }

  // --- question-form headings (multi-angle retrieval) ---
  const hasQ = p.headings.some((h) => QUESTION_RE.test(h.text));
  if (p.bodyWords >= a.minWords && !hasQ) {
    out.push(f('question-headings', 'medium', 'No question-form headings.', 'Add H2/H3s phrased as real queries ("How much does X cost in {city}?") — each maps to a query-fan-out sub-query.'));
  }

  // --- JSON-LD / schema ---
  if (p.jsonLdCount === 0) out.push(f('schema', 'high', 'No JSON-LD structured data.', 'Add schema (Organization/LocalBusiness/MedicalBusiness + WebSite; Article/Service/Review where relevant) with sameAs entity binding. (FAQPage/HowTo rich results were deprecated May 2026 — do not add them for rich snippets.)'));
  else if (!p.jsonLdValid) out.push(f('schema', 'high', 'A JSON-LD block failed to parse.', 'Fix the malformed JSON-LD — invalid schema is ignored.'));
  // NB: schemaTypesExpected (Organization/WebSite) are SITE-level entities and are
  // checked once in auditSite, not per page, to avoid noise.

  // --- thin content ---
  if (p.bodyWords < a.minWords) out.push(f('thin-content', 'medium', `Only ${p.bodyWords} words of server-rendered text (< ${a.minWords}).`, 'Add genuinely useful, unique depth (real data/quotes) — not AI filler, which 2026 spam systems (S-BERT/S-CTS) demote.'));

  // --- internal links ---
  if (p.internal < a.minInternalLinks) out.push(f('internal-links', 'medium', `Only ${p.internal} internal links.`, 'Add contextual internal links (related city/treatment) to spread crawl + relevance.'));

  // --- anchor-text variety (Cyrus Shepard / Zyppy 23M-link study) ---
  if (p.genericAnchorCount >= 3) out.push(f('anchor-variety', 'low', `${p.genericAnchorCount} internal links use generic anchors ("click here"/"read more").`, 'Use descriptive, varied anchor text (the target page\'s topic) — anchor variety beats link count for relevance.'));
  if (p.lowVarietyTargets >= 1) out.push(f('anchor-variety', 'medium', `${p.lowVarietyTargets} page(s) are linked 3+ times with the exact same anchor text.`, 'Vary the anchor text across links to the same target (synonyms/long-tail), not one repeated phrase.'));

  // --- images alt ---
  if (p.imgCount > 0 && p.imgsMissingAlt / p.imgCount > 0.3) out.push(f('img-alt', 'low', `${p.imgsMissingAlt}/${p.imgCount} images missing alt text.`, 'Add descriptive alt text (accessibility + image/answer signals).'));

  // --- ad density + intrusive UX (spam-update loser signals) ---
  if (p.bodyWords >= (a.minWords || 1) && p.adSlots > 0 && (p.adSlots / Math.max(1, p.bodyWords / 500)) > 3) {
    out.push(f('ad-density', 'medium', `High ad density (${p.adSlots} ad slots for ${p.bodyWords} words).`, 'Cut fixed/above-the-fold ad units — ad:content ratio + fixed-ad placement are the strongest measured negative ranking signals (Zyppy).'));
  }
  if (p.intrusiveInterstitial) out.push(f('intrusive-ux', 'low', 'Intrusive UX (push-notification / interstitial / exit-intent popup) detected.', 'Remove intrusive interstitials/push prompts — zero survivor sites in the spam-update studies used them.'));
  // --- citation/review manipulation (Google May-2026 policy + FTC) — FLAG ONLY ---
  if (p.citationManipulation) out.push(f('citation-manipulation', 'high', 'Copy implies bought/placed citations, paid reviews, or guaranteed rankings.', 'Remove it — "buying or altering citations" + inauthentic review/mention networks are spam (Google May-2026) and an FTC violation. FLAG ONLY — route to human/legal review.'));

  // --- freshness ---
  if (p.bodyWords >= a.minWords) {
    if (!p.modified) out.push(f('freshness', 'medium', 'No dateModified / visible update date.', 'Emit dateModified in schema and show "Updated <Month> 2026" — cited content skews fresher.'));
    else {
      const days = (Date.now() - Date.parse(p.modified)) / 86400000;
      // Reject placeholder/garbage dates ("0" → year ~0001) and future dates — not real "stale" signals.
      if (Number.isFinite(days) && days >= 0 && days <= 365 * 20 && days > a.freshnessDays) out.push(f('freshness', 'medium', `Content last modified ${Math.round(days)} days ago.`, 'Refresh + re-date; freshness strongly correlates with AI citation.'));
    }
  }

  // --- promotional tone (negative citation signal) ---
  // Guard a.minWords > 0: if minWords is 0/undefined the outer check passes trivially and
  // bodyWords could be 0, causing division-by-zero (Infinity density).
  if (a.minWords > 0 && p.bodyWords >= a.minWords) {
    const density = p.promoHits / (p.bodyWords / 100);
    if (density > 1.5) out.push(f('promo-tone', 'medium', `Heavy promotional language (${p.promoHits} superlatives).`, 'Replace bare superlatives with attributed, measured facts — promotional/commodity tone correlates negatively with AI citation, and self-ranking "#1/best" backfires (~69%).'));
  }

  // --- misc ---
  if (!p.lang) out.push(f('lang', 'low', 'Missing <html lang>.', 'Set lang="en" (or appropriate).'));
  if (!p.viewport) out.push(f('viewport', 'low', 'Missing viewport meta.', 'Add a responsive viewport meta.'));
  if (!p.ogTitle) out.push(f('open-graph', 'low', 'Missing Open Graph tags.', 'Add og:title/description/image for social + Discover.'));

  if (cfg.vertical === 'medspa') out.push(...auditMedspaPage(p, cfg));

  return { url: page.url, status: page.status, findings: out, parsed: p };
}

/** Site-level rules (robots, sitemap, duplicate titles). */
export function auditSite({ robots, robotsFound, sitemapFound, pages }, cfg) {
  const out = [];
  if (robots.blockedAICrawlers.length) {
    out.push(f('ai-crawler-block', 'critical',
      `robots.txt blocks AI/search crawlers: ${robots.blockedAICrawlers.join(', ')}.`,
      'Unblock the citation bots you want (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Googlebot, Bingbot). Blocking them = invisible in those answers.'));
  }
  if (!robotsFound) out.push(f('robots', 'low', 'No robots.txt found.', 'Add robots.txt with sitemap reference + explicit AI-crawler allows.'));
  if (!sitemapFound) out.push(f('sitemap', 'high', 'No sitemap found.', 'Publish a sitemap.xml and reference it in robots.txt.'));

  // Duplicate titles across pages
  const titles = new Map();
  for (const r of pages) {
    if (!r.parsed?.title) continue;
    const key = r.parsed.title.toLowerCase();
    titles.set(key, (titles.get(key) || 0) + 1);
  }
  const dupes = [...titles.entries()].filter(([, n]) => n > 1);
  if (dupes.length) out.push(f('duplicate-titles', 'medium', `${dupes.length} duplicated <title> values across the sampled pages.`, 'Make every title unique + intent-specific.', { examples: dupes.slice(0, 5).map(([t]) => t) }));

  // Site-level entity types (Organization/WebSite): present anywhere on the site?
  const allTypes = new Set();
  for (const pr of pages) for (const t of (pr.parsed?.jsonLdTypes || [])) allTypes.add(String(t).toLowerCase());
  for (const want of cfg.schemaTypesExpected || []) {
    if (!allTypes.has(want.toLowerCase())) out.push(f('schema-type', 'medium', `Expected site-level schema type "${want}" not found on any sampled page.`, `Emit ${want} JSON-LD (ideally site-wide via a shared @id).`));
  }

  if (cfg.vertical === 'medspa') out.push(...auditMedspaSite(pages, cfg));
  if (cfg.vertical === 'medspa' || cfg.local) out.push(...auditLocalSite(pages, cfg));
  return out;
}

// ---------------------------------------------------------------------------
// MED-SPA RULE PACK (gated behind cfg.vertical === 'medspa')
// Anchors (high-confidence): schema.org MedicalBusiness/MedicalClinic extend
// LocalBusiness (HealthAndBeautyBusiness/DaySpa are NON-medical); FTC Consumer
// Reviews Rule 16 CFR 465 bans fake/AI reviews; FDA compounded-GLP-1 crackdown
// bans "same active ingredient as Ozempic"-style phrasing. Rules touching reviews,
// GLP-1, before/after, and absolute health claims are FLAG-ONLY (legal exposure) —
// never auto-edited. The AEO numerics are tuning targets, not law.
// ---------------------------------------------------------------------------
const MEDICAL_TYPES = ['medicalbusiness', 'medicalclinic', 'physician', 'dentist'];
const NONMEDICAL_BIZ = ['healthandbeautybusiness', 'dayspa', 'beautysalon'];

/** Compute med-spa signal fields from a page (called inside parsePage). */
// The winning service-page scaffold (live teardown 2026): each section = a self-contained answer island.
const SCAFFOLD_SECTIONS = [
  /\b(am i a candidate|ideal candidate|who is .{0,20}(for|candidate)|good candidate)\b/i,
  /\b(how does .{0,20}work|how it works|the procedure|what to expect)\b/i,
  /\b(downtime|recovery|aftercare|side effects)\b/i,
  /\b(how much|cost|pricing|price)\b/i,
  /\b(who performs|your (injector|provider)|our (team|providers)|meet (the|your|dr))\b/i,
  /\b(vs\.?|versus|compared? to|alternative to)\b/i,
  /\b(faq|frequently asked|common questions)\b/i,
  /\b(results|timeline|how long (does|will)|when will i see)\b/i,
];

export function medspaFields(html, bodyText, jsonLdTypes, cfg = {}) {
  const lc = html || '';
  const bt = bodyText || '';
  const types = new Set((jsonLdTypes || []).map((t) => String(t).toLowerCase()));
  const hasMedicalSchema = MEDICAL_TYPES.some((t) => types.has(t));
  return {
    hasMedicalSchema,
    hasNonMedicalBizSchema: NONMEDICAL_BIZ.some((t) => types.has(t)) || types.has('localbusiness'),
    napSchema: {
      hasPostalAddress: /"PostalAddress"/i.test(lc),
      hasGeo: /"geo"\s*:/i.test(lc),
      hasTelephone: /"telephone"\s*:/i.test(lc),
      hasOpeningHours: /openinghoursspecification/i.test(lc),
    },
    hasServiceOffers: types.has('service') || types.has('medicalprocedure'),
    pricePresent: /"price"\s*:|"pricerange"\s*:/i.test(lc),
    hasProviderSchema: types.has('physician') || types.has('person'),
    reviewerBlock: /medically reviewed by|reviewed by[^.]{0,40}\b(MD|DO|NP|PA|RN)\b|datereviewed/i.test(bt),
    authorByline: /\b(by|written by|author)\b[^.]{0,40}\b(MD|DO|NP|PA|RN|FNP)\b/i.test(bt) || /\/(about|team|providers|staff)\b/i.test(lc),
    faqType: types.has('faqpage'),
    reserveAction: types.has('reserveaction') || types.has('orderaction') || /reserveaction|potentialaction/i.test(lc),
    aggregateRatingInSchema: /"aggregaterating"/i.test(lc),
    hasVisibleReviews: /\breview(s|ed)?\b|\bstar rating\b|out of 5/i.test(bt),
    hasBeforeAfter: /before\s*[&/-]?\s*after|before-and-after|\bb&a\b/i.test(bt) || /before.?after/i.test(lc),
    hasResultsDisclaimer: /results.{0,6}(may )?vary|individual results|not typical/i.test(bt),
    bannedRxHits: (bt.match(/same active ingredient as (ozempic|wegovy|mounjaro|zepbound)|generic (ozempic|zepbound|wegovy|mounjaro)|same (drug|medication) as (ozempic|wegovy|mounjaro|zepbound)/gi) || []).length,
    healthSuperlativeHits: (bt.match(/guaranteed results|permanent results|100% safe|\bno risk\b|risk-free|no side effects|\bmiracle\b|\bcure\b/gi) || []).length,
    // ---- funnel-hack gap signals (live med-spa teardown 2026) ----
    sameAs: /"sameas"\s*:/i.test(lc),
    hasComparison: /\bvs\.?\b|\bversus\b|compared? to\b/i.test(bt),
    costAnswer: /(how much (does|is)|cost of|what.{0,24}cost|pricing|price (range|starts|per|list))/i.test(bt) && /\$\s?\d/.test(bt),
    providerCard: /\b(PA-C|NP-C|FNP|DNP|MSN|MD|DO|RN)\b/.test(bt) || /board[- ]?certified|fellowship[- ]?trained|nurse practitioner|physician assistant/i.test(bt),
    authorityClaim: /board[- ]?certified|fellowship|allergan (black )?diamond|diamond (provider|status|level)|black diamond|castle connolly|top \d+ of [\d,]+|\b[\d,]{2,}\+?\s?(procedures|treatments|patients|injections|reviews)\b/i.test(bt) || /\/(awards?|press|in-the-news)\b/i.test(lc),
    reviewDate: /(last (medically )?reviewed|reviewed on|medically reviewed)[^.\n]{0,30}((19|20)\d{2}|[A-Z][a-z]{2,8}\.? \d{4})|\b(19|20)\d{2}-\d{2}-\d{2}\b/i.test(bt),
    scaffoldHits: SCAFFOLD_SECTIONS.filter((re) => re.test(bt)).length,
    neighborhoodHits: (cfg?.neighborhoods || []).filter((n) => n && bt.toLowerCase().includes(String(n).toLowerCase())).length,
    reviewDatePresent: /(last (medically )?reviewed|reviewed on|medically reviewed)[^.\n]{0,30}((19|20)\d{2}|[A-Z][a-z]{2,8}\.? \d{4})/i.test(bt),
  };
}

const reTest = (reStr, s) => { try { return reStr ? new RegExp(reStr).test(s) : false; } catch { return false; } };

/** Per-page med-spa rules. */
export function auditMedspaPage(p, cfg) {
  const out = [];
  const m = p.medspa;
  if (!m) return out;
  let path = ''; try { path = new URL(p.url).pathname; } catch {}
  const isService = reTest(cfg.servicePathRe, path);
  const isLocation = reTest(cfg.locationPathRe, path);
  const a = cfg.audit;

  // 2 — NAP schema (auto-fixable)
  if (p.jsonLdCount > 0 && !(m.napSchema.hasPostalAddress && m.napSchema.hasTelephone)) out.push(f('medspa-nap-schema', 'high', 'Business schema missing PostalAddress/telephone (NAP).', 'Emit LocalBusiness/MedicalBusiness with postalAddress, geo, telephone, openingHoursSpecification.'));
  // 3 — service offer + pricing (auto-fixable markup; prices human-supplied)
  if (isService && !(m.hasServiceOffers && m.pricePresent)) out.push(f('service-offer-pricing', 'high', 'Service page lacks Service/MedicalProcedure schema with an Offer price.', 'Add Service + Offer (priceRange) — use REAL prices only, never invented.'));
  // 4 — medical reviewer (auto-fixable markup; name human-supplied)
  if (isService && !m.reviewerBlock) out.push(f('medical-reviewer', 'high', 'Treatment page has no "medically reviewed by" / dateReviewed.', 'Add a named medical reviewer (MD/DO/NP/PA) + review date — YMYL E-E-A-T.'));
  // 5 — author credentials
  if (isService && !m.authorByline) out.push(f('author-credentials', 'high', 'No author byline linking to a credentialed provider/team bio.', 'Add an author byline → /providers or /about credentials page.'));
  // 7 — Q&A present → optimize as AEO answer-islands (NOT FAQPage rich results, deprecated May 2026).
  // Service pages get the dedicated answer-capsule rule below; this covers location pages.
  if (isLocation && (p.headings || []).some((h) => QUESTION_RE.test(h.text)) && p.answerWords < 40) out.push(f('qa-answer-capsule', 'medium', 'Question-form headings present but no concise answer beneath them.', 'Lead each question with a 40-60 word direct answer (AEO answer-island for AI citation). Do NOT rely on FAQPage schema for rich results — deprecated May 2026.'));
  // 9 — review authenticity (FLAG-ONLY: never auto-fix by fabricating ratings)
  if (m.aggregateRatingInSchema && !m.hasVisibleReviews) out.push(f('review-authenticity', 'high', 'AggregateRating in schema not corroborated by visible reviews on the page.', 'FTC 16 CFR 465: remove the unsupported AggregateRating or surface the real reviews. FLAG ONLY — never fabricate ratings.'));
  // 10 — before/after disclaimer (FLAG-ONLY, critical)
  if (m.hasBeforeAfter && !m.hasResultsDisclaimer) out.push(f('before-after-disclaimer', 'critical', 'Before/after imagery without a results-disclaimer.', 'Add "results may vary / individual results" + confirm written FTC + HIPAA consent. FLAG ONLY — never auto-edit copy.'));
  // 11 — GLP-1 Rx claims (FLAG-ONLY, critical)
  if (m.bannedRxHits > 0) out.push(f('glp1-rx-claims', 'critical', 'FDA-flagged compounded-GLP-1 phrasing detected ("same active ingredient as Ozempic"-style).', 'Remove the phrasing; route to human/legal review. FLAG ONLY — never auto-edit.'));
  // 12 — absolute health superlatives (FLAG-ONLY; HIGH on service pages)
  if (m.healthSuperlativeHits > 0) out.push(f('health-claim-superlatives', isService ? 'high' : 'medium', 'Absolute medical claims (guaranteed/permanent/100% safe/cure).', 'Replace with measured, attributed language. Human-reviewed (medical claim).'));
  // 13 — freshness for AI (auto-fix only on a REAL update; fake-refresh is veto-listed)
  if ((isService || isLocation) && p.modified) { const days = (Date.now() - Date.parse(p.modified)) / 86400000; if (Number.isFinite(days) && days > (a.medspaFreshnessDays || 30)) out.push(f('medspa-freshness-ai', 'medium', `Service/location page last modified ${Math.round(days)} days ago (> ${a.medspaFreshnessDays || 30}).`, 'Re-date on a REAL content update — never fake-refresh.')); }
  // 14 — answer capsule on service pages
  if (isService && (p.answerWords < a.answerWordsMin || p.answerWords > a.answerWordsMax + 40)) out.push(f('answer-capsule-medspa', 'high', 'Service page lacks a tight 40-60 word answer capsule up top.', 'Open with a concise direct answer to the page\'s core question.'));
  // 15 — geo modifier in the URL slug (flag + PROPOSE only; NEVER auto-rewrite a live URL → 301 plan required)
  if (isService || isLocation) {
    const slug = path.toLowerCase();
    const cityTok = String(cfg.locations?.[0]?.nap?.city || cfg.serviceAreaGeos?.[0] || cfg.locations?.[0]?.city || '').toLowerCase().split(/[\s,]+/).filter(Boolean)[0];
    if (cityTok && cityTok.length > 2 && !slug.includes(cityTok)) out.push(f('medspa-geo-slug', 'medium', `Service/location slug "${path}" omits the geo modifier ("${cityTok}").`, 'Propose a geo-in-slug URL (/treatment-city/) WITH a 301 redirect plan — NEVER auto-rewrite a live URL.'));
  }
  // 16 — visible cost answer-block ("how much does X cost in [city]" + price range) — the top AEO trigger (REAL prices only)
  if (isService && !m.costAnswer) out.push(f('medspa-cost-answer', 'medium', 'No visible cost answer-block (a "how much does X cost" heading + a real price range).', 'Add a cost question-heading + a REAL price-range answer (human-supplied prices) — the single most-cited AEO trigger.'));
  // 17 — service-page scaffold completeness (flag only when MISSING; never pad with filler)
  if (isService && m.scaffoldHits < 5) out.push(f('medspa-scaffold', 'medium', `Service page covers only ${m.scaffoldHits}/8 high-value sections (candidate / how-it-works / recovery / cost / provider / comparison / FAQ / timeline).`, 'Add the missing answer-island sections with REAL content — one concise answer per section, no filler.'));
  // 18 — named credentialed provider card on the service page (strongest E-E-A-T move)
  if (isService && !m.providerCard) out.push(f('medspa-provider-card', 'medium', 'No named credentialed provider (MD/DO/NP/PA-C, board-cert) visible on the treatment page.', 'Add a provider card (name + credential + photo + rating) and attribute the FAQ to them.'));
  // 19 — neighborhood / service-area coverage (single-location capture; cap mentions to avoid stuffing)
  if ((isService || isLocation) && Array.isArray(cfg.neighborhoods) && cfg.neighborhoods.length && m.neighborhoodHits < Math.min(3, cfg.neighborhoods.length)) out.push(f('medspa-neighborhood-coverage', 'low', `Page mentions only ${m.neighborhoodHits} of ${cfg.neighborhoods.length} configured neighborhoods.`, 'Add a natural "Communities We Serve" block naming adjacent neighborhoods (captures "near [neighborhood]") — cap the count, never stuff.'));
  // 20 — review-date refinement: a reviewer byline with no VISIBLE review date is a weak YMYL/freshness signal
  if (isService && m.reviewerBlock && !m.reviewDate) out.push(f('medspa-reviewer-date', 'low', 'Medical-reviewer byline has no visible review DATE.', 'Add "Last medically reviewed <Month Year>" beside the reviewer + ≥1 real authority citation — the strongest YMYL freshness signal.'));
  return out;
}

/** Site-level med-spa rules. */
export function auditMedspaSite(pages, cfg) {
  const out = [];
  const parsed = pages.map((p) => p.parsed).filter(Boolean);
  if (!parsed.length) return out;
  const anyMedical = parsed.some((p) => p.medspa?.hasMedicalSchema);
  const anyBiz = parsed.some((p) => p.medspa?.hasNonMedicalBizSchema);
  const anyProvider = parsed.some((p) => p.medspa?.hasProviderSchema);
  const anyReserve = parsed.some((p) => p.medspa?.reserveAction);
  // 1 — medical schema type (critical, site)
  if (!anyMedical && anyBiz) out.push(f('medspa-schema-type', 'critical', 'Site uses non-medical schema (DaySpa/HealthAndBeautyBusiness/LocalBusiness) — not MedicalBusiness.', 'Emit MedicalBusiness or MedicalClinic (extends LocalBusiness) via a shared @id. (Do NOT upgrade a genuinely non-medical day spa.)'));
  // 6 — provider schema (medium, site)
  if (!anyProvider) out.push(f('provider-schema', 'medium', 'No Person/Physician schema anywhere — providers/credentials not machine-readable.', 'Add Person/Physician JSON-LD for named providers (YMYL trust).'));
  // 8 — booking action (medium, site)
  if (!anyReserve) out.push(f('booking-action', 'medium', 'No ReserveAction/OrderAction anywhere — no machine-readable "book" action.', 'Inject a ReserveAction pointing at the booking URL (Boulevard/Vagaro) — also enables Reserve-with-Google.'));
  // 19-21 — funnel-hack gaps (live teardown 2026): citable authority, comparison content, entity stitching
  if (!parsed.some((p) => p.medspa?.authorityClaim)) out.push(f('medspa-authority-claim', 'low', 'No citable authority datapoint anywhere (board-cert, Allergan Diamond, fellowship, award, procedure-volume).', 'Surface VERIFIABLE third-party authority (real credentials/awards only) — the datapoints AI engines reproduce.'));
  if (!parsed.some((p) => p.medspa?.hasComparison)) out.push(f('medspa-comparison-gap', 'low', 'No comparison/versus page (e.g. "Botox vs Dysport") anywhere.', 'Add ONE treatment-vs-treatment comparison page (NEVER name competitors) — AI lifts these to resolve "which is better".'));
  if (!parsed.some((p) => p.medspa?.sameAs)) out.push(f('medspa-entity-sameas', 'medium', 'Business schema has no sameAs[] linking GBP/Yelp/RealSelf/Healthgrades (+ Wikidata QID).', 'Add a sameAs[] array to Organization/MedicalBusiness JSON-LD — entity establishment precedes AI recommendation.'));
  return out;
}

// ===== E1: local-map-pack rules (gated: cfg.vertical==='medspa' OR cfg.local) =====
// Evidence: research/local-ranking-factors-2026.md — the consolidated 2026 local model
// (Sterling Sky / Whitespark LSRF 2026 / SearchLab). Page-checkable slice only; the
// GBP-side factors (categories, landing-page diversity, review velocity) live in
// src/local/factors.mjs + src/local/reviews.mjs and the `local <client>` CLI.

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Local signal fields from one page (called inside parsePage when gated). */
export function localFields(html, bodyText, cfg = {}) {
  const lc = html || '';
  const bt = (bodyText || '').toLowerCase().replace(/\s+/g, ' ');
  const nap = cfg.listings?.canonicalNap || cfg.locations?.[0]?.nap || null;
  const street = String(nap?.street || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const city = String(nap?.city || cfg.serviceAreaGeos?.[0] || '').toLowerCase().trim();
  const zip = String(nap?.zip || '').trim();
  const hoods = (cfg.neighborhoods || []).filter(Boolean).map((n) => String(n).toLowerCase());
  const markerSources = [
    street ? bt.includes(street) : false,
    zip ? new RegExp(`\\b${escRe(zip)}\\b`).test(bt) : false,
    ...hoods.map((n) => bt.includes(n)),
  ];
  const configured = !!(street || zip || hoods.length);
  return {
    // null = unconfigured → honest "unknown", never a silent pass or a false issue
    streetVisible: street ? bt.includes(street) : null,          // visible-address (Sterling Sky, 7th factor)
    cityMentions: city ? (bt.match(new RegExp(`\\b${escRe(city)}\\b`, 'g')) || []).length : null,
    localMarkers: configured ? markerSources.filter(Boolean).length : null, // Gifford swap-test inputs
    hoursSchema: /openinghoursspecification/i.test(lc),           // open-at-time-of-search needs machine-readable hours
    geoSchema: /"geo"\s*:/i.test(lc),
  };
}

/** Site-level local rules (page-checkable slice of the local factor model). */
export function auditLocalSite(pages, cfg) {
  const out = [];
  const parsed = pages.map((p) => p.parsed).filter((p) => p && p.local);
  if (!parsed.length) return out;

  // visible-address — ground-truth (Sterling Sky replicated, ~7th factor): only when a
  // street is configured; unconfigured stays "unknown" (handled by the local CLI), never a guess.
  const nap = cfg.listings?.canonicalNap || cfg.locations?.[0]?.nap || null;
  if (nap?.street && !parsed.some((p) => p.local.streetVisible === true)) {
    out.push(f('local-visible-address', 'high',
      `Configured street address ("${nap.street}") is not visible on any sampled page.`,
      'Show the full NAP (street included) as crawlable text — SABs/suite businesses that hide the address drop in the pack; revealing it recovers (Sterling Sky, replicated). See research/local-ranking-factors-2026.md §1.5.'));
  }

  // hours schema — ground-truth ("open at time of search" = #5 2026 factor, Whitespark):
  // engines can only apply the factor if the hours are machine-readable + accurate.
  if (!parsed.some((p) => p.local.hoursSchema)) {
    out.push(f('local-hours-schema', 'medium',
      'No openingHoursSpecification JSON-LD found on any sampled page.',
      'Emit ACCURATE openingHoursSpecification in the business schema — "open at time of search" is the #5 local-pack factor (Whitespark 2026); never list hours you do not keep. See research/local-ranking-factors-2026.md §1.4.'));
  }

  // content-authenticity swap test — methodology (Gifford/SearchLab): home/location copy
  // with ZERO local markers beyond the brand string is city-swappable = too generic.
  for (const p of parsed) {
    if (p.bodyWords < 50) continue; // JS shells are js-dependence findings, not "generic copy"
    let path = ''; try { path = new URL(p.url).pathname; } catch {}
    const isHome = path === '/' || path === '';
    const isLocation = reTest(cfg.locationPathRe, path);
    if ((isHome || isLocation) && p.local.cityMentions === 0 && p.local.localMarkers === 0) {
      out.push(f('local-generic-copy', 'medium',
        `${isHome ? 'Homepage' : 'Location page'} (${path || '/'}) fails the swap test: no city mention, no street/zip/neighborhood markers.`,
        'Rewrite so the copy only works for THIS business in THIS city (Gifford content-authenticity test) — name the city, street, neighborhoods with REAL local facts, never stuffing. See research/local-ranking-factors-2026.md §1.11.',
        { url: p.url }));
    }
  }
  return out;
}
// ===== end E1: local-map-pack rules =====
