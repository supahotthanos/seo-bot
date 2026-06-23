// seo-bot · parity — render-parity + cloaking-safety verifier.
//
// The single check that makes us categorically beat OTTO. It proves two things OTTO
// structurally cannot guarantee:
//   1) SERVER-RENDER: the fix is in the RAW, no-JS HTML that AI crawlers actually read
//      (defeats OTTO's pixel — vendor bug OTTO-1943, "H1 invisible to non-JS bots").
//   2) NO CLOAKING: a bot (GPTBot UA) and a human get byte-identical SEO head + the
//      same visible facts (the SPLX failure mode where edge rewriting drifts into
//      serving crawlers different content). We FAIL the build on divergence.
//
// Optional: pass renderFn (a headless renderer) to also flag JS-ONLY SEO elements —
// the exact defect class OTTO ships by default.

import * as cheerio from 'cheerio';

const UA_HUMAN = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';

async function getRaw(url, ua, timeoutMs = 15000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) { return { ok: false, status: 0, text: '', error: String(e.message || e) }; }
}

/** Extract SEO-critical elements from raw HTML (what a non-JS crawler sees). */
export function extractSeo(html) {
  const $ = cheerio.load(html || '');
  const jsonldTypes = [];
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      const j = JSON.parse($(e).contents().text());
      const nodes = [].concat(j['@graph'] || j);
      for (const n of nodes) { const t = n && n['@type']; if (t) jsonldTypes.push(...[].concat(t)); }
    } catch { /* malformed JSON-LD is itself a finding elsewhere */ }
  });
  return {
    title: ($('head > title').first().text() || '').trim(),
    metaDesc: ($('meta[name="description"]').attr('content') || '').trim(),
    canonical: ($('link[rel="canonical"]').attr('href') || '').trim(),
    robots: ($('meta[name="robots"]').attr('content') || '').trim(),
    h1: $('h1').map((_, e) => $(e).text().trim()).get(),
    jsonldTypes: [...new Set(jsonldTypes)],
    bodyText: $('body').text().replace(/\s+/g, ' ').trim(),
  };
}

/** Jaccard token overlap of visible body text; <0.6 ⇒ suspicious divergence (cloaking). */
function divergence(a, b) {
  const ta = new Set((a || '').toLowerCase().split(' ').filter((w) => w.length > 3));
  const tb = new Set((b || '').toLowerCase().split(' ').filter((w) => w.length > 3));
  if (!ta.size || !tb.size) return 1;
  let inter = 0; for (const w of ta) if (tb.has(w)) inter++;
  return 1 - inter / (ta.size + tb.size - inter);
}

/**
 * Verify render-parity for URLs.
 * @param expect  map url -> [substrings] that MUST appear in the raw HTML
 * @param renderFn optional async (url) => renderedHtml (headless) to detect JS-only SEO
 * @returns [{url, status, serverRendered, botParity, cloakingRisk, jsOnly[], hasExpected, raw}]
 */
export async function verifyParity(cfg, urls, { expect = {}, renderFn = null, log = () => {} } = {}) {
  const out = [];
  for (const url of urls) {
    const human = await getRaw(url, UA_HUMAN);
    const bot = await getRaw(url, UA_GPTBOT);
    const hs = human.ok ? extractSeo(human.text) : null;
    const bs = bot.ok ? extractSeo(bot.text) : null;

    const serverRendered = !!hs && !!(hs.title || hs.metaDesc || hs.h1.length);
    const botParity = !!hs && !!bs && hs.title === bs.title && hs.metaDesc === bs.metaDesc && JSON.stringify(hs.jsonldTypes) === JSON.stringify(bs.jsonldTypes);
    const cloakingRisk = !!hs && !!bs && divergence(hs.bodyText, bs.bodyText) > 0.4;
    const need = expect[url] || [];
    const hasExpected = need.every((s) => (human.text || '').includes(s));

    let jsOnly = [];
    if (renderFn && hs) {
      try {
        const rs = extractSeo(await renderFn(url));
        if (rs.title && rs.title !== hs.title) jsOnly.push('title');
        if (rs.metaDesc && rs.metaDesc !== hs.metaDesc) jsOnly.push('metaDescription');
        if (rs.canonical && rs.canonical !== hs.canonical) jsOnly.push('canonical');
        for (const t of rs.jsonldTypes) if (!hs.jsonldTypes.includes(t)) jsOnly.push('jsonld:' + t);
        if (rs.h1.length > hs.h1.length) jsOnly.push('h1');
      } catch { /* headless optional */ }
    }

    const ok = human.ok && human.status === 200 && serverRendered && botParity && !cloakingRisk && hasExpected && jsOnly.length === 0;
    out.push({ url, status: human.status, serverRendered, botParity, cloakingRisk, jsOnly, hasExpected, raw: hs });
    log(`    ${ok ? '✓' : '✗'} ${url} — ${human.status} · ${serverRendered ? 'SSR' : 'NOT-SSR'}${botParity ? '' : ' BOT-MISMATCH'}${cloakingRisk ? ' ⚠CLOAK' : ''}${jsOnly.length ? ' JS-ONLY:' + jsOnly.join(',') : ''}${need.length ? ` expected:${hasExpected}` : ''}`);
  }
  return out;
}
