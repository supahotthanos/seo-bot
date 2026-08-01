// seo-bot · measure/capture-pause — ONE committed file stands the capture lanes down,
// fleet-wide. Purpose (Shubh 2026-07-20, becoming a two-seat operation — laptop in Canada +
// Mini at home): both seats spend the SAME ChatGPT account cap, and the per-machine cooldown
// files can't see each other. When the laptop becomes the active ChatGPT seat, commit
// config/capture-pause.json with {"scopes":["chatgpt"],"reason":"laptop is capturing"} —
// the Mini self-updates within a tick and its ChatGPT lanes refuse to start. Delete the file
// (commit) to resume. Scopes: 'chatgpt' | 'serp' | 'all'.
//
// FAIL-CLOSED: an unparseable/off-shape pause file pauses EVERYTHING — ambiguity never spends
// account budget. An absent file is the normal running state.

import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const SCOPES = ['chatgpt', 'serp', 'all'];

/** PURE: parse pause-file text. Malformed → all-paused (fail closed). */
export function parsePause(text) {
  let j = null;
  try { j = JSON.parse(text); } catch { return { paused: true, scopes: ['all'], reason: 'unparseable pause file (fail closed)' }; }
  if (!j || typeof j !== 'object' || !Array.isArray(j.scopes)) return { paused: true, scopes: ['all'], reason: 'off-shape pause file (fail closed)' };
  const scopes = j.scopes.map(String);
  // A typo'd scope must never silently RESUME a lane the operator meant to stop.
  if (scopes.some((s) => !SCOPES.includes(s))) return { paused: true, scopes: ['all'], reason: 'unknown scope in pause file (fail closed)' };
  return { paused: scopes.length > 0, scopes, reason: String(j.reason || '') }; // explicit [] = deliberate resume marker
}

/** Is `lane` ('chatgpt' | 'serp') paused right now? Absent file → no. `fsi` injectable. */
export function capturePaused(lane, { root, fsi = { readFileSync, existsSync } } = {}) {
  if (!root) return { paused: false };
  const f = join(root, 'config', 'capture-pause.json');
  if (!fsi.existsSync(f)) return { paused: false };
  const p = parsePause(fsi.readFileSync(f, 'utf8'));
  if (!p.paused) return { paused: false };
  const hit = p.scopes.includes('all') || p.scopes.includes(lane);
  return hit ? { paused: true, reason: p.reason || 'config/capture-pause.json present' } : { paused: false };
}
