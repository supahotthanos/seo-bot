// seo-bot · stats/horizon-sweep — the missing scheduled writer for decisions.ndjson.
// The locked-horizon judge (runController → decideChange) existed but NOTHING called it on
// a cadence, so the ledger that feeds auto-promotion (policy-promotion.mjs: ≥5 keeps /
// 0 reverts) and cross-client priors stayed empty. This sweep runs weekly: every APPLIED
// change (change-ledger.ndjson) whose locked horizon has passed gets judged ONCE on real
// before/after GSC windows — keep / revert / try-next / insufficient-data — and booked.
//
// Discipline inherited, not reinvented: judgment itself stays in decideChange (no-peek
// horizon, practical-effect floor, BH-FDR via runController, core-update hold, map-pack
// refusal). This module only decides WHICH changes are due and builds their windows.
// Fail-closed: no ledger / no GSC / already-judged / horizon-not-reached ⇒ nothing booked.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { runController } from './controller.mjs';

const DAY = 86400000;
export const SWEEP_WINDOW_DAYS = 14; // before/after window per change; horizon = applied + window
const MAX_BUCKETS = 4;               // GSC pulls per sweep = 2 × buckets — bounded API cost

const readNd = (p) => (existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const normPage = (u) => String(u || '').replace(/\/$/, '');

/**
 * PURE: which applied changes are due for judgment?
 * ledgerRows = change-ledger.ndjson rows {ts, url, field, adapter}
 * decisionRows = decisions.ndjson rows {page, at}
 * A page is due when: it has an applied change, the newest change is ≥ windowDays old
 * (locked horizon reached), and no decision was booked AFTER that change (never re-judge).
 */
export function dueChanges(ledgerRows = [], decisionRows = [], { nowMs = Date.now(), windowDays = SWEEP_WINDOW_DAYS } = {}) {
  const latestByPage = new Map();
  for (const r of (Array.isArray(ledgerRows) ? ledgerRows : [])) {
    const page = normPage(r?.url);
    const ts = Date.parse(r?.ts);
    if (!page || !Number.isFinite(ts)) continue;
    if (!latestByPage.has(page) || ts > latestByPage.get(page).ts) latestByPage.set(page, { page, ts, field: r.field || null });
  }
  const judgedAfter = new Map();
  for (const d of (Array.isArray(decisionRows) ? decisionRows : [])) {
    const page = normPage(d?.page);
    const at = Date.parse(d?.at);
    if (!page || !Number.isFinite(at)) continue;
    if (!judgedAfter.has(page) || at > judgedAfter.get(page)) judgedAfter.set(page, at);
  }
  const due = [];
  for (const { page, ts, field } of latestByPage.values()) {
    if ((judgedAfter.get(page) || 0) > ts) continue;              // this change already judged
    const horizonMs = ts + windowDays * DAY;
    if (nowMs < horizonMs) continue;                              // locked horizon not reached — no peeking
    due.push({ page, appliedAt: new Date(ts).toISOString(), appliedMs: ts, lockedHorizonDate: new Date(horizonMs).toISOString().slice(0, 10), field });
  }
  return due.sort((a, b) => a.appliedMs - b.appliedMs);
}

/** PURE: group due changes into shared-window buckets (same applied WEEK ⇒ same GSC pulls). */
export function bucketByWeek(due = [], { maxBuckets = MAX_BUCKETS } = {}) {
  const buckets = new Map();
  for (const d of due) {
    const week = Math.floor(d.appliedMs / (7 * DAY));
    if (!buckets.has(week)) buckets.set(week, { week, appliedMs: d.appliedMs, changes: [] });
    buckets.get(week).changes.push(d);
  }
  return [...buckets.values()].sort((a, b) => a.appliedMs - b.appliedMs).slice(0, maxBuckets);
}

/**
 * The weekly sweep. Injectables (tests never touch network): pullGscImpl, updatesImpl,
 * controllerImpl, nowMs. Returns { swept, booked, note } — booked=0 with an honest note
 * on every degraded path.
 */
export async function horizonSweep(cfg, { log = () => {}, pullGscImpl = null, updatesImpl = null, controllerImpl = runController, nowMs = Date.now(), windowDays = SWEEP_WINDOW_DAYS } = {}) {
  const dir = join(ROOT, 'reports', cfg.name);
  const ledger = readNd(join(dir, 'change-ledger.ndjson'));
  if (!ledger.length) return { swept: 0, booked: 0, note: 'no applied changes on the ledger — nothing to judge' };
  const due = dueChanges(ledger, readNd(join(dir, 'decisions.ndjson')), { nowMs, windowDays });
  if (!due.length) return { swept: 0, booked: 0, note: 'no changes past their locked horizon (or all already judged)' };

  const pullGSC = pullGscImpl || (await import('../gsc.mjs')).pullGSC;
  const { googleUpdates } = updatesImpl ? { googleUpdates: updatesImpl } : await import('../updates.mjs');
  const upd = await googleUpdates({ log }).catch(() => ({ coreUpdateActive: false }));

  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const changes = [];
  for (const bucket of bucketByWeek(due)) {
    const t = bucket.appliedMs;
    let before, after;
    try {
      before = await pullGSC(cfg, { range: { startDate: day(t - windowDays * DAY), endDate: day(t - DAY) } });
      after = await pullGSC(cfg, { range: { startDate: day(t + DAY), endDate: day(Math.min(t + windowDays * DAY, nowMs - DAY)) } });
    } catch (e) { log(`  horizon-sweep: GSC pull failed for week bucket (${String(e.message || e).slice(0, 80)}) — skipping bucket`); continue; }
    if (!before?.enabled || !after?.enabled) { log('  horizon-sweep: GSC off — cannot judge (fail closed, nothing booked)'); continue; }
    const bByPage = new Map((before.pages || []).map((p) => [normPage(p.keys?.[0]), p]));
    const aByPage = new Map((after.pages || []).map((p) => [normPage(p.keys?.[0]), p]));
    for (const c of bucket.changes) {
      const b = bByPage.get(c.page), a = aByPage.get(c.page);
      // A page absent from either window is insufficient-data BY the judge, not skipped here —
      // decideChange owns that verdict; we just refuse to fabricate rows for it.
      if (!b && !a) continue;
      changes.push({
        id: `${c.page}@${c.appliedAt.slice(0, 10)}`, page: c.page,
        before: b ? { clicks: b.clicks, impressions: b.impressions } : null,
        after: a ? { clicks: a.clicks, impressions: a.impressions } : null,
        days: windowDays, lockedHorizonDate: c.lockedHorizonDate,
      });
    }
  }
  if (!changes.length) return { swept: due.length, booked: 0, note: 'due changes had no GSC rows in their windows — nothing bookable yet' };
  const verdicts = controllerImpl(cfg.name, changes, { log, opts: { nowMs, coreUpdateActive: !!upd.coreUpdateActive } });
  return { swept: due.length, booked: verdicts.length, note: null };
}
