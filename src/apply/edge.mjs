// seo-bot · apply/edge — OTTO's Cloudflare write-back, but on infra WE own.
//
// Writes approved meta/title/canonical/robots/JSON-LD/answer-capsule OVERRIDES, keyed by
// pathname, into a Vercel Edge Config overlay (cfg.edge.edgeConfigId). A client `proxy.ts`
// + `generateMetadata` reads this overlay at request time, so the fix is SERVER-RENDERED
// (visible to every AI crawler on first byte) and goes live in seconds with NO full deploy
// — and a one-flag rollback (delete the overlay key). This is parity with OTTO's
// Cloudflare mode, minus the third-party proxy, minus the cloaking risk.
//
// Two destinations, both gated behind --yes (confirm):
//   1. reports/<client>/edge-rules.json   — versioned, git-committable, rollback-able artifact
//   2. Vercel Edge Config API (PATCH)     — the live overlay (only when confirm && token)
//
// SAFETY: every rule passes through edge/cloaking-guard before it can be written. We refuse
// to overlay anything that would diverge bot↔human visible body text (the SPLX failure mode).
//
// Setup: cfg.edge = { edgeConfigId: "ecfg_…", key?: "seoOverlay", token?: "ENV:VERCEL_API_TOKEN", teamId?: "…" }
//   token resolves from VERCEL_API_TOKEN env (or cfg.edge.token; "ENV:NAME" indirection supported).

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { guardProposals, fieldOf } from '../edge/cloaking-guard.mjs';

const VERCEL_API = 'https://api.vercel.com';

/** Resolve the Vercel API token from env or config ("ENV:NAME" indirection supported). */
function vercelToken(cfg) {
  const v = process.env.VERCEL_API_TOKEN || cfg?.edge?.token;
  return v && v.startsWith('ENV:') ? process.env[v.slice(4)] : v;
}

/** Pathname key for a proposal (overlay is keyed by URL path). */
function pathOf(cfg, p) {
  const raw = p.page || p.url || '/';
  try { return new URL(raw, cfg.baseUrl).pathname || '/'; }
  catch { return raw.startsWith('/') ? raw : `/${raw}`; }
}

/**
 * Turn guarded proposals into a path-keyed overlay object:
 *   { "/services/botox": { title, description, canonical, robots, og, twitter, hreflang,
 *                          jsonld:[…], capsule, _meta:{ids,ranAt} }, … }
 * Each field is the *proposed* value; we never include body/visible-text fields (guarded out).
 * @returns {{overlay:object, ruleCount:number}}
 */
export function buildOverlay(cfg, proposals) {
  const overlay = {};
  for (const p of proposals) {
    const path = pathOf(cfg, p);
    const field = fieldOf(p.type);
    const node = (overlay[path] = overlay[path] || { _meta: { ids: [] } });
    node._meta.ids.push(p.id);
    if (field === 'jsonld') { node.jsonld = node.jsonld || []; node.jsonld.push(p.proposed); }
    else if (field === 'answer-capsule') { node.capsule = p.proposed; }
    else { node[field] = p.proposed; }
  }
  return { overlay, ruleCount: Object.keys(overlay).length };
}

/** Read the previously-committed overlay artifact, if any (for diff/rollback context). */
function loadPriorOverlay(client) {
  const f = join(ROOT, 'reports', client, 'edge-rules.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf-8')); } catch { return null; }
}

/** PATCH the Vercel Edge Config: upsert one item whose value is the path-keyed overlay. */
async function patchEdgeConfig(token, edgeConfigId, key, overlay, teamId) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const res = await fetch(`${VERCEL_API}/v1/edge-config/${edgeConfigId}/items${qs}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ operation: 'upsert', key, value: overlay }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Vercel Edge Config ${res.status}: ${j.error?.message || res.statusText}`);
  return j;
}

