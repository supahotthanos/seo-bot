// seo-bot · content/blog-radar — reverse-engineer the blogs that ACTUALLY rank for a topic,
// then brief a LOCALIZED, more-complete original (never a spun copy).
//
// The play you asked for: "what's ranking for what → rank for it in a local version." This maps
// the winning structure across the top competitor pages (the outline the SERP rewards, the
// questions they answer, the schema they ship, the depth) and turns it into a CONTENT BRIEF that
// the existing content pipeline drafts — through the anti-slop + YMYL gates, human review, PR-only.
//
// HARD LINE (why this isn't the grey stuff): this module reads competitor HTML to learn the
// TOPIC SHAPE. It never copies sentences, never republishes, never auto-publishes. The draft is
// written fresh and must clear content/gates (no fabricated numbers, no GLP-1 brand claims) and a
// human merges the PR. Mapping what ranks is research; the words are original.

import * as cheerio from 'cheerio';

const clean = (s = '') => String(s).replace(/\s+/g, ' ').trim();

/** PURE: extract the ranking structure of ONE competitor blog page. */
export function extractBlogStructure(html = '', url = '') {
  const $ = cheerio.load(html || '');
  // Read JSON-LD schema BEFORE stripping <script> (order matters — the ld+json lives in scripts).
  const schemaTypes = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).contents().text() || '{}');
      for (const o of (Array.isArray(j) ? j : [j])) {
        const t = o && (o['@type'] || (o['@graph'] || []).map((g) => g['@type']));
        if (t) schemaTypes.push(...[].concat(t).flat().filter(Boolean));
      }
    } catch { /* malformed JSON-LD — ignore, never throw */ }
  });
  $('script, style, nav, footer, header, aside').remove();
  const h1 = clean($('h1').first().text());
  const headings = [];
  $('h2, h3').each((_, el) => {
    const level = ($(el).prop('tagName') || 'H2').toLowerCase() === 'h3' ? 3 : 2;
    const t = clean($(el).text());
    if (t && t.length <= 160) headings.push({ level, text: t });
  });
  const bodyText = clean($('body').text());
  const wordCount = bodyText ? bodyText.split(' ').length : 0;
  // questions = interrogative headings + any short question sentence in the body
  const questions = [...new Set(
    headings.map((h) => h.text).filter((t) => /\?$/.test(t))
      .concat((bodyText.match(/[A-Z][^.?!]{8,120}\?/g) || []).map(clean)),
  )].slice(0, 30);
  return { url, title: clean($('title').text()) || h1, h1, headings, questions, schemaTypes: [...new Set(schemaTypes)], wordCount };
}

// Informational/blog intent — the queries a blog (not a service page) should win.
const BLOG_INTENT = /\b(how|what|why|when|which|best|top|cost|price|guide|tips|vs|versus|before|after|does|is|are|can|should|worth|safe|difference)\b/i;

/** PURE: rank blog-intent topic opportunities from this client's own GSC demand.
 *  Opportunity = real impressions we're NOT capturing (weak position or low CTR). */
