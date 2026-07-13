// seo-bot · escalate — BIG issues → the C-suite Slack channel, so nobody has to poll the
// dashboard to learn something broke. This is the severity lane ABOVE the approvals mirror:
// run failures, guardrail trips, dead capture lanes, expired tokens — the events a founder
// should hear about within the day, not discover on a weekly click-through.
//
// Design rules (same family as notify.mjs):
//   - PURE builders + injectable transport/clock/state — tested without network or disk.
//   - NEVER throws into a caller; escalation is a mirror, not a gate.
//   - 24h DEDUPE per (area+title): a flapping issue posts once a day, not once a minute.
//   - severity 'critical' | 'warning' | 'info' — all route to the C-suite channel (the user's
//     explicit ask); the emoji + wording carry the weight. Approvals traffic stays in its own lane.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { ROOT } from './config.mjs';
import { notifyTargets, postSlack } from './notify.mjs';

const STATE_FILE = join(ROOT, 'reports', '_escalations', 'state.json');
export const DEDUPE_MS = 24 * 3600 * 1000;

const trunc = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

/** PURE: stable identity of an issue — area+title, NOT detail (detail carries timestamps/log
 *  tails that would defeat the dedupe). */
export function issueKey(e = {}) {
  return createHash('sha256').update(`${e.area || 'engine'}|${e.title || ''}`).digest('hex').slice(0, 16);
}

/** PURE: has this issue been quiet long enough to post again? */
export function shouldSend(state = {}, key, nowMs, dedupeMs = DEDUPE_MS) {
  const last = state[key] && state[key].lastSentAt ? Date.parse(state[key].lastSentAt) : 0;
  return !(last && nowMs - last < dedupeMs);
}

const SEV = {
  critical: { emoji: '🚨', label: 'CRITICAL' },
  warning: { emoji: '⚠️', label: 'warning' },
  info: { emoji: 'ℹ️', label: 'info' },
};

/** PURE: one issue → the Slack message a founder reads in 5 seconds. */
export function buildIssueMessage({ severity = 'warning', area = 'engine', title, detail = '', link = null, client = null, host = null, at = null } = {}) {
  if (!title) return null;
  const sev = SEV[severity] || SEV.warning;
  const meta = [`severity: *${sev.label}*`, `area: \`${area}\``];
  if (client) meta.push(`client: \`${client}\``);
  if (host) meta.push(`host: \`${host}\``);
  if (at) meta.push(at);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `${sev.emoji} ${trunc(title, 140)}`, emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: meta.join(' · ') }] },
  ];
  if (detail) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: trunc(detail, 800) } });
  if (link) blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open', emoji: true }, url: link, action_id: 'open-issue' }] });
  return { text: `${sev.emoji} [${sev.label}] ${title}`, blocks };
}

function readState(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } }

/** Escalate one issue to the C-suite channel. cfg may be null (host-level issues have no client).
 *  Returns { delivered, note? } — NEVER throws. */
export async function escalate(cfg, event = {}, { log = () => {}, env = process.env, send = postSlack, now = Date.now, stateFile = STATE_FILE } = {}) {
  try {
    const t = notifyTargets(cfg || {}, env);
    const target = { botToken: t.botToken, channel: t.channels.csuite, webhook: t.webhook };
    if (!(target.botToken && target.channel) && !target.webhook) {
      return { delivered: false, note: 'no slack transport (set SLACK_BOT_TOKEN + SEO_BOT_SLACK_CHANNEL_CSUITE, or SEO_BOT_SLACK_WEBHOOK)' };
    }
    const ev = { host: hostname(), client: cfg?.name || event.client || null, ...event };
    const payload = buildIssueMessage(ev);
    if (!payload) return { delivered: false, note: 'no title' };
    const state = readState(stateFile);
    const key = issueKey(ev);
    if (!shouldSend(state, key, now())) { log(`  escalate: deduped (24h) — ${ev.title}`); return { delivered: false, note: 'deduped (24h)' }; }
    const r = await send(target, payload);
    if (r.delivered) {
      try { state[key] = { lastSentAt: new Date(now()).toISOString(), title: ev.title, severity: ev.severity || 'warning' }; mkdirSync(dirname(stateFile), { recursive: true }); writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch { /* state is best-effort */ }
    }
    log(`  escalate: ${r.delivered ? `sent → C-suite (${ev.severity || 'warning'}: ${trunc(ev.title, 80)})` : `NOT delivered (${r.note})`}`);
    return r;
  } catch (e) { return { delivered: false, note: String(e && e.message || e).slice(0, 120) }; }
}

/** PURE: judge one capture lane's health from its cooldown stamp + newest capture time.
 *  A lane is an ISSUE only when it is BOTH cooled-down/stale AND quiet for >staleHours. */
export function judgeLane({ name, lastCaptureMs = null, cooldownMs = null, nowMs, staleHours = 24 } = {}) {
  const staleMs = staleHours * 3600 * 1000;
  const quiet = lastCaptureMs == null || nowMs - lastCaptureMs > staleMs;
  if (!quiet) return { name, ok: true, note: 'capturing' };
  const cooled = cooldownMs != null && nowMs - cooldownMs < staleMs;
  return {
    name, ok: false,
    note: lastCaptureMs == null
      ? 'no captures on record'
      : `no captures for ${Math.round((nowMs - lastCaptureMs) / 3600000)}h${cooled ? ' (cooldown re-stamping — likely capped/blocked)' : ''}`,
  };
}
