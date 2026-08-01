// seo-bot · bets — the Rank Loop's Layer-3 strategy agent, made ACCOUNTABLE. The strategist
// memo used to be advice into the void (no memory, no consumer, no scorecard). Now it places
// BETS: "do X, expect METRIC to improve by DATE". Every bet is scored against the outcomes
// ledger (src/outcomes.mjs) at its locked horizon — hit / miss / inconclusive — and the
// agent's lifetime record is public in every memo and on the dashboard.
//
// Power boundaries (invariants intact):
//   - The agent PROPOSES bets; a human approves (CLI `bets <client> --approve <id>`; the
//     Slack card carries the exact command). Only APPROVED bets become action-plan tasks.
//   - A bet may only name a metric from outcomes.METRICS (fail-closed: unknown metric ⇒ the
//     bet is dropped at parse, not guessed).
//   - Scoring is deterministic from snapshots; missing data ⇒ inconclusive after a grace
//     window, NEVER a guessed hit. CI-aware where the metric carries a CI (panel).
//
// Ledger: reports/<client>/bets.ndjson — append-only, latest-per-id (the tasks.mjs pattern).

import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';
import { METRICS, readSnapshots } from './outcomes.mjs';
import { upsertFromProposals } from './tasks.mjs';

export const BET_STATUSES = ['proposed', 'approved', 'rejected', 'active', 'hit', 'miss', 'inconclusive'];
export const MAX_BETS_PER_CYCLE = 3;
const GRACE_DAYS = 14; // past horizon with no scorable snapshot for this long ⇒ inconclusive
const DAY = 86400000;

