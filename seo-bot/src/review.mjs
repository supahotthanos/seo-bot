// seo-bot · review — batched human review over the task ledger (Epic 1, work-unit A11).
//
// OTTO ships a single "Deploy all" button with no risk tiers. We give the human a
// grouped, risk-tiered review surface: list queued tasks by category, then approve a
// whole category, approve only the low-risk ones, or reject — all writing back through
// tasks.setStatus (the append-only ledger), never touching production directly.
//
// `seo-bot review <client>`                      → list grouped queued tasks
// `seo-bot review <client> --approve-category title`
// `seo-bot review <client> --approve-all-low-risk`
// `seo-bot review <client> --reject <taskId|category>`

import { currentTasks, setStatus } from './tasks.mjs';

const REVIEWABLE = new Set(['proposed', 'queued']);

/** Group a client's reviewable (proposed/queued) tasks by change type. */
export function listQueued(client) {
  const tasks = currentTasks(client).filter((t) => REVIEWABLE.has(t.status));
  const byType = new Map();
  for (const t of tasks) {
    if (!byType.has(t.type)) byType.set(t.type, []);
    byType.get(t.type).push(t);
  }
  // Highest-severity, then highest-EV first within each group.
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const groups = [...byType.entries()].map(([type, items]) => ({
    type,
    count: items.length,
    items: items.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || (b.priority ?? 0) - (a.priority ?? 0)),
  })).sort((a, b) => b.count - a.count);
  return { total: tasks.length, groups };
}

/** Low-risk = a deterministic clamp the policy engine would consider auto-approvable. */
export function isLowRisk(task) {
  return (task.type === 'meta' || task.type === 'title') && (task.severity === 'low' || task.severity === 'medium');
}

/** Approve a whole category of queued tasks → status "approved". Returns count. */
export function approveCategory(client, type, { actor = 'human', note = null } = {}) {
  const targets = currentTasks(client).filter((t) => REVIEWABLE.has(t.status) && t.type === type);
  for (const t of targets) setStatus(client, t.id, 'approved', { actor, note: note || `batch-approve category ${type}` });
  return targets.length;
}

/** Approve only the low-risk queued tasks across every category. Returns count. */
export function approveAllLowRisk(client, { actor = 'human' } = {}) {
  const targets = currentTasks(client).filter((t) => REVIEWABLE.has(t.status) && isLowRisk(t));
  for (const t of targets) setStatus(client, t.id, 'approved', { actor, note: 'batch-approve low-risk' });
  return targets.length;
}

/** Reject a single task id, or a whole category if a known type is passed. Returns count. */
export function reject(client, idOrType, { actor = 'human', note = null } = {}) {
  const all = currentTasks(client).filter((t) => REVIEWABLE.has(t.status));
  const byId = all.find((t) => t.id === idOrType);
  const targets = byId ? [byId] : all.filter((t) => t.type === idOrType);
  for (const t of targets) setStatus(client, t.id, 'rejected', { actor, note: note || 'rejected in review' });
  return targets.length;
}

/** Approve one specific task id → "approved". Returns the new record or null. */
export function approveOne(client, id, { actor = 'human', note = null } = {}) {
  const t = currentTasks(client).find((x) => x.id === id && REVIEWABLE.has(x.status));
  if (!t) return null;
  return setStatus(client, id, 'approved', { actor, note: note || 'approved in review' });
}

/**
 * CLI entry. With no action flags, prints the grouped queue. With an action flag,
 * performs the batch transition and prints the result. Read-only by default.
 */
export function review(cfg, { log = () => {}, action = null, value = null, actor = 'human' } = {}) {
  const client = cfg.name;

  if (action === 'approve-category') {
    if (!value) { log('  usage: review <client> --approve-category <type>'); return { ok: false }; }
    const n = approveCategory(client, value, { actor });
    log(`  ✓ approved ${n} "${value}" task(s) → status "approved" (apply still gated by --yes).`);
    return { ok: true, approved: n };
  }
  if (action === 'approve-all-low-risk') {
    const n = approveAllLowRisk(client, { actor });
    log(`  ✓ approved ${n} low-risk task(s) (meta/title, low/medium severity).`);
    return { ok: true, approved: n };
  }
  if (action === 'reject') {
    if (!value) { log('  usage: review <client> --reject <taskId|category>'); return { ok: false }; }
    const n = reject(client, value, { actor });
    log(`  ✗ rejected ${n} task(s) matching "${value}".`);
    return { ok: true, rejected: n };
  }

  // Default: print the grouped review surface.
  const { total, groups } = listQueued(client);
  if (!total) { log('  No queued tasks. Run `run <client>` (or `propose`) to generate proposals first.'); return { ok: true, total: 0 }; }
  log(`\n  Review queue — ${cfg.brand} · ${total} task(s) awaiting human decision\n`);
  for (const g of groups) {
    const low = g.items.filter(isLowRisk).length;
    log(`  ▸ ${g.type}  (${g.count})  ${low ? `· ${low} low-risk` : ''}`);
    for (const t of g.items.slice(0, 8)) {
      log(`      [${t.severity}${t.priority != null ? ` · EV ${t.priority}` : ''}] ${t.page}  ${t.id}`);
    }
    if (g.items.length > 8) log(`      … +${g.items.length - 8} more`);
  }
  log(`\n  Actions:`);
  log(`    review ${client} --approve-all-low-risk          approve every meta/title low-risk fix`);
  log(`    review ${client} --approve-category <type>       approve a whole category (e.g. title)`);
  log(`    review ${client} --reject <taskId|category>      reject a task or a category`);
  log(`  Then: apply ${client} --yes   (writes only the "approved" set, still gated).\n`);
  return { ok: true, total, groups };
}
