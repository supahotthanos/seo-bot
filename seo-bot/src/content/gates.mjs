// seo-bot · content/gates — the anti-slop quality gates. This is what makes
// automated content "not AI blogs": a draft is a DATA-TO-DRAFT artifact that must
// clear HARD gates (binary, block publish) and earn a SOFT score, before a human
// one-click-approves anything touching medical/price/efficacy claims (YMYL).
//
// The defense is genuine per-page uniqueness + grounding + compliance, NOT
// "humanizing" prose (2026 detectors fail on stylometry; Google judges value at
// the cluster level). Every number in the draft must trace to the brief — that
// single rule kills hallucinated stats, the #1 slop tell.

import { verifyReviewer } from '../integrity.mjs';

const PRIMARY_SOURCES = [/fda\.gov/, /pubmed\.ncbi\.nlm\.nih\.gov/, /ncbi\.nlm\.nih\.gov/, /plasticsurgery\.org/, /aad\.org/, /asds\.net/, /americanmedspa\.org/, /grandviewresearch\.com/, /\.gov\b/];
const DISALLOWED_SOURCES = [/healthline\.com/, /webmd\.com/, /verywell/, /wikihow/];
const BANNED_CLAIMS = /guaranteed results|permanent results|100% safe|\bno risk\b|risk-free|no side effects|\bmiracle\b|\bcure\b|completely safe|pain[- ]free guarantee/i;
const BANNED_GLP1 = /same active ingredient as (ozempic|wegovy|mounjaro|zepbound)|generic (ozempic|zepbound|wegovy|mounjaro)|same (drug|medication) as (ozempic|wegovy|mounjaro|zepbound)/i;
const BRAND_GLP1 = /\b(ozempic|wegovy|mounjaro|zepbound|semaglutide|tirzepatide)\b/i; // EIN rule: no brand drug names in wire copy
// Allow periods within the name (every real reviewer line says "Dr."), stop at newline.
const REVIEWER_RE = /medically reviewed by[^\n]{0,60}\b(MD|DO|NP|PA|RN|RD|FNP)\b/i;
const REVIEW_DATE_RE = /(last reviewed|reviewed on|updated)[^.\n]{0,20}\d{4}/i;

