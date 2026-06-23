// seo-bot · measure — run AI-visibility tracking per client by driving the existing
// scripts/ai-visibility/track.mjs with a config generated from this client. Captures
// Visibility / Position / Cited% across Perplexity / Google AIO / ChatGPT. Best-effort
// (engines bot-block; needs Playwright chromium + ideally a residential IP).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';

export async function measure(cfg, { log = () => {}, headful = false } = {}) {
  const dir = join(ROOT, 'seo-bot', 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const promptsFile = join(dir, 'ai-prompts.json');
  const prompts = (cfg.promptPanel || []).map((s) => s.replaceAll('{brand}', cfg.brand)).filter((s) => !/\{.*\}/.test(s));
  if (!prompts.length) { log('  measure: no usable promptPanel entries (after placeholder filtering). Skipping.'); return { ok: false, skipped: true }; }

  writeFileSync(promptsFile, JSON.stringify({
    brand: cfg.brand, aliases: cfg.aliases, domain: cfg.domain, competitors: cfg.competitors,
    engines: cfg.engines,
    location: cfg.location || cfg.geo?.city || cfg.locations?.[0]?.nap?.city || null, // → track.mjs uule geo-pin
    prompts,
    settings: { outDir: `seo-bot/reports/${cfg.name}/ai-visibility`, headful, delayMs: 4000, timeoutMs: 45000 },
  }, null, 2));

  const track = join(ROOT, 'scripts', 'ai-visibility', 'track.mjs');
  log(`  measure: running track.mjs over ${prompts.length} prompts × ${(cfg.engines || []).join(', ')} …`);
  try {
    // Hard watchdog: a hung browser must NOT freeze the weekly cron forever (kill after 20 min).
    execFileSync('node', [track], { cwd: ROOT, env: { ...process.env, PROMPTS: promptsFile, ...(headful ? { HEADFUL: '1' } : {}) }, stdio: 'inherit', timeout: 20 * 60 * 1000, killSignal: 'SIGKILL' });
    return { ok: true, promptsFile };
  } catch (e) {
    const killed = e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT';
    log(`  measure ${killed ? 'TIMED OUT (20m watchdog killed a hung tracker)' : 'skipped/failed (likely missing chromium or bot-blocked)'}: ${String(e.message || e).slice(0, 160)}`);
    if (!killed) log(`    one-time setup: npx playwright install chromium`);
    return { ok: false, error: String(e.message || e), timedOut: killed };
  }
}
