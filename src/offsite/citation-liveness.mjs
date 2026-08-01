// seo-bot · offsite/citation-liveness — the Whitespark-style citation AUDIT the registry
// was missing: for each of the verified CITATION_TARGETS, what is this client's live
// status? Composes the static registry (listings/targets.mjs) with the read-only NAP
// drift monitor (offsite/nap-drift.mjs). READ-ONLY — submission stays human (the
// payload files from offsite/listings.mjs are the how-to).
//
// Fail-closed by construction: a target with no configured publicUrl is 'unknown'
// (the founder task is "find/claim the listing, paste its URL into
// cfg.listings.targets[]") — never assumed present OR absent. An unreachable or
// NAP-less page keeps nap-drift's honest statuses; nothing is counted as consistent
// without being read.

import { CITATION_TARGETS, TIER_LABELS } from '../listings/targets.mjs';
import { napDriftMonitor } from './nap-drift.mjs';

/**
 * PURE: merge the registry with configured targets + drift rows into one status table.
 * statuses: live-consistent | live-drift | unreachable | no-nap-found | unknown
 */
export function scoreCitationRows(cfg = {}, driftRows = []) {
  const configured = new Map((cfg.listings?.targets || []).map((t) => [t.id, t]));
  const byId = new Map((Array.isArray(driftRows) ? driftRows : []).map((r) => [r.id, r]));
  const rows = [];
  for (const t of CITATION_TARGETS) {
    if (t.kind === 'on-site' || t.kind === 'booking') continue; // owned-site rows are audited by the site rules, not the citation scan
    const conf = configured.get(t.id) || null;
    const drift = byId.get(t.id) || null;
    let status = 'unknown';
    if (conf?.publicUrl && drift) {
      status = drift.status === 'DRIFT' ? 'live-drift'
        : drift.status === 'consistent' ? 'live-consistent'
        : drift.status; // 'unreachable' | 'no-nap-found' pass through unchanged (fail closed)
    }
    rows.push({
      id: t.id, name: t.name, tier: t.tier, tierLabel: TIER_LABELS[t.tier] || String(t.tier),
      free: t.free !== false, status,
      publicUrl: conf?.publicUrl || null,
      drift: drift?.drift || [],
      napRule: t.napRule || null, note: t.note || null, claimUrl: t.url || null,
    });
  }
  return rows;
}

/** PURE: roll a row table up into the headline counts. */
export function summarizeCitations(rows = []) {
  const by = { 'live-consistent': 0, 'live-drift': 0, unreachable: 0, 'no-nap-found': 0, unknown: 0 };
  for (const r of (Array.isArray(rows) ? rows : [])) by[r.status] = (by[r.status] || 0) + 1;
  const total = (Array.isArray(rows) ? rows.length : 0);
  return { total, ...by, verifiedPct: total ? Math.round((by['live-consistent'] / total) * 100) : 0 };
}

/**
 * Run the liveness scan: nap-drift over every configured publicUrl, merged across the
 * whole registry. No canonical NAP configured ⇒ refused (you cannot audit consistency
 * against nothing) — the action plan turns that refusal into the setup task.
 */
export async function citationLiveness(cfg, { fetchFn = globalThis.fetch, log = () => {} } = {}) {
  const drift = await napDriftMonitor(cfg, { fetchFn, log });
  if (drift.refused) {
    return { refused: true, reason: drift.reason, rows: scoreCitationRows(cfg, []), summary: null };
  }
  const rows = scoreCitationRows(cfg, drift.rows);
  const summary = summarizeCitations(rows);
  log(`  citations: ${summary['live-consistent']}/${summary.total} verified-consistent · ${summary['live-drift']} drift · ${summary.unknown} unknown (need publicUrl or claim)`);
  return { refused: false, rows, summary };
}
