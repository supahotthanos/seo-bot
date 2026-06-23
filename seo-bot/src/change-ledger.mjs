// seo-bot · change-ledger — disaster recovery for the apply layer. Every CMS write the
// bot makes is journaled with its BEFORE value, so a change can be inspected and reversed.
// Next.js writes go through PRs (git-revertable by design); WordPress REST writes overwrite
// in place, so the before-value snapshot is the only way back. Nothing here auto-reverts;
// rollback is an explicit, gated action.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

const ledgerPath = (client) => join(ROOT, 'seo-bot', 'reports', client, 'change-ledger.ndjson');

/** Record applied changes. Each entry should carry { url|page, field|rule, before, after, ref }. */
export function recordChanges(client, applied, { adapter = '', runId = null } = {}) {
  if (!applied?.length) return 0;
  const dir = join(ROOT, 'seo-bot', 'reports', client);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const a of applied) {
    const reversible = a.before != null || adapter === 'nextjs' || adapter === 'edge' || adapter === 'cloudflare-worker';
    appendFileSync(ledgerPath(client), JSON.stringify({ ts: nowIso(), runId, adapter, url: a.url || a.page || null, field: a.field || a.rule || a.kind || null, before: a.before ?? null, after: a.after ?? null, ref: a.pr || a.commit || a.postId || a.ref || null, reversible }) + '\n');
    n++;
  }
  return n;
}

export function listChanges(client, { limit = 30 } = {}) {
  const p = ledgerPath(client);
  if (!existsSync(p)) return [];
  const rows = readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return rows.slice(-limit).reverse();
}

/** Produce (and optionally execute) the reversal plan for the last N changes. */
export async function rollback(cfg, { log = () => {}, last = 1, confirm = false } = {}) {
  const rows = listChanges(cfg.name, { limit: last });
  if (!rows.length) { log('  no recorded changes to roll back.'); return { reverted: 0, plan: [] }; }
  const isEdge = (a) => a === 'edge' || a === 'cloudflare-worker';
  const plan = rows.map((r) => ({ url: r.url, field: r.field, restoreTo: r.before, adapter: r.adapter, ref: r.ref, doable: r.before != null || r.adapter === 'nextjs' || isEdge(r.adapter) }));
  log(`\n  Rollback plan (last ${rows.length}):`);
  for (const p of plan) log(`   ${p.doable ? '↩︎' : '⚠️ '} ${p.url} · ${p.field} ${p.adapter === 'nextjs' ? `→ git revert ${p.ref || 'the PR'}` : isEdge(p.adapter) ? (p.restoreTo != null ? '→ re-PATCH prior overlay value' : '→ delete the overlay path (was newly added)') : p.restoreTo != null ? '→ restore prior value' : '→ NO before-snapshot (cannot auto-revert)'}`);
  if (!confirm) { log('\n  (preview — pass --yes to execute WordPress/edge reversals; Next.js changes revert via the PR/git)'); return { reverted: 0, plan }; }

  let reverted = 0;
  if (cfg.cms?.type === 'wordpress') {
    try {
      const wp = await import('./apply/wordpress.mjs');
      if (typeof wp.wpRestore === 'function') {
        for (const p of plan) if (p.restoreTo != null && p.ref) { await wp.wpRestore(cfg, p.ref, p.field, p.restoreTo); reverted++; log(`   ✅ restored ${p.url} · ${p.field}`); }
      } else log('   wordpress adapter has no wpRestore() — restore the printed before-values manually.');
    } catch (e) { log('   rollback execution error: ' + String(e.message || e)); }
  } else if (isEdge(cfg.cms?.type) || rows.some((r) => isEdge(r.adapter))) {
    try {
      const { restoreEdge } = await import('./apply/edge.mjs');
      for (const p of plan) if (isEdge(p.adapter)) { await restoreEdge(cfg, p); reverted++; log(`   ✅ reverted ${p.url} (edge overlay)`); }
    } catch (e) { log('   edge rollback error: ' + String(e.message || e)); }
  } else {
    log('   Next.js/dryrun changes are git-tracked — revert the PR/commit listed above.');
  }
  return { reverted, plan };
}
