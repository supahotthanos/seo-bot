// seo-bot · local/factors — the consolidated 2026 local map-pack factor model.
// Pure + deterministic. Every factor carries an evidence tier and a NAMED source;
// the compiled knowledge (claims, caveats, legal lines) lives in
// research/local-ranking-factors-2026.md — no folklore rows.
//
// Design: assessLocal(cfg, signals) never crashes on missing data. A signal the
// caller didn't supply produces a status:'unknown' finding (honest "cannot verify"),
// never a silent pass and never a fabricated issue. GBP writes are NOT in any CMS
// adapter — every proposal here is autoApplicable:false (human applies in the GBP
// dashboard). Proposals are tagged measure:{metric:'map-pack'} so downstream judging
// uses geo-grid ATRP/SoLV (src/geogrid.mjs), not organic position (proximity makes
// organic the wrong denominator).

/** The ranked factor model. weight = relative strength 0..1 within the local layer. */
export const FACTORS = [
  { id: 'primary-category', name: 'Primary GBP category (the #1 factor)', weight: 1.0, evidenceTier: 'ground-truth', source: 'Whitespark LSRF 2026 (Shaw) — research/local-ranking-factors-2026.md §1.1', howToCheck: 'signals.gbp.primaryCategory equals the expected vertical category (med spa → "Medical Spa")' },
  { id: 'proximity-constraint', name: 'Proximity — hard planning constraint, not a tactic', weight: 0.95, evidenceTier: 'ground-truth', source: 'Whitespark LSRF (top-3 consistently) — research/local-ranking-factors-2026.md §1.2', howToCheck: 'geo-grid ATRP/SoLV envelope (src/geogrid.mjs); plans targeting geos outside it get flagged, never promised' },
  { id: 'review-velocity-decay', name: 'Review velocity > volume (18-day decay rule)', weight: 0.85, evidenceTier: 'ground-truth', source: 'Sterling Sky (Hawkins) controlled tests — research/local-ranking-factors-2026.md §1.3', howToCheck: 'velocityScore(reviewDates) in src/local/reviews.mjs — stalled when >18 days since the last review' },
  { id: 'review-threshold-10', name: 'The 10-review threshold (bump 9→10, nothing 10→11)', weight: 0.55, evidenceTier: 'ground-truth', source: 'Sterling Sky — research/local-ranking-factors-2026.md §1.3', howToCheck: 'thresholdGap(count) in src/local/reviews.mjs' },
  { id: 'review-justifications', name: 'Review justifications (query-matched review text shown in the pack)', weight: 0.6, evidenceTier: 'ground-truth', source: 'Sterling Sky — research/local-ranking-factors-2026.md §1.3', howToCheck: 'justificationCheck(reviewTexts) — do reviews NAME the services? (analysis only; solicitation is human + FTC-bounded)' },
  { id: 'open-at-time-of-search', name: '"Open at time of search" (#5 factor, 2026)', weight: 0.8, evidenceTier: 'ground-truth', source: 'Whitespark LSRF 2026 — research/local-ranking-factors-2026.md §1.4', howToCheck: 'signals.hours evening/weekend coverage + openingHoursSpecification schema; changing real hours is a business decision (flag only)' },
  { id: 'visible-address', name: 'Visible address (7th factor; SAB hide→drop, reveal→recover)', weight: 0.7, evidenceTier: 'ground-truth', source: 'Sterling Sky, replicated — research/local-ranking-factors-2026.md §1.5', howToCheck: 'signals.addressVisible (GBP) + local-visible-address site rule (street text on sampled pages)' },
  { id: 'gbp-landing-diversity', name: 'Diversity-Update GBP-link fix (link a NON-top organic page)', weight: 0.65, evidenceTier: 'ground-truth', source: 'Sterling Sky (Hawkins), Aug 2024 — research/local-ranking-factors-2026.md §1.6', howToCheck: 'signals.gbp.landingPage must NOT equal signals.topOrganicPage (dedup double-demotion)' },
  { id: 'secondary-categories', name: 'Secondary/semi-unrelated categories (10-category ceiling)', weight: 0.6, evidenceTier: 'ground-truth', source: 'Whitespark A-Tier + Sterling Sky category tests — research/local-ranking-factors-2026.md §1.7', howToCheck: 'signals.gbp.categories count in 2..10; adjacent-but-defensible only (suspension vector otherwise)' },
  { id: 'gbp-services-fields', name: 'GBP Services fields affect ranking (2022 retest)', weight: 0.5, evidenceTier: 'ground-truth', source: 'Sterling Sky retest — research/local-ranking-factors-2026.md §1.8', howToCheck: 'signals.gbp.services non-empty and covering cfg.services' },
  { id: 'behavioral-engagement', name: 'Behavioral/engagement signals (directions, calls, clicks, dwell)', weight: 0.45, evidenceTier: 'survey', source: 'Whitespark LSRF 2026 (elevated; directional) — research/local-ranking-factors-2026.md §1.9', howToCheck: 'monitor GBP Performance only — synthetic engagement is veto-listed (ctr-manipulation)' },
  { id: 'lsa-call-quality', name: 'LSA: AI-scored call quality (~31% of local queries)', weight: 0.4, evidenceTier: 'methodology', source: 'Near Media (Blumenthal) — research/local-ranking-factors-2026.md §1.10', howToCheck: 'human worksheet item: answer rate + call handling; never automate calls' },
  { id: 'content-authenticity', name: 'Content-authenticity swap test (local-specific copy)', weight: 0.35, evidenceTier: 'methodology', source: 'Gifford / SearchLab — research/local-ranking-factors-2026.md §1.11', howToCheck: 'local-generic-copy rule: home/location pages with zero local markers beyond the brand string' },
];

