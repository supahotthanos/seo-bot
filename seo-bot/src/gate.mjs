// seo-bot · gate — pre-deploy SEO REGRESSION gate (steal: SiteOne Crawler --ci exit 10,
// Lumar Protect). For a directory shipping thousands of pages, the catastrophic failure is
// a PR that silently noindexes the site, flips canonicals, or shrinks the sitemap. This
// crawls the (preview) build, scores it, and FAILS CI (exit code 10) when the score drops
// below a floor, criticals exceed a cap, OR criticals INCREASE vs the last green baseline.
// Drop it into a Vercel predeploy / GitHub Action. Closes the template-CWV + index-
// discipline enforcement gaps (it's the teeth on scoring we already compute).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

export const GATE_EXIT = 10; // reserved non-1 exit so CI can distinguish a gate fail from a crash

/** Pure gate decision over an audit summary + thresholds + last-green baseline. */
export function gateVerdict({ score = 0, bySeverity = {} } = {}, g = {}, baseline = null) {
  const minScore = g.minScore ?? 70, maxCritical = g.maxCritical ?? 0, maxHigh = g.maxHigh ?? null, maxScoreDrop = g.maxScoreDrop ?? 5;
  const crit = bySeverity.critical || 0, high = bySeverity.high || 0;
  const fails = [];
  if (score < minScore) fails.push(`score ${score} < floor ${minScore}`);
  if (crit > maxCritical) fails.push(`${crit} critical > cap ${maxCritical}`);
  if (maxHigh != null && high > maxHigh) fails.push(`${high} high > cap ${maxHigh}`);
  if (baseline) {
    if (crit > (baseline.critical || 0)) fails.push(`criticals regressed ${baseline.critical || 0}→${crit} vs baseline`);
    if (score < (baseline.score || 0) - maxScoreDrop) fails.push(`score regressed ${baseline.score}→${score} (> ${maxScoreDrop} drop)`);
  }
  return { passed: fails.length === 0, fails, exitCode: fails.length === 0 ? 0 : GATE_EXIT };
}

export async function ciGate(cfg, { log = () => {} } = {}) {
  const g = cfg.gate || {};
  const { runAudit } = await import('./audit.mjs');
  const r = await runAudit(cfg, { log });
  const sev = r.bySeverity || {};
  const crit = sev.critical || 0, high = sev.high || 0;

  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const basePath = join(dir, 'gate-baseline.json');
  const baseline = existsSync(basePath) ? (() => { try { return JSON.parse(readFileSync(basePath, 'utf-8')); } catch { return null; } })() : null;

  const { passed, fails } = gateVerdict({ score: r.score, bySeverity: sev }, g, baseline);
  // Only advance the green baseline on a PASS (never bless a regression).
  if (passed) writeFileSync(basePath, JSON.stringify({ score: r.score, critical: crit, high, ranAt: nowIso() }, null, 2));

  log(passed
    ? `  ✅ SEO gate PASS — score ${r.score}/100 · 🔴 ${crit} · 🟠 ${high}${baseline ? ` (baseline ${baseline.score})` : ''}`
    : `  ❌ SEO gate FAIL (exit ${GATE_EXIT}):\n    - ${fails.join('\n    - ')}`);
  return { passed, exitCode: passed ? 0 : GATE_EXIT, score: r.score, bySeverity: sev, fails, baseline };
}
