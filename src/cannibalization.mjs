// seo-bot · cannibalization — two-of-our-pages-fighting-for-one-query detection (GOAL C1
// build-queue item; a named competitive moat: even the big suites lack this report).
//
// Input is the GSC page×query rows the bot already pulls — no new data source. A query is
// CANNIBALIZED when ≥2 of our pages each hold a meaningful share of its impressions: Google
// is alternating/splitting instead of consolidating, which suppresses both. The fix is a
// RANKED proposal (canonical/merge/differentiate/internal-link), routed through the normal
// propose → human-queue → PR path; canonical/301 actions are irreversible-gated downstream.
//
// Stats honesty: a query below minImpressions can't evidence cannibalization (two pages with
// 3 impressions each is noise, not a fight) — those are EXCLUDED, never reported (the same
// enoughData discipline as the rest of the stats layer).

/** PURE: group GSC rows [{page, query, impressions, clicks, position}] by query. */
export function groupByQuery(rows = []) {
  const m = new Map();
  for (const r of rows) {
    if (!r || typeof r.query !== 'string' || typeof r.page !== 'string') continue;
    const impr = Number(r.impressions) || 0;
    if (impr <= 0) continue;
    const q = r.query.trim().toLowerCase();
    if (!q) continue;
    const g = m.get(q) || new Map();
    const p = g.get(r.page) || { page: r.page, impressions: 0, clicks: 0, posW: 0 };
    p.impressions += impr;
    p.clicks += Number(r.clicks) || 0;
    p.posW += (Number(r.position) || 0) * impr; // impression-weighted position
    g.set(r.page, p);
    m.set(q, g);
  }
  return m;
}

/**
 * PURE: detect cannibalized queries.
 * minImpressions: query total below this is noise (excluded, fail-closed).
 * minShare: a page must hold ≥ this share of the query's impressions to count as a contender.
 */
export function detectCannibalization(rows = [], { minImpressions = 200, minShare = 0.2, maxFindings = 50 } = {}) {
  const out = [];
  for (const [query, pagesMap] of groupByQuery(rows)) {
    const pages = [...pagesMap.values()].map((p) => ({
      ...p,
      avgPosition: p.impressions > 0 ? +(p.posW / p.impressions).toFixed(1) : null,
      ctr: p.impressions > 0 ? p.clicks / p.impressions : 0,
    }));
    const total = pages.reduce((s, p) => s + p.impressions, 0);
    if (total < minImpressions) continue; // underpowered — cannot evidence a fight
    const contenders = pages.filter((p) => p.impressions / total >= minShare);
    if (contenders.length < 2) continue;
    // Winner = the page Google already prefers: better (lower) weighted position, CTR tiebreak.
    contenders.sort((a, b) => (a.avgPosition ?? 99) - (b.avgPosition ?? 99) || b.ctr - a.ctr);
    const [winner, ...losers] = contenders;
    out.push({
      query, totalImpressions: total, n: total,
      winner: { page: winner.page, avgPosition: winner.avgPosition, share: +(winner.impressions / total).toFixed(2) },
      losers: losers.map((l) => ({ page: l.page, avgPosition: l.avgPosition, share: +(l.impressions / total).toFixed(2) })),
      severity: losers.some((l) => l.impressions / total >= 0.35) ? 'high' : 'medium',
    });
  }
  return out.sort((a, b) => b.totalImpressions - a.totalImpressions).slice(0, maxFindings);
}

/**
 * PURE: turn findings into proposals for the normal pipeline. Action choice:
 * near-duplicate intent → canonical to the winner; distinct intent → differentiate the loser
 * (retitle/refocus) + internal-link it to the winner. We cannot read INTENT from GSC alone,
 * so canonical is only suggested when the loser adds ~nothing (share small, position worse);
 * everything else defaults to differentiate (reversible) — canonical/301 are irreversible
 * and stay behind guardIrreversible downstream anyway.
 */
export function cannibalizationProposals(findings = [], { startId = 1 } = {}) {
  const proposals = [];
  let id = startId;
  for (const f of findings) {
    for (const loser of f.losers) {
      const nearUseless = loser.share <= 0.25 && (loser.avgPosition ?? 99) > (f.winner.avgPosition ?? 0) + 5;
      proposals.push({
        id: id++,
        type: nearUseless ? 'canonical' : 'differentiate-page',
        page: loser.page,
        autoApplicable: false, // always a human call — consolidation moves rankings
        severity: f.severity,
        message: `Cannibalizing "${f.query}" against ${f.winner.page} (loser share ${Math.round(loser.share * 100)}%, pos ${loser.avgPosition} vs ${f.winner.avgPosition}).`,
        recommendation: nearUseless
          ? `Canonicalize to ${f.winner.page} (loser adds ~nothing: small share, much worse position). Irreversible-gated.`
          : `Differentiate: retitle/refocus this page onto a distinct sub-intent and internal-link it to ${f.winner.page} as the primary answer for "${f.query}".`,
        evidence: { query: f.query, n: f.n, winner: f.winner, loser },
      });
    }
  }
  return proposals;
}