/** Consolidated local DEBUNKED list — the bot must never recommend these. */
export const DEBUNKED = [
  { id: 'geotagged-photos', reason: 'Geotagging/EXIF-tagging GBP photos has NO ranking effect (tested; Google strips EXIF).', source: 'Sterling Sky test; Whitespark F-Tier — research/local-ranking-factors-2026.md §2' },
  { id: 'gbp-posts-for-rank', reason: 'GBP Posts do NOT move pack rankings (fine for conversion, not rank).', source: 'Sterling Sky test — research/local-ranking-factors-2026.md §2' },
  { id: 'service-area-field', reason: 'The GBP service-area field is inert for ranking (display only).', source: 'Whitespark F-Tier — research/local-ranking-factors-2026.md §2' },
  { id: 'keyword-stuffed-review-replies', reason: 'Keywords in owner review replies are inert for ranking and read as spam.', source: 'Whitespark F-Tier — research/local-ranking-factors-2026.md §2' },
];

// Text fingerprints so proposals PHRASED as a debunked tactic (from an LLM, an imported
// audit, or folklore) are caught even without a matching id. Conservative patterns.
const DEBUNKED_TEXT = [
  { id: 'geotagged-photos', re: /geo-?tag(?:ged|ging)?\s+(?:your\s+|the\s+)?(?:gbp\s+|business\s+)?photos?|exif\s+(?:geo)?location/i },
  // Requires the word "post(s)" so legitimate GBP factors (services/categories DO affect
  // ranking) are never false-positive-suppressed (caught by the CLI smoke test).
  { id: 'gbp-posts-for-rank', re: /\b(?:gbp|google business(?: profile)?)\s+posts?\b[^.]{0,60}\brank(?:ing|ings)?\b|\bposts?\b[^.]{0,50}\b(?:gbp|google business)\b[^.]{0,50}\brank(?:ing|ings)?\b/i },
  { id: 'service-area-field', re: /service[- ]area field|expand(?:ing)? (?:your |the )?service areas?\b[^.]{0,40}\brank/i },
  { id: 'keyword-stuffed-review-replies', re: /keywords? (?:in|into) (?:your |the )?review (?:replies|responses)|reply to reviews? with keywords?/i },
];

function debunkedMatch(p) {
  if (!p || typeof p !== 'object') return null;
  const ids = new Set(DEBUNKED.map((d) => d.id));
  for (const key of [p.tactic, p.type, p.factor, p.id]) {
    if (typeof key === 'string' && ids.has(key)) return DEBUNKED.find((d) => d.id === key);
  }
  const text = [p.proposed, p.recommendation, p.rationale, p.message].filter((s) => typeof s === 'string').join(' \n ');
  for (const t of DEBUNKED_TEXT) if (t.re.test(text)) return DEBUNKED.find((d) => d.id === t.id);
  return null;
}

/** The DEBUNKED suppressor: proposals matching a dead tactic are FLAGGED, not kept.
 *  Fail-closed: non-array input → nothing kept (never "pass through on bad input"). */
export function suppressDebunked(proposals) {
  if (!Array.isArray(proposals)) return { kept: [], flagged: [], reason: 'proposals-not-an-array (fail-closed: nothing kept)' };
  const kept = [], flagged = [];
  for (const p of proposals) {
    const hit = debunkedMatch(p);
    if (hit) flagged.push({ proposal: p, debunked: hit.id, reason: hit.reason, source: hit.source });
    else kept.push(p);
  }
  return { kept, flagged, reason: null };
}

const S = (v) => (typeof v === 'string' ? v.trim() : '');
const normPath = (u) => {
  const s = S(u);
  if (!s) return '';
  try { return new URL(s, 'https://x.invalid').pathname.replace(/\/+$/, '') || '/'; } catch { return s.replace(/\/+$/, '') || '/'; }
};

