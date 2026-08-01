// seo-bot · measure/push-targets — turn SELF-AEO fan-out captures into a placement hit-list.
//
// Input: the seenai query-bank observations (what ChatGPT answers when prospects ask "best AI
// SEO company" / "how do I get ranked on ChatGPT"). Output: the three things that matter for
// pushing SeenAI into those answers —
//   1) FAN-OUT SUB-QUERIES the engine actually ran (what our own content must be the answer to),
//   2) CITED SOURCE DOMAINS (the ranked list of places to get SeenAI placed/mentioned),
//   3) COMPETITORS the engine names today (who currently owns the answer),
// plus honest brand-presence accounting (how often SeenAI already appears — expected: ~never).
//
// PURE + testable: aggregation only, no IO. Consumers filter status === 'ok' rows themselves? No —
// this module filters, matching the panel convention (blocked/junk rows never count).

import { canonicalBrand } from './query-bank.mjs';

const hostOf = (u) => { try { return new URL(String(u).startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** Aggregate ok-rows into the push-target rollup. brandTokens match SeenAI mentions. */
export function buildPushTargets(observations = [], { brand = 'SeenAI', brandTokens = ['seenai', 'seen ai'] } = {}) {
  const ok = (observations || []).filter((o) => o && o.status === 'ok');
  const subq = new Map(); const sources = new Map(); const competitors = new Map();
  let brandHits = 0;
  const byIntent = new Map();
  for (const o of ok) {
    const intent = o.intent || o.queryId || '?';
    byIntent.set(intent, (byIntent.get(intent) || 0) + 1);
    for (const q of (o.subqueries || [])) {
      const k = String(q).toLowerCase().trim();
      if (k.length >= 4) subq.set(k, (subq.get(k) || 0) + 1);
    }
    const urls = [...((o.citations && o.citations.urls) || []), ...(((o.sturm || {}).contentReferences) || []).map((r) => r.url)];
    const seenHosts = new Set();
    for (const u of urls) { const h = hostOf(u); if (h && !seenHosts.has(h)) { seenHosts.add(h); sources.set(h, (sources.get(h) || 0) + 1); } }
    for (const r of (o.ranked || [])) {
      const k = canonicalBrand(r.name || '');
      if (k && k.length >= 3) competitors.set(k, (competitors.get(k) || 0) + 1);
    }
    const hay = (JSON.stringify(o.ranked || []) + ' ' + (o.answer || o.answerExcerpt || '') + ' ' + urls.join(' ')).toLowerCase();
    if (brandTokens.some((t) => hay.includes(t))) brandHits += 1;
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, count]) => ({ k, count }));
  return {
    sampled: ok.length,
    brand, brandHits,
    intents: [...byIntent.entries()].map(([intent, count]) => ({ intent, count })),
    fanout: top(subq, 25).map(({ k, count }) => ({ query: k, count })),
    sources: top(sources, 25).map(({ k, count }) => ({ domain: k, count })),
    competitors: top(competitors, 20).map(({ k, count }) => ({ name: k, count })),
  };
}

/** The rollup as a human playbook page. */
export function renderPushTargetsMd(t, { generatedAt = '' } = {}) {
  const L = [
    `# SeenAI push targets — where AI answers come from`,
    '',
    `_${t.sampled} live answers sampled · ${t.brand} named in ${t.brandHits}/${t.sampled} · generated ${generatedAt}_`,
    '',
    '## 1 · Cited sources = the placement hit-list',
    'These are the domains ChatGPT actually pulled from when prospects asked our money questions.',
    'A mention/listing/profile on each is a direct path into the answer.',
    '',
    '| # | Domain | Cited in |',
    '|---|--------|----------|',
    ...t.sources.map((s, i) => `| ${i + 1} | ${s.domain} | ${s.count} answer(s) |`),
    '',
    '## 2 · Fan-out sub-queries = what our pages must answer',
    'The engine reformulated our prospects\' questions into these searches — each is a page/heading target.',
    '',
    ...t.fanout.map((q) => `- "${q.query}" ×${q.count}`),
    '',
    '## 3 · Who owns the answer today',
    '',
    ...t.competitors.map((c, i) => `${i + 1}. ${c.name} ×${c.count}`),
    '',
    '## Sampled intents',
    ...t.intents.map((x) => `- ${x.intent}: ${x.count} answer(s)`),
    '',
    '_Method: Sturm-style capture off the live ChatGPT session (network-level fan-out + citations)._',
  ];
  return L.join('\n');
}