const betsPath = (client) => join(ROOT, 'reports', client, 'bets.ndjson');
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function readBetEvents(client) {
  const p = betsPath(client);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Latest state per bet id. */
export function currentBets(client) {
  const m = new Map();
  for (const e of readBetEvents(client)) m.set(e.id, { ...(m.get(e.id) || {}), ...e });
  return [...m.values()];
}

function append(client, row) {
  mkdirSync(join(ROOT, 'reports', client), { recursive: true });
  appendFileSync(betsPath(client), JSON.stringify(row) + '\n');
  return row;
}

/** The agent's lifetime record. */
export function betRecord(client) {
  const by = { proposed: 0, approved: 0, rejected: 0, active: 0, hit: 0, miss: 0, inconclusive: 0 };
  for (const b of currentBets(client)) by[b.status] = (by[b.status] || 0) + 1;
  const judged = by.hit + by.miss;
  return { ...by, open: by.proposed + by.approved + by.active, judged, hitRate: judged ? Math.round((by.hit / judged) * 100) : null };
}

/**
 * PURE-ish placement: memo bets (already schema-validated by the strategist parser) →
 * proposed ledger rows. A bet needs a CURRENT measured value for its metric (you cannot
 * score movement from nothing) — metricless-now bets are refused with a note.
 */
export function placeBets(cfg, memoBets = [], { nowMs = Date.now(), snapshots = null, log = () => {} } = {}) {
  const snaps = snapshots || readSnapshots(cfg.name);
  const latest = snaps[snaps.length - 1] || null;
  const existing = new Set(currentBets(cfg.name).map((b) => b.id));
  const placed = [], refused = [];
  const day = new Date(nowMs).toISOString().slice(0, 10);
  for (const mb of memoBets.slice(0, MAX_BETS_PER_CYCLE)) {
    if (mb.client && mb.client !== cfg.name) continue; // portfolio memo — only this client's bets
    const metric = METRICS[mb.metric];
    if (!metric) { refused.push({ title: mb.title, reason: `unknown metric "${mb.metric}"` }); continue; }
    const placedValue = latest ? metric.get(latest) : null;
    if (!Number.isFinite(placedValue)) { refused.push({ title: mb.title, reason: `no current measurement for ${mb.metric} — run the lane first, then bet` }); continue; }
    const id = `bet-${day}-${slug(mb.title)}`;
    if (existing.has(id)) continue; // idempotent re-run
    const weeks = Math.min(6, Math.max(2, Math.round(mb.horizonWeeks || 4)));
    placed.push(append(cfg.name, {
      id, at: nowIso(), cycle: day, status: 'proposed',
      title: String(mb.title).slice(0, 140), client: cfg.name, lane: mb.lane, action: String(mb.action || '').slice(0, 300),
      metric: mb.metric, expectedDirection: metric.dir, horizonWeeks: weeks,
      horizonDate: new Date(nowMs + weeks * 7 * DAY).toISOString().slice(0, 10),
      placedValue, placedCi: mb.metric === 'panel.appearanceRate' ? (latest?.panel?.ci ?? null) : null,
      why: String(mb.why || '').slice(0, 400),
    }));
  }
  if (refused.length) for (const r of refused) log(`  bets: refused "${r.title}" — ${r.reason}`);
  return { placed, refused };
}

/** Human approval (CLI). Approved bets become an action-plan task (proposed → the founder/bot
 *  lane executes it through the normal gates); rejection just records. */
export function decideBet(cfg, betId, verdict, { actor = 'founder' } = {}) {
  const bet = currentBets(cfg.name).find((b) => b.id === betId);
  if (!bet) return { ok: false, reason: `no bet ${betId}` };
  if (bet.status !== 'proposed') return { ok: false, reason: `bet is ${bet.status}, not proposed` };
  if (!['approve', 'reject'].includes(verdict)) return { ok: false, reason: `verdict must be approve|reject` };
  if (verdict === 'reject') { append(cfg.name, { ...bet, status: 'rejected', at: nowIso(), actor }); return { ok: true, status: 'rejected' }; }
  append(cfg.name, { ...bet, status: 'approved', at: nowIso(), actor });
  upsertFromProposals(cfg.name, [{ type: `bet:${bet.id}`, page: bet.lane, severity: 'medium' }], { actor: 'bet-cycle' });
  append(cfg.name, { ...bet, status: 'active', at: nowIso(), actor: 'bet-cycle' });
  return { ok: true, status: 'active' };
}

const ciOverlap = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === 2 && b.length === 2 && a[0] <= b[1] && b[0] <= a[1];

/**
 * PURE: score active bets past their horizon against the snapshot ledger.
 * horizonValue = first snapshot at/after horizonDate. No such snapshot: wait inside the
 * grace window, then inconclusive. Panel-metric bets with overlapping CIs ⇒ inconclusive
 * (a "win" inside the noise band is not a win).
 */
export function scoreDueBets(bets = [], snapshots = [], { nowMs = Date.now() } = {}) {
  const scored = [];
  for (const b of bets) {
    if (b.status !== 'active') continue;
    const horizonMs = Date.parse(b.horizonDate);
    if (!Number.isFinite(horizonMs) || nowMs < horizonMs) continue;
    const metric = METRICS[b.metric];
    if (!metric) { scored.push({ ...b, status: 'inconclusive', note: 'metric no longer exists' }); continue; }
    const snap = snapshots.find((s) => Date.parse(s.at) >= horizonMs && Number.isFinite(metric.get(s)));
    if (!snap) {
      if (nowMs > horizonMs + GRACE_DAYS * DAY) scored.push({ ...b, status: 'inconclusive', note: `no measured snapshot within ${GRACE_DAYS}d past horizon — cannot score (never guessed)` });
      continue; // still inside grace — keep waiting
    }
    const horizonValue = metric.get(snap);
    const delta = Math.round((horizonValue - b.placedValue) * 100) / 100;
    if (b.metric === 'panel.appearanceRate' && ciOverlap(b.placedCi, snap.panel?.ci)) {
      scored.push({ ...b, status: 'inconclusive', horizonValue, delta, note: 'confidence intervals overlap — movement is inside the noise band' });
      continue;
    }
    const improved = metric.dir === 'up' ? delta > 0 : delta < 0;
    scored.push({ ...b, status: improved ? 'hit' : 'miss', horizonValue, delta, note: `${b.metric}: ${b.placedValue} → ${horizonValue} (${delta >= 0 ? '+' : ''}${delta})` });
  }
  return scored;
}

/** The per-client brief artifact the strategist reads next cycle (its own memory + record). */
export function renderBetsBrief(client, { record = null, open = [], scoredNow = [] } = {}) {
  const rec = record || betRecord(client);
  const L = [`# Bet ledger — ${client}`, '',
    `**Agent record: ${rec.hit} hit / ${rec.miss} miss / ${rec.inconclusive} inconclusive · hit-rate ${rec.hitRate === null ? 'n/a (nothing judged yet)' : rec.hitRate + '%'} · ${rec.open} open**`, ''];
  if (scoredNow.length) { L.push('## Just scored'); for (const b of scoredNow) L.push(`- ${b.status === 'hit' ? '✅ HIT' : b.status === 'miss' ? '❌ MISS' : '≈ inconclusive'} — ${b.title} (${b.note || ''})`); L.push(''); }
  if (open.length) { L.push('## Open bets (do not re-propose these)'); for (const b of open) L.push(`- [${b.status}] ${b.title} → ${b.metric} by ${b.horizonDate} (placed at ${b.placedValue})`); L.push(''); }
  L.push('_Bets are scored against reports/<client>/outcomes.ndjson at their locked horizon. Misses are information, not shame — but repeat losing bets get the agent overruled._');
  return L.join('\n');
}

/**
 * The weekly cycle for one client: 1) score dues, 2) place any of today's memo bets for this
 * client (memo = reports/_strategist/<day>.json, written by the morning strategist pass),
 * 3) persist the brief the next strategist run reads, 4) return what the caller should notify.
 */
export async function runBetCycle(cfg, { log = () => {}, nowMs = Date.now(), memo = null } = {}) {
  const snaps = readSnapshots(cfg.name);
  const before = currentBets(cfg.name);
  const scoredNow = scoreDueBets(before, snaps, { nowMs });
  for (const s of scoredNow) append(cfg.name, { ...s, at: nowIso(), scoredAt: nowIso() });

  let placed = [], refused = [];
  let m = memo;
  if (!m) {
    for (const back of [0, 1, 2]) { // today's memo, else the last couple of mornings
      const day = new Date(nowMs - back * DAY).toISOString().slice(0, 10);
      const p = join(ROOT, 'reports', '_strategist', `${day}.json`);
      if (existsSync(p)) { try { m = JSON.parse(readFileSync(p, 'utf-8')); } catch { m = null; } if (m) break; }
    }
  }
  if (Array.isArray(m?.bets) && m.bets.length) {
    const r = placeBets(cfg, m.bets, { nowMs, snapshots: snaps, log });
    placed = r.placed; refused = r.refused;
  }
  const record = betRecord(cfg.name);
  const open = currentBets(cfg.name).filter((b) => ['proposed', 'approved', 'active'].includes(b.status));
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bets-brief.md'), renderBetsBrief(cfg.name, { record, open, scoredNow }));
  log(`  bets: ${scoredNow.length} scored (${scoredNow.filter((b) => b.status === 'hit').length} hit) · ${placed.length} proposed · record ${record.hit}H/${record.miss}M · hit-rate ${record.hitRate ?? 'n/a'}${record.hitRate !== null ? '%' : ''}`);
  return { scoredNow, placed, refused, record, open };
}
