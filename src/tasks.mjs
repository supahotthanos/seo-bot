// seo-bot · tasks — fix lifecycle state machine (OTTO's Recommended→Deployed→Live,
// but as a versioned, queryable, append-only ledger instead of a rented dashboard).
//
// State per fix: proposed → queued → approved → deploying → deployed → verified
//                              ↘ rejected            ↘ rolled_back
// Stored as reports/<client>/tasks.ndjson (append-only; collapse to latest by id).
// Pairs with change-ledger.mjs (which journals the actual byte-level before/after).

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

export const STATUSES = ['proposed', 'queued', 'approved', 'deploying', 'deployed', 'verified', 'rolled_back', 'rejected'];
const dirFor = (client) => join(ROOT, 'reports', client);
const fileFor = (client) => join(dirFor(client), 'tasks.ndjson');

export function loadEvents(client) {
  const f = fileFor(client);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Collapse the append-only log to the latest state per task id. */
export function currentTasks(client) {
  const m = new Map();
  for (const e of loadEvents(client)) m.set(e.id, { ...(m.get(e.id) || {}), ...e });
  return [...m.values()];
}

function append(client, rec) {
  mkdirSync(dirFor(client), { recursive: true });
  appendFileSync(fileFor(client), JSON.stringify(rec) + '\n');
  return rec;
}

/** Create tasks for any proposals not already tracked (keyed by type:page). Returns count created. */
export function upsertFromProposals(client, proposals = [], { actor = 'auto' } = {}) {
  const seen = new Set(currentTasks(client).map((t) => t.taskKey));
  let n = 0;
  for (const p of proposals) {
    const taskKey = `${p.type}:${p.page}`;
    if (seen.has(taskKey)) continue;
    const at = nowIso();
    append(client, { id: `${client}-${at.replace(/[:.]/g, '-')}-${++n}`, taskKey, type: p.type, page: p.page, severity: p.severity, priority: p.priority ?? null, status: 'proposed', actor, at, history: [{ status: 'proposed', at, actor }] });
    seen.add(taskKey);
  }
  return n;
}

/** Transition a task. Records who/when + an optional commit SHA (git-backed rollback). */
export function setStatus(client, id, status, { actor = 'human', commit = null, note = null } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
  const cur = currentTasks(client).find((t) => t.id === id);
  if (!cur) throw new Error(`no task ${id} for ${client}`);
  const at = nowIso();
  return append(client, { ...cur, status, actor, at, commit: commit ?? cur.commit ?? null, note, history: [...(cur.history || []), { status, at, actor, note }] });
}

export function summarize(client) {
  const t = currentTasks(client);
  const by = {};
  for (const x of t) by[x.status] = (by[x.status] || 0) + 1;
  return { total: t.length, by };
}
