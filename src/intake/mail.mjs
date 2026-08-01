// seo-bot · intake/mail — the Gmail CATCH-ALL lane (seenaiseo@gmail.com on the Mini).
//
// The deterministic handoffs ride their APIs (GSC grants → sites.list, GitHub invites →
// repository_invitations). This lane reads THE MAILBOX ITSELF for everything else a dev
// might send the agency address — Vercel/hosting invites, credentials handoffs, "site's
// live" notes — and SURFACES them to the C-suite Slack channel. It never clicks a link,
// never replies, never marks anything read:
//   - IMAP EXAMINE (read-only select) + BODY.PEEK (no \Seen flag) — the mailbox is untouched
//   - headers only (From/Subject/Date) — no bodies pulled, no links to click
//   - a UID cursor (reports/_intake/mail-cursor.json) so each message is reported ONCE
// Credential: a Gmail APP PASSWORD (2-Step Verification → App passwords) stored AES-256-GCM
// encrypted at secrets/_intake.gmail.json (same at-rest posture as the Google OAuth tokens).
// No OAuth here BY DESIGN: gmail.readonly is a Google RESTRICTED scope — production apps need
// a weeks-long verification; an app password is instant and revocable from the account page.

import { connect as tlsConnect } from 'node:tls';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { ROOT } from '../config.mjs';

const CRED_FILE = join(ROOT, 'secrets', '_intake.gmail.json');
const CURSOR_FILE = join(ROOT, 'reports', '_intake', 'mail-cursor.json');

// ── credential store (AES-256-GCM under SEO_BOT_SECRET_KEY, like connect/google.mjs) ──
function encKey(env = process.env) { const s = env.SEO_BOT_SECRET_KEY; return s ? scryptSync(s, 'seo-bot-intake-gmail', 32) : null; }
export function saveGmailCreds({ user, appPassword }, { env = process.env, file = CRED_FILE } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const key = encKey(env);
  let payload = { user, appPassword };
  if (key) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]); payload = { enc: true, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }; }
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return { ok: true, file, encrypted: !!key };
}
export function loadGmailCreds({ env = process.env, file = CRED_FILE } = {}) {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw.enc) return raw;
    const key = encKey(env); if (!key) throw new Error('gmail creds encrypted but SEO_BOT_SECRET_KEY unset');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64')); d.setAuthTag(Buffer.from(raw.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]).toString('utf8'));
  } catch { return null; }
}

// ── minimal IMAP (the 5 commands we need, promises over one TLS socket) ──
export function imapDate(d = new Date()) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()}-${M[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function imapSession({ host = 'imap.gmail.com', port = 993, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({ host, port, servername: host }, () => { /* wait for greeting */ });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error('imap timeout')); });
    let buf = '';
    let seq = 0;
    let pending = null; // { tag, resolve, reject, data }
    let greeted = false;
    const greeting = { resolve: null };
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!greeted) {
        if (buf.includes('\r\n')) { greeted = true; buf = ''; greeting.resolve && greeting.resolve(); }
        return;
      }
      if (!pending) return;
      // a command is complete when its tagged line arrives at a line start
      const tagLine = new RegExp(`(^|\\r\\n)${pending.tag} (OK|NO|BAD)([^\\r\\n]*)`, 'm').exec(buf);
      if (tagLine) {
        const all = buf; buf = '';
        const p = pending; pending = null;
        if (tagLine[2] === 'OK') p.resolve(all);
        else p.reject(new Error(`imap ${p.tag} ${tagLine[2]}${tagLine[3] || ''}`.trim()));
      }
    });
    sock.on('error', (e) => { if (pending) pending.reject(e); reject(e); });
    const cmd = (line) => new Promise((res, rej) => {
      const tag = `a${++seq}`;
      pending = { tag, resolve: res, reject: rej };
      sock.write(`${tag} ${line}\r\n`);
    });
    greeting.resolve = () => resolve({ cmd, end: () => { try { sock.end(); } catch { /* */ } } });
  });
}

const imapQuote = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** PURE: parse an IMAP FETCH response into [{uid, from, subject, date}]. Tolerant of literals. */
export function parseFetchHeaders(raw = '') {
  const out = [];
  // Each message block: "* N FETCH (UID 123 BODY[...] {len}\r\n<headers>\r\n)" — split on FETCH markers.
  const parts = String(raw).split(/\*\s+\d+\s+FETCH\s+\(/).slice(1);
  for (const part of parts) {
    const uid = Number((/UID (\d+)/.exec(part) || [])[1]) || null;
    const from = (/^From:\s*([^\r\n]+)/im.exec(part) || [])[1] || '';
    const subject = (/^Subject:\s*([^\r\n]+)/im.exec(part) || [])[1] || '';
    const date = (/^Date:\s*([^\r\n]+)/im.exec(part) || [])[1] || '';
    if (uid) out.push({ uid, from: from.trim(), subject: decodeMimeWords(subject.trim()), date: date.trim() });
  }
  return out;
}

/** PURE: decode the common =?UTF-8?B/Q?…?= encoded-word subjects (best-effort). */
export function decodeMimeWords(s = '') {
  return String(s).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      return Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
    } catch { return data; }
  }).trim();
}