export function topicOpportunities(gscRows = [], cfg = {}) {
  const seen = new Set();
  return gscRows
    .filter((r) => r && typeof r.query === 'string' && BLOG_INTENT.test(r.query) && Number(r.impressions || 0) > 0)
    .map((r) => {
      const impr = Number(r.impressions || 0), clicks = Number(r.clicks || 0), pos = Number(r.position || 99);
      const ctr = impr ? clicks / impr : 0;
      // weight demand by how much we're LEAVING on the table (off page 1, or low CTR despite impressions)
      const capture = pos > 10 ? 1 : pos > 5 ? 0.6 : (ctr < 0.02 ? 0.8 : 0.3);
      return { topic: clean(r.query), impressions: impr, clicks, position: +pos.toFixed(1), opportunity: +(impr * capture).toFixed(1) };
    })
    .sort((a, b) => b.opportunity - a.opportunity)
    .filter((r) => { const k = r.topic.toLowerCase().replace(/[^a-z0-9 ]/g, ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** PURE: synthesize a LOCALIZED content brief from the competitor structures that rank. */
export function synthesizeBrief(topic = '', structures = [], cfg = {}) {
  const ok = structures.filter((s) => s && s.wordCount > 0);
  const nap = cfg.listings?.canonicalNap || {};
  const city = cfg.city || cfg.location || nap.city || '';
  const brand = cfg.brand || cfg.name || '';
  // heading frequency across competitors → the outline the SERP rewards
  const headMap = new Map();
  for (const s of ok) {
    for (const h of (s.headings || [])) {
      const key = h.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      if (!key) continue;
      const prev = headMap.get(key) || { text: h.text, level: h.level, count: 0 };
      prev.count += 1; headMap.set(key, prev);
    }
  }
  const outline = [...headMap.values()].sort((a, b) => b.count - a.count);
  const half = Math.max(2, Math.ceil(ok.length / 2));
  const consensusOutline = outline.filter((h) => h.count >= half);              // table stakes: ≥half cover it
  const differentiators = outline.filter((h) => h.count === 1).slice(0, 12);    // unique angles = your edge
  const questions = [...new Set(ok.flatMap((s) => s.questions || []))].slice(0, 20);
  const schema = [...new Set(ok.flatMap((s) => s.schemaTypes || []))];
  const words = ok.map((s) => s.wordCount).sort((a, b) => a - b);
  const medianWords = words.length ? words[Math.floor(words.length / 2)] : 0;
  return {
    topic, city, brand,
    competitorsAnalyzed: ok.length,
    sources: ok.map((s) => s.url).filter(Boolean),
    targetWordCount: Math.round(medianWords * 1.15) || null,               // beat median by being MORE complete
    consensusOutline: consensusOutline.map((h) => ({ level: h.level, text: h.text, competitorsCovering: h.count })),
    differentiators: differentiators.map((h) => ({ level: h.level, text: h.text })),
    questionsToAnswer: questions,
    schemaToInclude: schema.length ? schema : ['Article', ...(questions.length ? ['FAQPage'] : [])],
    localAngle: city
      ? `Localize to ${city}: real ${city} price ranges, ${city}-area providers & state rules, "near me" framing, neighborhoods/landmarks, local reviews.`
      : 'No city set — add listings.canonicalNap.city to unlock the local angle (this is the whole point of the play).',
    status: ok.length ? 'ok' : 'insufficient-sources',
    note: 'ORIGINAL draft only — this brief maps the topic shape that ranks; the words are written fresh through content/gates (no fabrication / no GLP-1 brand claims) + human review + PR. No scrape-and-spin.',
  };
}

/** I/O orchestrator: fetch the ranking competitor pages for a topic → mine → localized brief.
 *  competitorUrls come from the caller (SERP scrape / sources.json cited domains). Fail-closed:
 *  no reachable competitor pages → refuse (never fabricate a brief). */
export async function runBlogRadar(topic, competitorUrls = [], cfg = {}, { log = () => {}, fetchOne = null, max = 6 } = {}) {
  const urls = [...new Set(competitorUrls.filter((u) => /^https?:\/\//i.test(u)))].slice(0, Math.max(1, max));
  if (!urls.length) { log(`  blog-radar: no competitor URLs for "${topic}" — refusing (fail-closed)`); return { status: 'no-sources', topic }; }
  const fetch = fetchOne || (async (u) => { const { fetchSmart } = await import('../research/fetcher.mjs'); const r = await fetchSmart(u); return r?.html || r?.body || ''; });
  const structures = [];
  for (const u of urls) {
    try { const html = await fetch(u); if (html) structures.push(extractBlogStructure(html, u)); }
    catch (e) { log(`  blog-radar: ${u} unreachable (${String(e.message || e).slice(0, 60)})`); }
  }
  const brief = synthesizeBrief(topic, structures, cfg);
  log(`  blog-radar "${topic}": ${brief.competitorsAnalyzed} competitor page(s) mined · target ${brief.targetWordCount || '?'}w · ${brief.consensusOutline.length} consensus sections`);
  return brief;
}
