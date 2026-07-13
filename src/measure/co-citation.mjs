// seo-bot · measure/co-citation — who appears NEXT TO us in AI answers (GOAL C4 sub-item).
//
// From captured answer citations (fanout-capture rows now carry .citations), count which
// domains co-occur in the SAME answer as (a) our domain and (b) competitors. Co-citation is
// the neighborhood signal: the sources engines habitually pair with a brand are the sources
// worth being on (feeds backlink-targets) — and a competitor's co-citation cluster we're
// absent from is a mapped gap, not a guess.
//
// Stats honesty: denominators are explicit (answers analyzed, answers where we appear);
// blocked/empty captures are EXCLUDED; below minAnswers the result says insufficient-answers
// and reports NO rankings (a two-answer "cluster" is an anecdote).

const hostOf = (u = '') => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** PURE: per-answer domain sets from capture rows (status ok + citations only). */
export function answerDomainSets(captures = []) {
  const sets = [];
  for (const c of captures) {
    if (!c || c.status !== 'ok') continue;
    const urls = [...(c.citations?.urls || []), ...((c.citations?.results || []).map((r) => r.url))];
    const hosts = new Set(urls.map(hostOf).filter(Boolean));
    if (hosts.size) sets.push(hosts);
  }
  return sets;
}

/**
 * PURE: the co-citation table.
 * cfg: { baseUrl, competitors?: [names-or-domains] }.
 * Returns { status, answersAnalyzed, ourAnswers, rows:[{domain, withUs, withCompetitors, total, share}] }.
 */
export function coCitations(captures = [], cfg = {}, { minAnswers = 5, max = 50 } = {}) {
  const own = hostOf(cfg.baseUrl || '') || (cfg.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/.*/, '').toLowerCase();
  const compHosts = (cfg.competitors || [])
    .map((c) => (typeof c === 'string' ? c : c?.domain || c?.name || ''))
    .map((s) => hostOf(/^https?:/i.test(s) ? s : `https://${s}`) || s.toLowerCase())
    .filter((s) => s && s.length >= 5);
  const sets = answerDomainSets(captures);
  if (sets.length < minAnswers) {
    return { status: 'insufficient-answers', answersAnalyzed: sets.length, minAnswers, note: `need ≥${minAnswers} answers with citations before co-citation clusters mean anything` };
  }
  const counts = new Map(); // domain → {withUs, withCompetitors, total}
  let ourAnswers = 0;
  for (const hosts of sets) {
    const hasUs = own && hosts.has(own);
    const hasComp = compHosts.some((h) => hosts.has(h));
    if (hasUs) ourAnswers++;
    for (const d of hosts) {
      if (d === own) continue;
      const rec = counts.get(d) || { domain: d, withUs: 0, withCompetitors: 0, total: 0 };
      rec.total += 1;
      if (hasUs) rec.withUs += 1;
      if (hasComp && !compHosts.includes(d)) rec.withCompetitors += 1;
      counts.set(d, rec);
    }
  }
  const rows = [...counts.values()]
    .map((r) => ({ ...r, share: +(r.total / sets.length).toFixed(2), isCompetitor: compHosts.includes(r.domain) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, max);
  return { status: 'ok', answersAnalyzed: sets.length, ourAnswers, rows };
}

/** PURE: the actionable slice — domains clustered with COMPETITORS where we never appear. */
export function competitorClusterGaps(captures = [], cfg = {}, opts = {}) {
  const r = coCitations(captures, cfg, opts);
  if (r.status !== 'ok') return r;
  return { ...r, rows: r.rows.filter((x) => !x.isCompetitor && x.withCompetitors > 0 && x.withUs === 0) };
}
