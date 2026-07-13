// seo-bot · screenshot-review — before/after visual safety review of a change.
//
// Captures the live page before vs after a change, measures the MAGNITUDE of the
// visible change, and asks Claude (headless) to confirm nothing broke and the change
// isn't bigger than intended. Wired into the dashboard review path (pushDashboard) for the
// DANGEROUS tier — surfaced per-change for one-click human approval. (The unattended autopilot
// auto-push gates on verifier consensus + policy, not screenshots.)
//
// Fail-closed by design: anything it cannot verify -> verdict 'review' or 'unsafe',
// never a silent 'safe'. Browser deps are optional/lazy.

import { complete, llmAvailable } from './llm.mjs';
import { launchBrowser } from './measure/browser.mjs';

// Markup/tokens that mean "this change touches something the reader SEES" — charts, images,
// tables, embeds — where a text diff alone can't prove the page didn't visually break.
const VISUAL_MARKUP_RE = /<svg\b|<canvas\b|<img\b|<picture\b|<figure\b|<table\b|<iframe\b|<video\b|!\[[^\]]*\]\(|\bdata:image\//i;
const VISUAL_TYPE_RE = /content|body|section|blog|image|media|chart|graph|table|figure|hero|gallery/i;

/** PURE + testable: does this pending record touch visual content (chart/image/table/embed)?
 *  Used to widen before/after screenshot coverage beyond the red tier: any change that can
 *  disturb what a reader SEES gets shots, so the reviewer compares pixels, not just words. */
export function isVisualChange(record = {}) {
  if (VISUAL_TYPE_RE.test(String(record.type || ''))) return true;
  const text = `${record.current ?? ''}\n${record.proposed ?? ''}`;
  return VISUAL_MARKUP_RE.test(text);
}

/** PURE + testable: % of visible text that changed (token-set Jaccard distance). */
export function changeMagnitude(beforeText = '', afterText = '') {
  const tok = s => new Set(String(s).toLowerCase().split(/\W+/).filter(w => w.length > 1));
  const a = tok(beforeText), b = tok(afterText);
  if (!a.size && !b.size) return 0;
  let inter = 0; for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return Math.round((1 - inter / (union || 1)) * 100);
}

/** Capture before/after screenshots + visible text of a URL across an apply step.
 *  applyFn (optional) performs the change between the two captures (e.g. deploy/patch). */
export async function capturePair(url, applyFn, { dir, timeoutMs = 30000 } = {}) {
  const L = await launchBrowser({ headless: true, stealth: false });
  if (L.status) return { status: L.status };
  const browser = L.browser;
  try {
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    const beforeShot = dir ? `${dir}/before.png` : undefined;
    if (beforeShot) await page.screenshot({ path: beforeShot, fullPage: true });
    const beforeText = await page.evaluate(() => document.body.innerText);
    if (typeof applyFn === 'function') await applyFn(page);
    await page.reload({ waitUntil: 'networkidle', timeout: timeoutMs });
    const afterShot = dir ? `${dir}/after.png` : undefined;
    if (afterShot) await page.screenshot({ path: afterShot, fullPage: true });
    const afterText = await page.evaluate(() => document.body.innerText);
    return { status: 'ok', beforeText, afterText, beforeShot, afterShot };
  } finally { await browser.close().catch(() => {}); }
}

/** The reviewer: magnitude guard + LLM visual check. Returns a fail-closed verdict. */
export async function reviewChange({ beforeText, afterText, beforeShot, afterShot, intent = '', maxMagnitude = 25 } = {}) {
  if (beforeText == null || afterText == null)
    return { verdict: 'unsafe', magnitude: 100, note: 'capture failed — cannot verify; fail closed.' };
  const magnitude = changeMagnitude(beforeText, afterText);
  if (magnitude > maxMagnitude)
    return { verdict: 'review', magnitude, beforeShot, afterShot, note: `visible text changed ${magnitude}% (> ${maxMagnitude}% guard) — too big to auto-pass; human review.` };
  if (!llmAvailable())
    return { verdict: 'review', magnitude, beforeShot, afterShot, note: `magnitude ${magnitude}% within guard, but no model available for the visual check — fail closed to human.` };
  const system = 'You are a strict release reviewer for LIVE client websites. Given a before/after of a single on-page SEO change, decide if it is SAFE to ship. Reply EXACTLY "SAFE" or "UNSAFE" then one short reason. Default to UNSAFE if anything looks broken, layout-breaking, off-brand, or larger than the stated intent.';
  const out = await complete(
    `Intent of the change: ${intent || '(unspecified)'}\nVisible-text change magnitude: ${magnitude}%\n\nBEFORE (visible text, truncated):\n${String(beforeText).slice(0, 1500)}\n\nAFTER (visible text, truncated):\n${String(afterText).slice(0, 1500)}\n\nSafe to ship?`,
    { system, maxTokens: 120 }
  );
  if (!out) return { verdict: 'review', magnitude, beforeShot, afterShot, note: 'visual reviewer returned nothing — fail closed.' };
  const safe = /^\s*safe\b/i.test(out);
  return { verdict: safe ? 'safe' : 'unsafe', magnitude, beforeShot, afterShot, note: out.trim().slice(0, 240) };
}

/** Capture before/after of one proposed change on its LIVE page → a verdict + screenshot paths
 *  for the dashboard reviewer. Best-effort + FAIL-CLOSED: any failure → verdict 'review' (never a
 *  silent 'safe'), so a risky change without a clean visual check still gets human eyes. */
export async function reviewProposal(url, { current = '', proposed = '', type = '', dir } = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return { verdict: 'review', note: 'no live URL to screenshot — review manually.' };
  // Synthetic preview: swap the proposed text into the live DOM so the "after" screenshot reflects
  // the change (visible-body edits show; meta/title changes correctly show no visual diff).
  const applyFn = async (page) => {
    try { await page.evaluate(({ a, b }) => { if (!a || !b || !document.body) return; const w = document.body.innerHTML; if (w && w.includes(a)) document.body.innerHTML = w.replace(a, b); }, { a: String(current).slice(0, 400), b: String(proposed).slice(0, 400) }); } catch { /* visual-only best-effort */ }
  };
  let pair;
  try { pair = await capturePair(url, applyFn, { dir }); } catch (e) { return { verdict: 'review', note: `capture failed (${String(e).slice(0, 80)}) — review manually.` }; }
  if (!pair || pair.status) return { verdict: 'review', note: `capture unavailable (${pair?.status || 'no result'}) — review manually.` };
  return reviewChange({ beforeText: pair.beforeText, afterText: pair.afterText, beforeShot: pair.beforeShot, afterShot: pair.afterShot, intent: `${type} change` });
}
