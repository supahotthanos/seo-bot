// seo-bot · connect/google — one-click "sign and connect" for Google.
//
// Runs the OAuth 2.0 LOOPBACK (installed-app) flow: opens the consent screen in the
// browser, the user signs in once with founders@cnai.digital and approves, and we
// store a long-lived REFRESH TOKEN per client. After that, GA4 / GSC / Business
// Profile calls mint short-lived access tokens silently — no more sign-in.
//
// One-time setup (per agency, not per client): create an OAuth client of type
// "Desktop app" in Google Cloud Console and set:
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET   (env)
//   — or seo-bot/config/google-oauth.json { "client_id": "...", "client_secret": "..." }
// Enable the Analytics Data API, Search Console API, and Business Profile API on the project.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Refresh tokens are encrypted at rest with AES-256-GCM when SEO_BOT_SECRET_KEY is set
// (recommended). Without it they fall back to plaintext (gitignored) + a warning.
function encKey() { const s = process.env.SEO_BOT_SECRET_KEY; return s ? scryptSync(s, 'seo-bot-google', 32) : null; }
function saveToken(client, obj) {
  mkdirSync(SECRETS_DIR, { recursive: true });
  const key = encKey();
  let payload = obj;
  if (key) { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]); payload = { enc: true, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }; }
  writeFileSync(tokenPath(client), JSON.stringify(payload, null, 2));
}
function loadToken(client) {
  if (!existsSync(tokenPath(client))) return null;
  const raw = JSON.parse(readFileSync(tokenPath(client), 'utf-8'));
  if (!raw.enc) return raw;
  const key = encKey(); if (!key) throw new Error('token is encrypted but SEO_BOT_SECRET_KEY is not set');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64')); d.setAuthTag(Buffer.from(raw.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]).toString('utf8'));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const SECRETS_DIR = join(__dirname, '..', '..', 'secrets');
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GOOGLE_SCOPES = {
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
  gbp: 'https://www.googleapis.com/auth/business.manage',
};

function oauthClient() {
  let id = process.env.GOOGLE_OAUTH_CLIENT_ID, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const f = join(__dirname, '..', '..', 'config', 'google-oauth.json');
  if ((!id || !secret) && existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf-8')); id = id || j.client_id; secret = secret || j.client_secret; }
  if (!id || !secret) throw new Error('Google OAuth client not configured. Set GOOGLE_OAUTH_CLIENT_ID/SECRET or seo-bot/config/google-oauth.json (one-time, type "Desktop app").');
  return { id, secret };
}

function openBrowser(url) {
  const win = process.platform === 'win32';
  const cmd = win ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = win ? ['/c', 'start', '""', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* user can paste the URL */ }
}

const tokenPath = (client) => join(SECRETS_DIR, `${client}.google.json`);

/** Interactive: open consent, capture the code on a loopback port, store the refresh token. */
export async function connectGoogle(client, { scopes = ['ga4', 'gsc', 'gbp'], log = () => {} } = {}) {
  const { id, secret } = oauthClient();
  const scopeStr = scopes.map((s) => GOOGLE_SCOPES[s] || s).join(' ');
  const state = randomBytes(16).toString('hex');
  // PKCE (S256) — Google's recommendation for installed/native apps.
  const codeVerifier = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (!u.searchParams.get('code')) { res.writeHead(204); res.end(); return; }
        if (u.searchParams.get('state') !== state) { res.writeHead(400); res.end('state mismatch'); server.close(); return reject(new Error('OAuth state mismatch')); }
        const code = u.searchParams.get('code');
        const port = server.address().port;
        const body = new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: codeVerifier });
        const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        const tok = await r.json();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body style="font-family:system-ui;text-align:center;padding-top:4rem"><h2>${r.ok ? '✅ Connected. You can close this tab.' : '❌ ' + (tok.error_description || tok.error)}</h2></body></html>`);
        server.close();
        if (!r.ok || !tok.refresh_token) return reject(new Error(`Token exchange failed: ${tok.error_description || tok.error || 'no refresh_token (revoke prior grant or use prompt=consent)'}`));
        saveToken(client, { client, refresh_token: tok.refresh_token, scopes: scopeStr, obtained_at: new Date().toISOString() });
        resolve({ ok: true, scopes: scopeStr, path: tokenPath(client), encrypted: !!encKey() });
      } catch (e) { server.close(); reject(e); }
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const authUrl = `${AUTH_URL}?${new URLSearchParams({ client_id: id, redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code', scope: scopeStr, access_type: 'offline', prompt: 'consent', state, login_hint: 'founders@cnai.digital', code_challenge: codeChallenge, code_challenge_method: 'S256' })}`;
      log(`  Opening Google sign-in… if it doesn't open, paste this URL:\n  ${authUrl}\n`);
      openBrowser(authUrl);
    });
    setTimeout(() => { try { server.close(); } catch {} reject(new Error('OAuth timed out (5 min)')); }, 300000);
  });
}

const _accessCache = new Map(); // client -> { token, exp }

/** Silent: mint a fresh access token from the stored refresh token. Returns null if not connected. */
export async function getAccessToken(client) {
  const c = _accessCache.get(client);
  if (c && c.exp > Date.now() + 60000) return c.token;
  const stored = loadToken(client);
  if (!stored?.refresh_token) return null;
  const { refresh_token } = stored;
  const { id, secret } = oauthClient();
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token, grant_type: 'refresh_token' }) });
  if (!r.ok) return null;
  const tok = await r.json();
  _accessCache.set(client, { token: tok.access_token, exp: Date.now() + (tok.expires_in || 3600) * 1000 });
  return tok.access_token;
}

export function connectionStatus(client) {
  try {
    const j = loadToken(client);
    if (!j) return { connected: false };
    return { connected: true, scopes: j.scopes, obtainedAt: j.obtained_at, encrypted: !!encKey() };
  } catch (e) { return { connected: false, error: String(e.message || e) }; }
}
