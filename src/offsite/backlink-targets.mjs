// seo-bot · offsite/backlink-targets — backlink-target discovery (GOAL criterion 7).
//
// Ranks the domains worth EARNING a link/mention from — built from what engines ACTUALLY
// cite in our panel (not a purchased index): score = citation frequency × attainability,
// minus a toxicity veto. Also computes the competitor gap: domains citing competitors but
// not us. Output is a ranked worksheet — a HUMAN earns every link (pitches, listings,
// contributions). No PBNs, no paid links, no link exchanges: a toxic-vetoed row is shown
// WITH its reason so nobody "just this once"s it.

import { classify } from '../sources/index.mjs';

// Attainability by source class (claimable directories >> editorial press).
const ATTAINABILITY = { 'review-directory': 0.9, 'ugc-community': 0.7, encyclopedic: 0.35, competitor: 0, own: 0, other: 0.5 };

// Toxic/PBN-pattern heuristics — deterministic, explainable, conservative.
const TOXIC_PATTERNS = [
  { re: /(-[a-z0-9]+){3,}\.(com|net|org|info|biz)/i, why: 'multi-hyphen spam-pattern domain' },
  { re: /\.(xyz|top|click|link|gq|cf|tk|ml|work|loan)$/i, why: 'high-abuse TLD' },
  { re: /(seo|backlink|guestpost|linkbuild|pbn)[a-z0-9-]*\.(com|net|org)/i, why: 'link-scheme footprint in domain' },
  { re: /article(s)?(directory|hub|base)|ezinearticle/i, why: 'article-farm footprint' },
  { re: /\d{4,}\.(com|net|org)/i, why: 'numeric throwaway domain' },
];

/** PURE: toxicity check — {toxic, why} */
export function vetDomain(domain = '') {
  const d = String(domain).toLowerCase();
  for (const t of TOXIC_PATTERNS) if (t.re.test(d)) return { toxic: true, why: t.why };
  return { toxic: false, why: '' };
}

const hostOf = (u = '') => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** PURE: aggregate cited domains from capture citations + a sources report. */
export function citedDomains(captures = [], sourcesReport = null, cfg = {}) {
  const counts = new Map();
  const bump = (host, viaBrand) => {
    if (!host) return;
    const rec = counts.get(host) || { domain: host, cites: 0, competitorCites: 0 };
    rec.cites += 1;
    if (viaBrand === 'competitor') rec.competitorCites += 1;
    counts.set(host, rec);
  };
  for (const c of captures) {
    if (!c || c.status !== 'ok') continue;
    for (const u of (c.citations?.urls || [])) bump(hostOf(u), null);
  }
  // Tolerant readers: the on-disk sources.json ships { topSources:[{host,type,citations,...}] };
  // legacy/test shapes ship { domains:[] } / { rows:[] }. Accept all; deduped by counts.
  const sourceRows = sourcesReport?.topSources || sourcesReport?.domains || sourcesReport?.rows || [];
  for (const row of sourceRows) {
    const host = hostOf(row.host || row.domain || '');
    if (!host) continue;
    const rec = counts.get(host) || { domain: host, cites: 0, competitorCites: 0, sourceType: row.type || null };
    rec.cites += Number(row.citations || row.count || row.cites || 1) || 1;
    if (row.type === 'competitor' || row.class === 'competitor' || row.competitor) rec.competitorCites += 1;
    if (row.type && !rec.sourceType) rec.sourceType = row.type;
    counts.set(host, rec);
  }
  return [...counts.values()];
}

/**
 * PURE: the ranked target list. Score = cites × attainability(class); toxic rows carry
 * score 0 + the veto reason (visible, never silently dropped). Own/competitor domains are
 * classified out of the earnable pool.
 */
export function buildBacklinkTargets(captures = [], sourcesReport = null, cfg = {}) {
  const domains = citedDomains(captures, sourcesReport, cfg);
  const rows = domains.map((d) => {
    // Prefer the source-report's stamped type when classify() returns 'other' — the sources
    // classifier already sorted these into review-directory / ugc-community / encyclopedic.
    const guess = classify(d.domain, cfg);
    const cls = (guess === 'other' && d.sourceType && d.sourceType !== 'other') ? d.sourceType : guess;
    const vet = vetDomain(d.domain);
    const attain = ATTAINABILITY[cls] ?? 0.5;
    const score = vet.toxic || cls === 'own' || cls === 'competitor' ? 0 : +(d.cites * attain).toFixed(2);
    return { ...d, class: cls, attainability: attain, toxic: vet.toxic, toxicWhy: vet.why, score };
  }).sort((a, b) => b.score - a.score || b.cites - a.cites);
  return { status: rows.length ? 'ok' : 'empty', rows, earnable: rows.filter((r) => r.score > 0), vetoed: rows.filter((r) => r.toxic) };
}

/** PURE: domains citing competitors where we're absent = the sharpest outreach list. */
export function competitorGap(captures = [], sourcesReport = null, cfg = {}) {
  const { rows } = buildBacklinkTargets(captures, sourcesReport, cfg);
  return rows.filter((r) => r.competitorCites > 0 && !r.toxic && r.class !== 'own' && r.class !== 'competitor')
    .sort((a, b) => b.competitorCites - a.competitorCites);
}
