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
  const paras = $('p').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get();
  for (const p of paras) { if (countWords(p) >= 12) { answerText = p; answerWords = countWords(p); break; } }

  // JSON-LD
  const jsonLdTypes = [];
  let jsonLdValid = true, jsonLdCount = 0;
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
      collect(data);
    } catch { jsonLdValid = false; }
  });

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

  const medspa = cfg?.vertical === 'medspa' ? medspaFields(html, bodyText, jsonLdTypes) : null;

  return {
    url, title, titleLen: title.length, metaDesc, metaLen: metaDesc.length, canonical, robotsMeta, lang, viewport, ogTitle,
    h1s, headings, bodyWords, answerWords, answerText, jsonLdTypes, jsonLdValid, jsonLdCount,
    internal, external, genericAnchorCount, lowVarietyTargets, imgCount: imgs.length, imgsMissingAlt, modified, promoHits, looksSpaShell,
    htmlBytes: Buffer.byteLength(html || '', 'utf8'), medspa,
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

  // --- noindex ---
  if (/noindex/.test(p.robotsMeta)) {
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
  if (p.bodyWords >= a.minWords) {
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

  // --- freshness ---
  if (p.bodyWords >= a.minWords) {
    if (!p.modified) out.push(f('freshness', 'medium', 'No dateModified / visible update date.', 'Emit dateModified in schema and show "Updated <Month> 2026" — cited content skews fresher.'));
    else {
      const days = (Date.now() - Date.parse(p.modified)) / 86400000;
      if (Number.isFinite(days) && days > a.freshnessDays) out.push(f('freshness', 'medium', `Content last modified ${Math.round(days)} days ago.`, 'Refresh + re-date; freshness strongly correlates with AI citation.'));
    }
  }

  // --- promotional tone (negative citation signal) ---
  if (p.bodyWords >= a.minWords) {
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
export function medspaFields(html, bodyText, jsonLdTypes) {
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
  return out;
}