const links = (s) => (s.match(/https?:\/\/[^\s)"'<>]+/g) || []);
const words = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
// Strip URLs (and markdown link targets) BEFORE extracting numbers — otherwise digits
// inside a citation URL (e.g. a PubMed id /31234567) read as fabricated stats, which
// would punish the exact primary citations the gate demands. (Verifier-found bug.)
const stripUrls = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\]\([^)]*\)/g, '] ').replace(/https?:\/\/[^\s)"'<>]+/g, ' ');
const numbers = (s) => (stripUrls(s).match(/\$?\d[\d,]*(?:\.\d+)?%?/g) || []).map((n) => n.replace(/[,$%]/g, ''));

function shingles(text, k = 8) {
  const w = words(text.toLowerCase());
  const out = new Set();
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(' '));
  return out;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Intent match as a RUBRIC, not a substring. A page earns intent credit by actually
// satisfying the query's intent — query tokens in the answer zone + a heading, plus the
// intent-TYPE payload (a cost query needs prices; a comparison needs a matrix; a safety
// query needs risks) — so keyword-stuffing the literal query no longer scores full marks.
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'is', 'are', 'with', 'how', 'much', 'does', 'do', 'what', 'near', 'me', 'my', 'best']);
function intentMatch(text, query) {
  if (!query) return 0.2;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const qTokens = q.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!qTokens.length) return lower.includes(q) ? 1 : 0.2;
  const head = words(lower).slice(0, 120).join(' ');
  const fullCov = qTokens.filter((t) => lower.includes(t)).length / qTokens.length;
  const headCov = qTokens.filter((t) => head.includes(t)).length / qTokens.length;
  const headings = (text.match(/^#{1,3}\s+.*$/gm) || []).join(' ').toLowerCase();
  const inHeading = qTokens.some((t) => headings.includes(t)) ? 1 : 0;
  let intentSignal = 0.5;
  if (/\b(cost|price|pricing|how much|\$)\b/.test(q)) intentSignal = /\$|\bpric|\bcost|per (session|unit|treatment|area|syringe)|ranges? from|\d+\s*(to|-|–)\s*\$?\d/.test(lower) ? 1 : 0.2;
  else if (/\b(vs|versus|compare|comparison|better|difference)\b/.test(q)) intentSignal = /\bvs\b|versus|compared|spec|better for|each (option|treatment)|differ/.test(lower) ? 1 : 0.3;
  else if (/\b(safe|safety|risk|side effect|danger|contraindicat)\b/.test(q)) intentSignal = /risk|side[- ]effect|contraindicat|not (recommended|suitable|a candidate)|consult/.test(lower) ? 1 : 0.2;
  else if (/\b(near me|best|top)\b/.test(q) || /\b[a-z]+,?\s+(fl|tx|ca|ny|az|nj|ga)\b/.test(q)) intentSignal = 0.7; // local — geo handled by local-specificity
  const score = 0.4 * fullCov + 0.2 * headCov + 0.2 * inHeading + 0.2 * intentSignal;
  return Math.max(0.2, Math.min(1, Math.round(score * 100) / 100));
}

const SOFT = [
  ['answer-capsule', 10],
  ['local-specificity', 12],
  ['intent-match', 10],
  ['reading-level', 8],
  ['media-original', 8],
  ['internal-mesh', 6],
  ['schema-valid', 6],
];

/**
 * Score a draft against its brief.
 * @param draft markdown/HTML string
 * @param brief { title, targetQuery, city, author:{name,role}, dataPoints:[str], primarySources:[url], hasOwnMedia, internalLinks, schemaTypes:[str] }
 * @param priorTexts array of previously-published/competitor texts (dedup)
 */
export function scoreContent(draft = '', brief = {}, { priorTexts = [], reviewers = null } = {}) {
  const text = draft || '';
  const ls = links(text);
  const hard = {};

  // ---- HARD gates (binary) ----
  hard['data-grounding'] = (brief.dataPoints?.length || 0) >= 3;
  const primaryCount = ls.filter((u) => PRIMARY_SOURCES.some((re) => re.test(u))).length;
  const disallowedCount = ls.filter((u) => DISALLOWED_SOURCES.some((re) => re.test(u))).length;
  hard['primary-citations'] = primaryCount >= 2 && disallowedCount === 0;
  hard['named-author'] = !!(brief.author?.name && brief.author?.role && !/editorial team/i.test(brief.author.name));
  // Medical reviewer: the byline must exist AND, when a reviewer registry is configured,
  // name a REAL verified reviewer — a typed "Dr. X, MD" that isn't in the registry is
  // fabricated authority (Helpful-Content / manual-action risk) and BLOCKS publish.
  const reviewerCheck = verifyReviewer(text, reviewers || []);
  hard['medical-reviewer'] = REVIEWER_RE.test(text) && REVIEW_DATE_RE.test(text) && reviewerCheck.verified !== false;
  hard['compliance'] = !BANNED_CLAIMS.test(text) && !BANNED_GLP1.test(text) && !BRAND_GLP1.test(text);
  // no-fabrication: every number in the draft must appear in the brief's data points
  const allowed = new Set(numbers((brief.dataPoints || []).join(' ') + ' ' + (brief.title || '')));
  const yearOk = (n) => /^(19|20)\d{2}$/.test(n); // allow bare years
  const unsourced = numbers(text).filter((n) => !allowed.has(n) && !yearOk(n) && Number(n) > 9);
  hard['no-fabrication'] = unsourced.length === 0;
  // originality vs prior/competitor texts
  const sh = shingles(text);
  const maxSim = priorTexts.reduce((m, t) => Math.max(m, jaccard(sh, shingles(t))), 0);
  hard['originality-dedup'] = maxSim < 0.86;

  const hardFails = Object.entries(hard).filter(([, v]) => !v).map(([k]) => k);
  const hardPass = hardFails.length === 0;
  if (!hard['no-fabrication']) hardFails.push(`(unsourced numbers: ${unsourced.slice(0, 6).join(', ')})`);

  // ---- SOFT gates (weighted 0..1 each) ----
  const wc = words(text).length;
  const firstThird = words(text).slice(0, Math.max(1, Math.floor(wc / 3))).join(' ');
  const comp = {};
  comp['answer-capsule'] = (/^[^\n]{1,400}\?/m.test(text) || /<h2/i.test(text)) && /\b(typically|generally|on average|costs?|ranges?)\b/i.test(firstThird) ? 1 : 0.3;
  const cityHits = brief.city ? (text.match(new RegExp(brief.city.replace(/[^a-z0-9]/gi, '.'), 'gi')) || []).length : 0;
  comp['local-specificity'] = brief.city ? Math.min(1, cityHits / 2) : 0;
  comp['intent-match'] = intentMatch(text, brief.targetQuery);
  const sentences = text.replace(/<[^>]+>/g, ' ').split(/[.!?]+/).filter((s) => s.trim().split(/\s+/).length > 3);
  const avgLen = sentences.length ? sentences.reduce((s, x) => s + x.trim().split(/\s+/).length, 0) / sentences.length : 0;
  comp['reading-level'] = avgLen >= 10 && avgLen <= 22 ? 1 : 0.4; // proxy for FK grade 7-9
  comp['media-original'] = brief.hasOwnMedia || /<table|<img/i.test(text) ? 1 : 0;
  comp['internal-mesh'] = Math.min(1, (brief.internalLinks || (text.match(/\]\(\//g) || []).length) / 3);
  comp['schema-valid'] = (brief.schemaTypes?.length || 0) >= 2 ? 1 : 0;

  const softTotal = SOFT.reduce((s, [, w]) => s + w, 0);
  const softEarned = SOFT.reduce((s, [k, w]) => s + w * (comp[k] || 0), 0);
  const softScore = Math.round((softEarned / softTotal) * 100);
  const score = hardPass ? softScore : 0;

  if (reviewerCheck.verified === false) hardFails.push(`(unverified reviewer: ${reviewerCheck.issue})`);

  return {
    hardPass, hardFails, softScore, score,
    publishEligible: hardPass && softScore >= 80,
    hard, components: comp, reviewerVerification: reviewerCheck,
    stats: { words: wc, primaryCitations: primaryCount, disallowedCitations: disallowedCount, maxSimilarity: Math.round(maxSim * 100) / 100, unsourcedNumbers: unsourced.length },
  };
}