function finding(factorId, status, message, recommendation) {
  const fac = FACTORS.find((x) => x.id === factorId) || {};
  return { factor: factorId, status, message, recommendation: recommendation || null, weight: fac.weight ?? null, evidenceTier: fac.evidenceTier || null, source: fac.source || null };
}

function proposal(factorId, page, severity, current, proposed, rationale) {
  const fac = FACTORS.find((x) => x.id === factorId) || {};
  return {
    type: `local-${factorId}`, page: page || '(gbp)', severity, autoApplicable: false, // GBP writes are human-only
    current, proposed, rationale: `${rationale} [${fac.evidenceTier}: ${fac.source}]`,
    measure: { metric: 'map-pack' }, // judge on geo-grid ATRP/SoLV, not organic
  };
}

/**
 * Assess a client's local map-pack posture from optional signals.
 * signals = {
 *   gbp: { primaryCategory, categories[], services[], landingPage, hours },
 *   hours: { eveningCoverage, weekendCoverage } | gbp.hours,
 *   addressVisible: boolean, topOrganicPage: url/path, landingPage: url/path,
 *   reviews: { count, daysSinceLast },
 * }
 * Missing signal → status:'unknown' finding. Never throws on garbage.
 */
export function assessLocal(cfg = {}, signals = {}) {
  const findings = [];
  const proposals = [];
  const gbp = (signals && typeof signals.gbp === 'object' && signals.gbp) || {};
  const base = S(cfg.baseUrl) || '(gbp)';

  // 1 — primary category
  const expected = S(cfg.local?.expectedCategory) || (cfg.vertical === 'medspa' ? 'Medical Spa' : '');
  const primary = S(gbp.primaryCategory);
  if (!primary) findings.push(finding('primary-category', 'unknown', 'GBP primary category not supplied — cannot verify the #1 local factor.'));
  else if (expected && primary.toLowerCase() !== expected.toLowerCase()) {
    findings.push(finding('primary-category', 'issue', `Primary category is "${primary}" — expected "${expected}".`, `Set the GBP primary category to "${expected}" (human applies in the GBP dashboard).`));
    proposals.push(proposal('primary-category', base, 'high', primary, `Primary category: "${expected}"`, 'Primary category is the #1 local-pack factor.'));
  } else findings.push(finding('primary-category', 'ok', `Primary category "${primary}" looks right.`));

  // 2 — secondary categories (10 ceiling)
  const cats = Array.isArray(gbp.categories) ? gbp.categories.filter((c) => S(c)) : null;
  if (!cats) findings.push(finding('secondary-categories', 'unknown', 'GBP category list not supplied.'));
  else if (cats.length > 10) findings.push(finding('secondary-categories', 'issue', `${cats.length} categories reported — GBP caps at 10 (1 primary + 9 additional); the data looks invalid.`, 'Re-pull the category list; trim to the 10 most defensible.'));
  else if (cats.length <= 1) {
    findings.push(finding('secondary-categories', 'issue', `Only ${cats.length} categor${cats.length === 1 ? 'y' : 'ies'} set — secondary/adjacent categories (A-Tier) open new packs.`, 'Propose adjacent, DEFENSIBLE categories (e.g. Skin Care Clinic, Laser Hair Removal Service) up to the 10 ceiling — human applies; wrong categories are a suspension vector.'));
    proposals.push(proposal('secondary-categories', base, 'medium', `${cats.length} categories`, 'Add adjacent, defensible secondary categories (up to 10 total).', 'Secondary categories are A-Tier and open additional packs.'));
  } else findings.push(finding('secondary-categories', 'ok', `${cats.length}/10 categories set.`));

  // 3 — Diversity-Update landing-page fix
  const landing = normPath(gbp.landingPage ?? signals.landingPage);
  const topOrganic = normPath(signals.topOrganicPage);
  if (!landing || !topOrganic) findings.push(finding('gbp-landing-diversity', 'unknown', 'GBP landing page and/or top organic page not supplied — cannot check the Diversity-Update dedup risk.'));
  else if (landing === topOrganic) {
    findings.push(finding('gbp-landing-diversity', 'issue', `GBP links to "${landing}", which is also the TOP organic page — Diversity-Update dedup can demote organic AND pack together.`, 'Point the GBP website link at a relevant NON-top page (usually the location page).'));
    proposals.push(proposal('gbp-landing-diversity', landing, 'high', `GBP → ${landing} (= top organic page)`, 'Re-point GBP to a relevant non-top organic page (e.g. the location page).', 'Counterintuitive but tested: linking GBP to the strongest organic page triggers a dedup double-demotion.'));
  } else findings.push(finding('gbp-landing-diversity', 'ok', `GBP landing page ("${landing}") differs from the top organic page ("${topOrganic}").`));

  // 4 — visible address
  const av = signals.addressVisible;
  if (av === undefined || av === null) findings.push(finding('visible-address', 'unknown', 'Address visibility not supplied — cannot verify the 7th factor.'));
  else if (av === false) {
    findings.push(finding('visible-address', 'issue', 'The address is HIDDEN — SABs that hide the address drop; revealing it recovers within ~a month (replicated).', 'Show the address on GBP and visibly on the site (suite-based med spas included).'));
    proposals.push(proposal('visible-address', base, 'high', 'address hidden', 'Un-hide the business address on GBP + show NAP text on the site.', 'Visible address is the ~7th-strongest local factor; hide→drop, reveal→recover.'));
  } else findings.push(finding('visible-address', 'ok', 'Address is visible.'));

  // 5 — open at time of search
  const hours = (signals.hours && typeof signals.hours === 'object' && signals.hours) || (gbp.hours && typeof gbp.hours === 'object' && gbp.hours) || null;
  if (!hours) findings.push(finding('open-at-time-of-search', 'unknown', 'Hours not supplied — cannot assess the #5 factor (open at time of search).'));
  else {
    const evening = hours.eveningCoverage === true, weekend = hours.weekendCoverage === true;
    if (!evening || !weekend) {
      findings.push(finding('open-at-time-of-search', 'issue', `Hours miss ${!evening && !weekend ? 'evenings AND weekends' : !evening ? 'evenings' : 'weekends'} — closed-at-search-time businesses lose those packs to later-open competitors.`, 'FLAG for the owner: extending real hours is a business decision. Ensure listed hours are ACCURATE and openingHoursSpecification is emitted — never list hours you do not keep.'));
      proposals.push(proposal('open-at-time-of-search', base, 'medium', `eveningCoverage:${!!hours.eveningCoverage} weekendCoverage:${!!hours.weekendCoverage}`, 'Surface the hours gap to the owner + emit accurate openingHoursSpecification.', '"Open at time of search" is the #5 local-pack factor (2026).'));
    } else findings.push(finding('open-at-time-of-search', 'ok', 'Evening + weekend coverage present.'));
  }

  // 6 — GBP services fields
  const svc = Array.isArray(gbp.services) ? gbp.services.filter((s) => S(s)) : null;
  if (!svc) findings.push(finding('gbp-services-fields', 'unknown', 'GBP services list not supplied.'));
  else if (!svc.length) {
    findings.push(finding('gbp-services-fields', 'issue', 'No services listed in the GBP Services section — services DO affect ranking (2022 retest).', 'Add the real service menu to GBP Services (human applies).'));
    proposals.push(proposal('gbp-services-fields', base, 'medium', '0 GBP services', 'Populate GBP Services with the real service menu.', 'GBP services fields affect ranking (Sterling Sky retest).'));
  } else findings.push(finding('gbp-services-fields', 'ok', `${svc.length} GBP services listed.`));

  // 7 — review velocity/threshold (headline only; the math lives in src/local/reviews.mjs)
  const rv = (signals.reviews && typeof signals.reviews === 'object' && signals.reviews) || null;
  if (!rv || !Number.isFinite(rv.count)) findings.push(finding('review-velocity-decay', 'unknown', 'Review data not supplied — run the review-velocity math (src/local/reviews.mjs) with real review dates.'));
  else {
    const stalled = Number.isFinite(rv.daysSinceLast) && rv.daysSinceLast > 18;
    if (stalled) {
      findings.push(finding('review-velocity-decay', 'issue', `${Math.round(rv.daysSinceLast)} days since the last review — past the ~18-day decay window.`, 'ANALYSIS ONLY. Review flow is a human workflow (verbal ask ~24h post-treatment). The bot never solicits (FTC 16 CFR 465).'));
    } else findings.push(finding('review-velocity-decay', 'ok', 'Review flow inside the 18-day window.'));
    if (rv.count < 10) findings.push(finding('review-threshold-10', 'issue', `${rv.count} reviews — below the 10-review threshold (bump at 9→10).`, 'ANALYSIS ONLY — surface to the owner; never automate solicitation.'));
    else findings.push(finding('review-threshold-10', 'ok', `${rv.count} reviews (past the 10-review threshold; velocity now matters more than volume).`));
  }

  // 8 — constraints/monitor-only factors: always emit the posture line (analysis, no proposal)
  findings.push(finding('proximity-constraint', 'info', 'Proximity is a HARD constraint — measure the envelope with the geo-grid (ATRP/SoLV); never promise ranks outside it.'));
  findings.push(finding('behavioral-engagement', 'info', 'Behavioral signals are monitor-only (GBP Performance). Synthetic engagement is veto-listed.'));
  findings.push(finding('lsa-call-quality', 'info', 'LSA call quality is AI-scored by Google (~31% of local queries) — call handling is a human/business operation.'));

  return { findings, proposals };
}