/** GET the live overlay value so we MERGE into it (never blind-overwrite + drop prior paths). */
async function getEdgeConfigItem(token, edgeConfigId, key, teamId) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  try {
    const res = await fetch(`${VERCEL_API}/v1/edge-config/${edgeConfigId}/item/${encodeURIComponent(key)}${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null; // 404 = key not set yet; treat as empty
    return await res.json().catch(() => null);
  } catch { return null; }
}

/** Deep-merge per path node: keep every prior path, let the new run's fields win on its paths. */
export function mergeOverlays(base = {}, next = {}) {
  const out = { ...(base || {}) };
  for (const [path, node] of Object.entries(next || {})) {
    const prev = out[path] || {};
    out[path] = { ...prev, ...node, _meta: { ...(prev._meta || {}), ...(node._meta || {}), ids: [...new Set([...(prev._meta?.ids || []), ...(node._meta?.ids || [])])].slice(-200) } }; // dedup + cap: ids grow every run, Vercel Edge Config caps items at 64KB
  }
  return out;
}

/** Rollback ONE journaled edge change: re-PATCH the prior value (or delete a path that was new). */
export async function restoreEdge(cfg, planEntry) {
  const token = vercelToken(cfg);
  const edgeConfigId = cfg.edge?.edgeConfigId;
  const key = cfg.edge?.key || 'seoOverlay';
  if (!token || !edgeConfigId) throw new Error('edge rollback needs VERCEL_API_TOKEN + cfg.edge.edgeConfigId');
  const live = (await getEdgeConfigItem(token, edgeConfigId, key, cfg.edge?.teamId)) || {};
  if (planEntry.restoreTo == null) delete live[planEntry.url];      // path was newly added → remove it
  else live[planEntry.url] = planEntry.restoreTo;                   // restore the prior node verbatim
  await patchEdgeConfig(token, edgeConfigId, key, live, cfg.edge?.teamId);
  return true;
}

/**
 * Apply approved fixes to the Vercel Edge Config overlay.
 * Contract: applyEdge(cfg, data, { log, confirm }) → { applied:[…] }
 * @param {object} cfg   client config (reads cfg.edge.edgeConfigId / .key / .token / .teamId)
 * @param {{proposals:Array, ranAt?:string, score?:number}} data
 * @param {{log?:Function, confirm?:boolean}} opts
 */
export async function applyEdge(cfg, data, { log = () => {}, confirm = false } = {}) {
  const proposals = (data?.proposals || []).filter((p) => p.autoApplicable !== false);
  if (!proposals.length) { log('  No proposals to overlay.'); return { applied: [] }; }

  // SAFETY GATE — refuse any cloaking-class change before it can reach the overlay.
  const { safe, refused } = guardProposals(proposals);
  for (const r of refused) log(`    ⛔ refused ${r.p.id} (${r.field}) — ${r.reason}`);
  if (!safe.length) { log('  All proposals refused by the cloaking guard — nothing to overlay.'); return { applied: [], refused }; }

  const { overlay, ruleCount } = buildOverlay(cfg, safe);
  const key = cfg.edge?.key || 'seoOverlay';
  const edgeConfigId = cfg.edge?.edgeConfigId;

  // 1) Always write the versioned artifact (preview AND apply both produce this).
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const artifact = {
    client: cfg.name, domain: cfg.domain, edgeConfigId: edgeConfigId || null, key,
    ranAt: data.ranAt || new Date().toISOString(), ruleCount, rules: safe.length,
    overlay,
  };
  const artifactPath = join(dir, 'edge-rules.json');

  // Preview: print the rule table, write the artifact, change nothing live.
  if (!confirm) {
    log(`  Edge overlay PREVIEW — ${safe.length} safe override(s) over ${ruleCount} path(s)${refused.length ? `, ${refused.length} refused` : ''}:`);
    for (const [path, node] of Object.entries(overlay)) {
      const fields = Object.keys(node).filter((k) => k !== '_meta');
      log(`    ${path} → ${fields.join(', ')}`);
    }
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    log(`  Wrote rollback-able artifact ${artifactPath}. Re-run with --yes to PUT to Edge Config (live, no deploy).`);
    return { applied: [], dryrun: true, refused, overlay, artifactPath };
  }

  // Apply: write artifact, then PUT live (gated on token + edgeConfigId).
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  const prior = loadPriorOverlay(cfg.name);
  if (prior) log('  (prior edge-rules.json preserved in git history for rollback.)');

  const token = vercelToken(cfg);
  if (!edgeConfigId) { log('  ⚠ cfg.edge.edgeConfigId not set — wrote artifact only (no live overlay).'); return { applied: [artifactPath], refused, overlay, live: false }; }
  if (!token) { log('  ⚠ VERCEL_API_TOKEN not set — wrote artifact only (no live overlay).'); return { applied: [artifactPath], refused, overlay, live: false }; }

  try {
    // MERGE into the live overlay (GET → merge → PATCH) so a fix on page-B never drops page-A's
    // prior override. Fall back to the committed artifact if the GET is unavailable.
    const live = (await getEdgeConfigItem(token, edgeConfigId, key, cfg.edge?.teamId)) || loadPriorOverlay(cfg.name)?.overlay || {};
    const merged = mergeOverlays(live, overlay);
    await patchEdgeConfig(token, edgeConfigId, key, merged, cfg.edge?.teamId);
    writeFileSync(artifactPath, JSON.stringify({ ...artifact, overlay: merged, mergedFromLive: true }, null, 2));
    // One journaled entry per path, each carrying its BEFORE node → rollback can re-PATCH it.
    const applied = Object.keys(overlay).map((path) => ({
      url: path, field: Object.keys(overlay[path]).filter((k) => k !== '_meta').join(','), rule: 'edge-overlay',
      before: live[path] ?? null, after: overlay[path], ref: `edge-config:${edgeConfigId}/${key}`,
    }));
    log(`  ✓ Live: merged ${ruleCount} path override(s) into Edge Config ${edgeConfigId} key "${key}" over ${Object.keys(live).length} existing — no prior overrides dropped.`);
    log(`  ↩ Rollback: \`rollback ${cfg.name}\` re-PATCHes the prior per-path values (journaled).`);
    return { applied, refused, overlay: merged, live: true };
  } catch (e) {
    log(`  ✗ Edge Config PATCH failed: ${e.message}. NO live change made (local artifact kept; not counted as applied).`);
    return { applied: [], refused, overlay, live: false, error: String(e.message) };
  }
}
