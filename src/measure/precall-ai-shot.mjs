// seo-bot · measure/precall-ai-shot — ONE live ChatGPT answer screenshot for the prospect deck.
//
// The single highest-impact visual in an AEO pitch: the prospect's own market asked live,
// with the answer (and their absence from it) on screen. One prompt, one temporary chat,
// ~1 extra message against the same account budget the panel sampler already spends.
//
// EVERY gate fails soft to null — the deck renders exactly as it does today without the shot:
//   * SEO_BOT_PRECALL_AI_SHOT=0 kill switch
//   * no SEO_BOT_CDP_ENDPOINT (this shot is only worth taking from the LOGGED-IN capture Chrome)
//   * CDP endpoint unreachable — CRITICAL: launchBrowser silently falls back to launching a
//     fresh logged-OUT Chromium when the endpoint is down, which would hand us a login-wall
//     screenshot; we verify /json/version answers BEFORE any capture is attempted
//   * capture paused for chatgpt (capture-pause.json), or in challenge cooldown
//   * no answer / wall / over-cap image
//
// The screenshot itself is taken inside captureOnPage (fanout-capture.mjs, screenshotAfter):
// clipped to the conversation column only, never the sidebar (client chat titles live there).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { captureFanout } from './fanout-capture.mjs';
import { inCooldown } from './capture-governor.mjs';

export const AI_SHOT_CAP = 110 * 1024; // raw JPEG bytes — coordinated with prospect-audit SHOT_CAPS

function pausedForChatgpt(root) {
  try {
    const f = join(root, 'capture-pause.json');
    if (!existsSync(f)) return false;
    const j = JSON.parse(readFileSync(f, 'utf-8'));
    const scopes = Array.isArray(j.scopes) ? j.scopes : (j.scope ? [j.scope] : []);
    const until = j.until ? Date.parse(j.until) : null;
    const active = until == null || (Number.isFinite(until) && until > Date.now());
    return active && (scopes.includes('chatgpt') || scopes.includes('all') || j.all === true);
  } catch { return false; }
}

function lastChallengeAt(root) {
  try {
    const f = join(root, '_prospects', '.cooldown');
    if (!existsSync(f)) return null;
    const t = Date.parse(String(readFileSync(f, 'utf-8')).trim());
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

async function cdpAlive(endpoint) {
  try {
    const base = String(endpoint).replace(/^ws/, 'http').replace(/\/devtools.*$/, '').replace(/\/$/, '');
    const r = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch { return false; }
}

/** Capture one "best med spa in {city}" ChatGPT answer as a JPEG data URI, or null.
 *  Returns { dataUri, prompt, named } — `named` is whether the prospect appears in the answer,
 *  so the deck caption can be honest either way. */
export async function captureAiAnswerShot({ city, brand, domain, root = ROOT, log = () => {} } = {}) {
  if (process.env.SEO_BOT_PRECALL_AI_SHOT === '0') return null;
  if (!city) return null;
  const ep = process.env.SEO_BOT_CDP_ENDPOINT;
  if (!ep) { log('  prospect: ai-shot skipped (no CDP endpoint — logged-in Chrome only)'); return null; }
  if (!(await cdpAlive(ep))) { log('  prospect: ai-shot skipped (CDP endpoint down — refusing the logged-out fallback)'); return null; }
  if (pausedForChatgpt(root)) { log('  prospect: ai-shot skipped (chatgpt capture paused)'); return null; }
  if (inCooldown(lastChallengeAt(root), Date.now())) { log('  prospect: ai-shot skipped (challenge cooldown)'); return null; }

  const prompt = `best med spa in ${city}`;
  try {
    const rec = await captureFanout(prompt, { engine: 'chatgpt', screenshotAfter: true, minAnswerMs: 8000 });
    if (!rec || rec.status !== 'ok' || !rec.shotJpeg) {
      log(`  prospect: ai-shot not captured (${(rec && rec.status) || 'no rec'})`);
      return null;
    }
    const rawLen = Math.floor(rec.shotJpeg.length * 0.75); // base64 → raw byte estimate
    if (rawLen > AI_SHOT_CAP) { log(`  prospect: ai-shot over cap (${Math.round(rawLen / 1024)}KB > ${Math.round(AI_SHOT_CAP / 1024)}KB) — dropped`); return null; }
    const hay = `${rec.answer || ''}`.toLowerCase();
    const named = Boolean(
      (domain && hay.includes(String(domain).toLowerCase().replace(/^www\./, ''))) ||
      (brand && brand.length >= 5 && hay.includes(String(brand).toLowerCase())),
    );
    log(`  prospect: ai-shot captured (${Math.round(rawLen / 1024)}KB · ${named ? 'prospect NAMED in answer' : 'prospect absent'})`);
    return { dataUri: `data:image/jpeg;base64,${rec.shotJpeg}`, prompt, named };
  } catch (e) {
    log(`  prospect: ai-shot failed (${String((e && e.message) || e).slice(0, 80)})`);
    return null;
  }
}
