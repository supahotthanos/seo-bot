// seo-bot · content/decay — the content-decay → refresh loop (the highest-ROI maintenance
// lever, and a gap the whole industry flags-but-never-executes). Diffs GSC clicks over the
// last 90 days vs the prior 90, flags pages with a real click drop + real residual demand,
// ranks them by severity × recovery-ceiling × business value, and emits a refresh queue
// that DEMANDS a real content delta (date-only bumps are veto-listed). Reuses gsc.mjs's
// two-window pull; the scoring is pure + unit-tested.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';

const norm = (u) => (u || '').replace(/\/$/, '');
const MONEY_RE = /\/(treatment|service|services|cost|best|botox|filler|morpheus|hydrafacial|coolsculpt|laser|microneedl|location|[a-z-]+-[a-z]{2})\b/i;

/** Pure decay scorer over two GSC page-window arrays ([{keys:[url],clicks,impressions,position}]).
 *  Flags pages with >=minDrop click loss AND >=minImpr residual demand; ranks by severity. */
export function scoreDecay(recentPages = [], priorPages = [], { minDrop = 0.2, minImpr = 100 } = {}) {
  const prior = new Map(priorPages.map((p) => [norm(p.keys?.[0]), p]));
  const out = [];
  for (const r of recentPages) {
    const page = norm(r.keys?.[0]);
    const p0 = prior.get(page);
    if (!p0 || (p0.clicks || 0) <= 0) continue;
    const imprNow = r.impressions || 0;
    if (imprNow < minImpr) continue; // need real residual demand to be worth a refresh
    const drop = ((p0.clicks || 0) - (r.clicks || 0)) / (p0.clicks || 1);
    if (drop < minDrop) continue;
    const money = MONEY_RE.test(page) ? 1.5 : 1;
    // severity = drop magnitude × recovery ceiling (log impressions) × business value
    const score = drop * Math.log10(imprNow + 1) * money;
    out.push({ page, clicksNow: r.clicks || 0, clicksPrev: p0.clicks || 0, dropPct: Math.round(drop * 100), impressions: imprNow, positionNow: r.position ? Math.round(r.position * 10) / 10 : null, money: money > 1, score: Math.round(score * 1000) / 1000 });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function detectDecay(cfg, { log = () => {} } = {}) {
  const { pullGSC } = await import('../gsc.mjs');
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const recent = await pullGSC(cfg, { log, range: { startDate: day(90), endDate: day(1) } });
  if (!recent.enabled) return { enabled: false, note: recent.note };
  const prior = await pullGSC(cfg, { log, range: { startDate: day(180), endDate: day(91) } });
  if (!prior.enabled) return { enabled: false, note: prior.note };

  const decayed = scoreDecay(recent.pages || [], prior.pages || []);
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const L = [`# Content-decay refresh queue — ${cfg.brand}`, `last 90d vs prior 90d · ${decayed.length} decaying pages · ${nowIso()}`, '',
    '> Refresh with a REAL content delta (new data/sections/answers) — a date-only bump is veto-listed and backfires.', '',
    '| # | Page | Clicks (90d→prev) | Drop | Impr | Pos | Money |', '|---|---|---|---|---|---|---|'];
  decayed.slice(0, 40).forEach((d, i) => L.push(`| ${i + 1} | ${d.page} | ${d.clicksNow}←${d.clicksPrev} | ${d.dropPct}% | ${d.impressions} | ${d.positionNow ?? '—'} | ${d.money ? '💰' : ''} |`));
  writeFileSync(join(dir, 'decay.md'), L.join('\n'));
  writeFileSync(join(dir, 'decay.json'), JSON.stringify({ client: cfg.name, ranAt: nowIso(), decayed }, null, 2));
  log(`\n  Decay: ${decayed.length} pages losing clicks with residual demand`);
  if (decayed.length) log(`  Top: ${decayed[0].page} (${decayed[0].dropPct}% drop, ${decayed[0].impressions} impr)`);
  log(`  → ${join(dir, 'decay.md')}\n`);
  return { enabled: true, decayed };
}
