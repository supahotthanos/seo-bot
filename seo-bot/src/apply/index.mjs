// seo-bot · apply — dispatch fix proposals to the client's CMS adapter.
// Default is dryrun (writes intended changes, changes nothing). nextjs and
// wordpress adapters actually apply, behind a human-approval gate.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';

/** Load the most recent proposals-*.json for a client. */
export function loadLatestProposals(cfg) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.startsWith('proposals-') && f.endsWith('.json')).sort();
  if (!files.length) return null;
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf-8'));
}

export async function applyClient(cfg, { log = () => {}, confirm = false } = {}) {
  const data = loadLatestProposals(cfg);
  if (!data || !data.proposals?.length) { log('No proposals found. Run `propose` first.'); return { applied: [] }; }
  const type = cfg.cms?.type || 'dryrun';
  log(`Applying ${data.proposals.length} proposals via "${type}" adapter${confirm ? '' : ' (preview — pass --yes to execute writes)'} …`);

  let result;
  if (type === 'nextjs') { const { applyNextjs } = await import('./nextjs.mjs'); result = await applyNextjs(cfg, data, { log, confirm }); }
  else if (type === 'wordpress') { const { applyWordpress } = await import('./wordpress.mjs'); result = await applyWordpress(cfg, data, { log, confirm }); }
  else if (type === 'edge') { const { applyEdge } = await import('./edge.mjs'); result = await applyEdge(cfg, data, { log, confirm }); }
  else if (type === 'cloudflare-worker') { const { applyCloudflareWorker } = await import('./cloudflare-worker.mjs'); result = await applyCloudflareWorker(cfg, data, { log, confirm }); }
  else { const { applyDryrun } = await import('./dryrun.mjs'); result = await applyDryrun(cfg, data, { log }); }

  // Journal every executed write with its before-value for disaster recovery / rollback.
  if (confirm && result?.applied?.length) {
    try { const { recordChanges } = await import('../change-ledger.mjs'); const n = recordChanges(cfg.name, result.applied, { adapter: type }); if (n) log(`  ↳ journaled ${n} change(s) to change-ledger.ndjson (rollback-able).`); } catch { /* ledger is best-effort */ }
  }
  return result;
}
