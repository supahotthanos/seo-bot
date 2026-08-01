// seo-bot · measure/precall-panel-sampler — the on-demand "check their city and run that
// first" burst (Shubh 2026-07-24). When a lead's site reveals its metro, live-sample the
// AI-answer panel for THAT city on this seat's logged-in capture Chrome so the pre-call
// deck claims a number measured for the lead's own market — never a global "0/19" prop.
//
// Governed + fail-soft, same contract as the accrual lanes:
//   * skips cleanly with no CDP seat (SEO_BOT_CDP_ENDPOINT), under the committed
//     capture-pause switch (config/capture-pause.json scope "chatgpt"), or when the metro
//     already has fresh coverage (≥8 ok answers within 14 days anywhere in the accrual);
//   * the burst is a capped slice of the CANONICAL money intents (best/botox) for one city,
//     written to reports/query-bank/_prospects (panelLookup scans it like any other dir);
//   * captureFanoutBatch's wall detection + the _prospects cooldown file apply as everywhere
//     else — a walled session halts the burst, and the deck falls back to the honest
//     "not sampled yet" callout. A sampler failure must never fail the audit.
//
// Kill switch: SEO_BOT_PRECALL_LIVE_PANEL=0. Tuning: SEO_BOT_PRECALL_PANEL_MAX (default 10),
// SEO_BOT_PRECALL_PANEL_CONC (default 2).

import { join } from 'node:path';
import * as fsMod from 'node:fs';

export function makePrecallPanelSampler({ domain, env = process.env } = {}) {
  return async function precallPanelSampler({ city, brand, log = () => {} } = {}) {
    if (env.SEO_BOT_PRECALL_LIVE_PANEL === '0') { log('  precall-panel: disabled (SEO_BOT_PRECALL_LIVE_PANEL=0)'); return; }
    if (!env.SEO_BOT_CDP_ENDPOINT) { log('  precall-panel: no capture Chrome on this seat (SEO_BOT_CDP_ENDPOINT unset) — skipping live sample'); return; }
    const { ROOT } = await import('../config.mjs');
    try {
      const pause = JSON.parse(fsMod.readFileSync(join(ROOT, 'config', 'capture-pause.json'), 'utf8'));
      if ((pause.scopes || []).includes('chatgpt')) { log(`  precall-panel: chatgpt lanes paused (${pause.reason || 'capture-pause.json'}) — skipping`); return; }
    } catch { /* no pause file = lanes are live */ }
    const { panelLookup } = await import('../prospect-audit.mjs');
    const pre = panelLookup({ domain, brand, city, root: ROOT });
    const freshMs = 14 * 24 * 3600 * 1000;
    if (pre && (pre.citySampled || 0) >= 8 && pre.cityLastDay && (Date.now() - Date.parse(pre.cityLastDay)) < freshMs) {
      log(`  precall-panel: ${city} already covered (${pre.citySampled} answers, latest ${pre.cityLastDay}) — reusing accrual`);
      return;
    }
    const { runQueryBank } = await import('./query-bank-runner.mjs');
    const dir = join(ROOT, 'reports', 'query-bank', '_prospects');
    fsMod.mkdirSync(dir, { recursive: true });
    // Reset the burst cursor so every city starts at the top of the bank — the canonical
    // "best/botox in {city}" prompts are the highest-value cells and must land first.
    try { fsMod.writeFileSync(join(dir, '.cursor'), '0'); } catch { /* preference, not a gate */ }
    log(`  precall-panel: live-sampling ${city} (canonical intents, capped burst)…`);
    const r = await runQueryBank({ brand }, {
      overrides: { cities: [city], queries: ['best', 'botox'], tiers: ['low'] },
      concurrency: Math.max(1, Number(env.SEO_BOT_PRECALL_PANEL_CONC || 2)),
      maxPerRun: Math.max(1, Number(env.SEO_BOT_PRECALL_PANEL_MAX || 10)),
      fs: fsMod, dir, log,
    });
    log(`  precall-panel: ${r.captured || 0} captured${r.halted ? ' — halted by governor' : ''}${r.cooling ? ' — in cooldown' : ''}`);
  };
}