/** Fetch new message headers since the cursor (default transport; injectable in tests). */
export async function fetchNewHeaders({ user, appPassword, sinceDays = 7, lastUid = 0 } = {}) {
  const s = await imapSession();
  try {
    await s.cmd(`LOGIN ${imapQuote(user)} ${imapQuote(appPassword)}`);
    await s.cmd('EXAMINE INBOX'); // read-only: flags can never change
    const since = imapDate(new Date(Date.now() - sinceDays * 86400000));
    const searchRaw = await s.cmd(`UID SEARCH SINCE ${since}`);
    const uids = ((/\* SEARCH ([^\r\n]*)/.exec(searchRaw) || [])[1] || '').split(/\s+/).map(Number).filter((u) => u > lastUid);
    if (!uids.length) return [];
    const batch = uids.slice(-80); // bound one pass; the cursor advances, the rest come next tick
    const raw = await s.cmd(`UID FETCH ${batch.join(',')} (BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])`);
    return parseFetchHeaders(raw);
  } finally { try { await s.cmd('LOGOUT').catch(() => {}); } catch { /* */ } s.end(); }
}

// ── classification: what deserves founder eyes ──
const CRED_RE = /password|credential|passcode|2fa|verification code|api key|secret/i;
const ACCESS_RE = /invit(e|ation)|access|added you|collaborat|shared with you|transfer|handoff|admin|ownership|joined|granted|new site|site is live|launch/i;

/** PURE: route one email header. Deterministic lanes are noted (their APIs act); the rest
 *  either surfaces to C-suite (access-ish) or stays quiet (newsletters etc.). */
export function classifyEmail({ from = '', subject = '' } = {}) {
  const f = from.toLowerCase(), s = subject.toLowerCase();
  if (f.includes('github.com') && /invit/.test(s)) return { kind: 'github-invite', act: 'note' }; // API lane accepts it
  if (f.includes('sc-noreply@google.com') || /search console/.test(s)) return { kind: 'gsc-grant', act: 'note' }; // sites.list lane onboards it
  if (CRED_RE.test(s)) return { kind: 'credential-handoff', act: 'escalate', severity: 'warning' };
  if (ACCESS_RE.test(s)) return { kind: 'access-handoff', act: 'escalate', severity: 'info' };
  return { kind: 'other', act: 'ignore' };
}

function readCursor(file) { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { lastUid: 0 }; } }

/** The mail lane: new headers → classify → surface access/credential handoffs to C-suite. */
export async function intakeMail({ log = () => {}, env = process.env, deps = {} } = {}) {
  const {
    credsFn = () => loadGmailCreds({ env }),
    fetchFn = fetchNewHeaders,
    escalateFn = null,
    cursorFile = CURSOR_FILE,
  } = deps;
  const creds = credsFn();
  if (!creds?.user || !creds?.appPassword) {
    return { ok: false, note: 'gmail not configured — run `seo-bot intake gmail --app-password "…"` (Google account → 2-Step Verification → App passwords)' };
  }
  const cur = readCursor(cursorFile);
  let headers;
  try { headers = await fetchFn({ user: creds.user, appPassword: creds.appPassword, lastUid: cur.lastUid || 0 }); }
  catch (e) { return { ok: false, note: `imap failed: ${String(e && e.message || e).slice(0, 140)}` }; }
  const esc = escalateFn || (await import('../escalate.mjs')).escalate;
  const results = [];
  let maxUid = cur.lastUid || 0;
  for (const h of headers) {
    maxUid = Math.max(maxUid, h.uid);
    const c = classifyEmail(h);
    results.push({ uid: h.uid, kind: c.kind, act: c.act, subject: h.subject });
    if (c.act === 'escalate') {
      await esc(null, {
        severity: c.severity, area: 'intake-mail',
        title: `📥 ${h.subject || '(no subject)'}`.slice(0, 140),
        detail: `To the agency inbox from ${h.from || 'unknown sender'} (${h.date}). Kind: ${c.kind}. The bot NEVER clicks email links — open Gmail to act; deterministic handoffs (GSC grants, GitHub invites) are handled by their API lanes automatically.`,
      }, { log });
    }
  }
  try { mkdirSync(dirname(cursorFile), { recursive: true }); writeFileSync(cursorFile, JSON.stringify({ lastUid: maxUid, at: new Date().toISOString() }, null, 2)); } catch { /* cursor is best-effort */ }
  const escN = results.filter((r) => r.act === 'escalate').length;
  log(`  intake/mail: ${headers.length} new message(s) · ${escN} surfaced to C-suite · cursor → ${maxUid}`);
  return { ok: true, checked: headers.length, surfaced: escN, results };
}
