// seo-bot · priority — expected-value ranking of fix proposals.
//
// OTTO shows a flat list "by impact and effort" that reviewers say isn't truly
// severity-ordered. We rank every proposal by a real EV score:
//   EV = severityWeight × demand(log impressions) × ctrUplift(rank band) ÷ effort
// so the highest-leverage, lowest-effort fixes lead the queue.

export const SEVERITY_WEIGHT = { critical: 15, high: 8, medium: 3, low: 1 };

/** Headroom multiplier: a page on page-2 (pos 11–20) has the most CTR to unlock;
 *  a #1 page has little; an unranked page (no GSC) is neutral. */
function ctrUpliftFactor(pos) {
  if (!pos) return 1;
  if (pos <= 3) return 0.5;   // already winning — small upside
  if (pos <= 10) return 1.5;  // first page, climbable — big upside
  if (pos <= 20) return 1.2;  // page two — real upside if pushed up
  return 0.6;                  // deep — lower near-term odds
}

/** Score one proposal. p may carry p.gsc = {impressions, position, ctr, clicks}. */
export function scoreProposal(p) {
  const sev = SEVERITY_WEIGHT[p.severity] ?? 1;
  const impr = p.gsc?.impressions || 0;
  const demand = 0.5 + Math.log10(1 + impr); // damp mega-pages; floor so no-GSC fixes still rank by severity
  const uplift = ctrUpliftFactor(p.gsc?.position);
  const effort = p.autoApplicable ? 1 : 3;
  return Math.round(((sev * demand * uplift) / effort) * 100) / 100;
}

/** Annotate proposals with .priority and return them sorted highest-EV first. */
export function rankProposals(proposals = []) {
  for (const p of proposals) p.priority = scoreProposal(p);
  return proposals.sort(
    (a, b) => (b.priority - a.priority) || ((SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0)) || ((b.gsc?.impressions || 0) - (a.gsc?.impressions || 0)),
  );
}
