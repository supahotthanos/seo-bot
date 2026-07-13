// seo-bot · content/cohort-guardrail — the statistical answer to "is what we're publishing helping
// or hurting?" Every auto-posted blog page joins a COHORT; each weekly run snapshots the cohort's
// GSC reality (impressions/clicks + its share of the whole site); once enough history exists the
// judge compares early vs late windows. If the cohort's share of site impressions has COLLAPSED
// (the scaled-content-abuse signature: Google quietly de-values the whole content type), posting
// AUTO-PAUSES via a flag file that blog-publish refuses to publish through. Honest by design:
// fewer than minPoints snapshots or thin impressions → 'insufficient', never a fake verdict.

import { twoProportionZTest } from '../stats/significance.mjs';

const norm = (u = '') => String(u).replace(/\/$/, '').toLowerCase();

/** PURE: one weekly snapshot row — the cohort's current GSC totals vs the whole site. */
export function snapshotCohort(postUrls = [], gscPages = [], { day = '' } = {}) {
  const cohortSet = new Set(postUrls.map(norm));
  let cohortImpr = 0, cohortClicks = 0, siteImpr = 0, siteClicks = 0, matched = 0;
  for (const r of gscPages) {
    const url = norm(r.keys?.[0] || r.page || '');
    const impr = Number(r.impressions) || 0, clicks = Number(r.clicks) || 0;
    siteImpr += impr; siteClicks += clicks;
    if (cohortSet.has(url)) { cohortImpr += impr; cohortClicks += clicks; matched++; }
  }
  return { day, cohortPages: postUrls.length, matched, cohortImpr, cohortClicks, siteImpr, siteClicks,
    share: siteImpr > 0 ? +(cohortImpr / siteImpr).toFixed(4) : 0 };
}

/**
 * PURE: judge the cohort trend across snapshots. Split history into EARLY vs LATE halves and test
 * whether the cohort's share of site impressions collapsed (>relDrop relative, z-significant).
 * Verdicts: insufficient | ok | watch (drop but not significant/large) | pause-posting.
 */
export function judgeCohort(history = [], { minPoints = 3, minImpr = 50, relDrop = 0.3 } = {}) {
  const rows = (history || []).filter((h) => h && Number.isFinite(h.cohortImpr) && Number.isFinite(h.siteImpr) && h.siteImpr > 0);
  if (rows.length < minPoints) return { verdict: 'insufficient', reason: `${rows.length}/${minPoints} weekly snapshots — trend not judgeable yet`, points: rows.length };
  const mid = Math.floor(rows.length / 2);
  const sum = (rs, k) => rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const early = rows.slice(0, mid), late = rows.slice(mid);
  const eC = sum(early, 'cohortImpr'), eS = sum(early, 'siteImpr');
  const lC = sum(late, 'cohortImpr'), lS = sum(late, 'siteImpr');
  if (eC + lC < minImpr) return { verdict: 'insufficient', reason: `cohort has ${eC + lC} total impressions < ${minImpr} — below the noise floor`, points: rows.length };
  const eShare = eC / eS, lShare = lC / lS;
  const rel = eShare > 0 ? (lShare - eShare) / eShare : 0;
  // z-test on cohort-impression share of site impressions, early vs late.
  const t = twoProportionZTest(eC, eS, lC, lS);
  const significant = !!(t && (t.significant ?? (Number(t.pValue) < 0.05)));
  const base = { points: rows.length, earlyShare: +eShare.toFixed(4), lateShare: +lShare.toFixed(4), relChange: +rel.toFixed(3), pValue: t?.pValue ?? null, n: { early: eS, late: lS } };
  if (rel <= -relDrop && significant) return { verdict: 'pause-posting', reason: `cohort share collapsed ${(rel * 100).toFixed(0)}% (p=${(t.pValue ?? 0).toFixed(4)}) — scaled-content de-valuation signature; pausing new posts`, ...base };
  if (rel <= -relDrop) return { verdict: 'watch', reason: `share down ${(rel * 100).toFixed(0)}% but not significant (p=${t?.pValue ?? '—'}) — keep posting, watch next week`, ...base };
  return { verdict: 'ok', reason: `cohort share ${rel >= 0 ? 'up' : 'down'} ${(rel * 100).toFixed(0)}% (${eShare.toFixed(3)}→${lShare.toFixed(3)})`, ...base };
}

/** Extract the cohort's post URLs from the site's posts.ts registry (bot-published + human posts alike). */
export function cohortUrlsFromRegistry(registrySource = '', baseUrl = '') {
  const slugs = [...String(registrySource).matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
  const base = String(baseUrl || '').replace(/\/$/, '');
  return slugs.map((s) => `${base}/blog/${s}`);
}

/**
 * Weekly runner: snapshot → history → judge → flag file. deps: { fs, dir, log }.
 * gscPages = pullGSC().pages. The PAUSE FLAG (content-pause.flag) is what blog-publish honors;
 * an 'ok' verdict clears a stale flag (recovery is automatic once the data recovers).
 */
export function runCohortGuardrail(cfg = {}, { gscPages = [], registrySource = '', fs, dir, log = () => {}, nowIso = new Date().toISOString() } = {}) {
  if (!fs || !dir) throw new Error('runCohortGuardrail needs { fs, dir }');
  const urls = cohortUrlsFromRegistry(registrySource, cfg.baseUrl);
  const day = String(nowIso).slice(0, 10);
  const histFile = `${dir}/content-cohort.ndjson`;
  const flagFile = `${dir}/content-pause.flag`;
  const snap = snapshotCohort(urls, gscPages, { day });
  const prior = fs.existsSync(histFile)
    ? fs.readFileSync(histFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  // One snapshot per day (idempotent weekly runs).
  if (!prior.some((h) => h.day === day)) fs.appendFileSync(histFile, JSON.stringify(snap) + '\n');
  const history = prior.some((h) => h.day === day) ? prior : [...prior, snap];
  const j = judgeCohort(history);
  if (j.verdict === 'pause-posting') fs.writeFileSync(flagFile, JSON.stringify({ at: nowIso, ...j }));
  else if (j.verdict === 'ok' && fs.existsSync(flagFile)) { try { fs.rmSync ? fs.rmSync(flagFile) : fs.unlinkSync(flagFile); } catch { /* */ } }
  log(`  content-cohort: ${snap.matched}/${snap.cohortPages} posts in GSC · share ${(snap.share * 100).toFixed(1)}% · verdict ${j.verdict} — ${j.reason}`);
  return { snapshot: snap, judgement: j, flagged: j.verdict === 'pause-posting' };
}
