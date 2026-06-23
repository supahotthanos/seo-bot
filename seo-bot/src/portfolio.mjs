// seo-bot · portfolio — multi-tenant health rollup (Epic 1, work-unit A11).
//
// OTTO's Portfolio Summary is a read-only 0-100 board priced into the $999/mo Agency
// tier. We scan every config/*.json client, read each run-latest.json + task ledger,
// and emit a single 0-100 health table plus cross-domain signals — for free, across
// domains we actually own (so we can also surface cross-domain link/entity equity).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listConfigs, loadConfig } from './config.mjs';
import { nowIso } from './util.mjs';
import { currentTasks } from './tasks.mjs';

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; } }

/**
 * Blend each client's signals into one 0-100 health score:
 *   55% audit health · 25% build progress · 20% delivery hygiene (deployed vs rolled-back).
 * Missing inputs degrade gracefully (the weight is dropped, not zeroed).
 */
export function healthScore({ auditScore, progressScore, taskStats }) {
  const parts = [];
  if (auditScore != null) parts.push([auditScore, 0.55]);
  if (progressScore != null) parts.push([progressScore, 0.25]);
  const dep = taskStats?.deployed || 0, rb = taskStats?.rolledBack || 0;
  if (dep + rb > 0) parts.push([Math.round((dep / (dep + rb)) * 100), 0.20]);
  if (!parts.length) return null;
  const wsum = parts.reduce((s, [, w]) => s + w, 0);
  return Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wsum);
}

/** One client's portfolio row. */
export function clientRow(name) {
  let cfg;
  try { cfg = loadConfig(name); } catch (e) { return { name, error: e.message }; }
  const dir = join(ROOT, 'seo-bot', 'reports', name);
  const run = readJson(join(dir, 'run-latest.json')) || {};
  const tasks = currentTasks(name);
  const tally = tasks.reduce((m, t) => { m[t.status] = (m[t.status] || 0) + 1; return m; }, {});
  const taskStats = {
    deployed: (tally.deployed || 0) + (tally.verified || 0),
    rolledBack: tally.rolled_back || 0,
    queued: (tally.queued || 0) + (tally.proposed || 0),
    approved: tally.approved || 0,
  };
  const row = {
    name, brand: cfg.brand, baseUrl: cfg.baseUrl, cms: cfg.cms?.type || 'dryrun',
    domains: cfg.domains || [cfg.domain],
    auditScore: run.auditScore ?? null, progressScore: run.progressScore ?? null,
    gscEnabled: !!run.gscEnabled, ga4Enabled: !!run.ga4Enabled,
    aiReferralSessions: run.aiReferralSessions ?? null,
    lastRun: run.finished || null, taskStats,
  };
  row.health = healthScore(row);
  return row;
}

/**
 * Cross-domain signals across owned properties: shared competitors, total owned
 * domains, and which clients share a domain root (entity-graph binding candidates).
 */
export function crossDomainSignals(rows) {
  const allDomains = new Set();
  const roots = new Map(); // registrable-ish root → [client]
  for (const r of rows) {
    for (const d of (r.domains || [])) {
      allDomains.add(d);
      const root = d.split('.').slice(-2).join('.');
      if (!roots.has(root)) roots.set(root, []);
      roots.get(root).push(r.name);
    }
  }
  const sharedRoots = [...roots.entries()].filter(([, names]) => new Set(names).size > 1).map(([root, names]) => ({ root, clients: [...new Set(names)] }));
  return { totalOwnedDomains: allDomains.size, sharedRoots, bindingCandidates: sharedRoots.length };
}

const dot = (h) => (h == null ? '·' : h >= 80 ? '🟢' : h >= 55 ? '🟡' : '🔴');

/** Render the rollup as markdown. */
export function renderMd(roll) {
  const L = [`# Portfolio health — ${roll.clients.length} client(s)`, `${new Date(roll.ranAt).toUTCString()}`, ''];
  L.push(`| | Client | Health | Audit | Progress | GSC | GA4 | Queued | Deployed | Rolled back |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of roll.rows) {
    if (r.error) { L.push(`| ⚠ | ${r.name} | — | _${r.error}_ | | | | | |`); continue; }
    L.push(`| ${dot(r.health)} | **${r.brand}** | ${r.health ?? '—'} | ${r.auditScore ?? '—'} | ${r.progressScore ?? '—'} | ${r.gscEnabled ? '✓' : '—'} | ${r.ga4Enabled ? '✓' : '—'} | ${r.taskStats.queued} | ${r.taskStats.deployed} | ${r.taskStats.rolledBack} |`);
  }
  L.push('');
  const x = roll.crossDomain;
  L.push(`## Cross-domain signals`);
  L.push(`- Owned domains tracked: **${x.totalOwnedDomains}**`);
  L.push(`- Shared-root binding candidates (cross-domain entity \`sameAs\` / PageRank flow): **${x.bindingCandidates}**`);
  for (const s of x.sharedRoots) L.push(`  - \`${s.root}\` → ${s.clients.join(', ')}`);
  L.push('');
  return L.join('\n');
}

/** Build the full rollup over every configured client. */
export function buildPortfolio() {
  const names = listConfigs();
  const rows = names.map(clientRow);
  const ok = rows.filter((r) => !r.error);
  const avg = ok.length ? Math.round(ok.reduce((s, r) => s + (r.health || 0), 0) / ok.length) : null;
  return { ranAt: nowIso(), clients: names, rows, portfolioHealth: avg, crossDomain: crossDomainSignals(ok) };
}

/** CLI entry: build + print + persist the rollup. */
export function portfolio({ log = () => {} } = {}) {
  const roll = buildPortfolio();
  if (!roll.clients.length) { log('  No client configs in seo-bot/config/. Add <name>.json first.'); return roll; }
  log(`\n  Portfolio health — ${roll.clients.length} client(s) · avg ${roll.portfolioHealth ?? '—'}/100\n`);
  log(`  ${''.padEnd(2)} ${'client'.padEnd(24)} ${'health'.padStart(6)} ${'audit'.padStart(6)} ${'prog'.padStart(5)} ${'queued'.padStart(7)} ${'dep'.padStart(4)} ${'rb'.padStart(3)}`);
  for (const r of roll.rows) {
    if (r.error) { log(`  ⚠  ${r.name.padEnd(24)} ${r.error}`); continue; }
    log(`  ${dot(r.health)} ${r.brand.slice(0, 24).padEnd(24)} ${String(r.health ?? '—').padStart(6)} ${String(r.auditScore ?? '—').padStart(6)} ${String(r.progressScore ?? '—').padStart(5)} ${String(r.taskStats.queued).padStart(7)} ${String(r.taskStats.deployed).padStart(4)} ${String(r.taskStats.rolledBack).padStart(3)}`);
  }
  const x = roll.crossDomain;
  log(`\n  Cross-domain: ${x.totalOwnedDomains} owned domains · ${x.bindingCandidates} shared-root binding candidate(s).`);
  const dir = join(ROOT, 'seo-bot', 'reports', '_portfolio');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'portfolio.md'), renderMd(roll));
  writeFileSync(join(dir, 'portfolio.json'), JSON.stringify(roll, null, 2));
  log(`\n  → ${join(dir, 'portfolio.md')}\n`);
  return roll;
}
