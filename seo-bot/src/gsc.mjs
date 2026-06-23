// seo-bot · Google Search Console pull — FREE first-party ground truth for sites
// you own (queries, impressions, clicks, position, + the new AI-search rows).
//
// Dependency-free: signs a service-account JWT with node:crypto (RS256), exchanges
// it for an access token, and calls the Search Analytics REST API directly. No
// googleapis package. Gracefully no-ops when credentials aren't configured.
//
// SETUP (one time per client):
//   1. Create a Google Cloud service account; download its JSON key.
//   2. In Search Console, add the service-account email as a Full/Restricted user.
//   3. Set GSC_CREDENTIALS=/path/to/key.json  (or the raw JSON string).
//   4. In the client config: "gsc": { "enabled": true, "siteUrl": "https://site.com/" }

import { readFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { getAccessToken as getOAuthToken } from './connect/google.mjs';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function loadCreds() {
  const src = process.env.GSC_CREDENTIALS;
  if (!src) return null;
  try {
    const raw = src.trim().startsWith('{') ? src : (existsSync(src) ? readFileSync(src, 'utf-8') : null);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c.client_email || !c.private_key) return null;
    return c;
  } catch { return null; }
}

async function getSaToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: creds.client_email, scope: SCOPE, aud: creds.token_uri || TOKEN_URI,
    iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(creds.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = `${header}.${claim}.${signature}`;
  const res = await fetch(creds.token_uri || TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`GSC token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

async function queryAnalytics(token, siteUrl, body) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GSC query failed: ${res.status} ${await res.text()}`);
  return (await res.json()).rows || [];
}

/**
 * Pull GSC. Returns:
 *  { enabled, note? } when not configured, or
 *  { enabled:true, queries:[...], pages:[...], opportunities:[...], ai:{...} }
 *
 * "opportunities" = pages/queries with impressions but weak position or low CTR —
 * the highest-leverage targets for the decide layer to prioritize.
 */
export async function pullGSC(cfg, { log = () => {}, range: rangeOverride } = {}) {
  const siteUrl = cfg.gsc?.siteUrl || `${cfg.baseUrl}/`;
  // Prefer a one-click OAuth connection; fall back to a service-account JSON.
  // Guard the token call: a saved token + missing OAuth-client creds throws — must no-op, not crash the loop.
  let token = null;
  try { token = await getOAuthToken(cfg.name); } catch { token = null; }
  let via = 'oauth';
  if (!token) {
    if (!cfg.gsc?.enabled) return { enabled: false, note: 'not connected (run `connect <client>`) and gsc.enabled is false' };
    const creds = loadCreds();
    if (!creds) return { enabled: false, note: 'not connected via OAuth and GSC_CREDENTIALS not set' };
    try { token = await getSaToken(creds); via = 'service-account'; } catch (e) { return { enabled: false, note: String(e.message || e) }; }
  }
  try {
    const range = rangeOverride || { startDate: daysAgo(28), endDate: daysAgo(1) };

    const [byQuery, byPage, byQueryPage] = await Promise.all([
      queryAnalytics(token, siteUrl, { ...range, dimensions: ['query'], rowLimit: 250 }),
      queryAnalytics(token, siteUrl, { ...range, dimensions: ['page'], rowLimit: 250 }),
      queryAnalytics(token, siteUrl, { ...range, dimensions: ['query', 'page'], rowLimit: 1000 }),
    ]);

    // New AI-search rows: GSC exposes AI Overviews/AI Mode appearance. Attempt the
    // searchAppearance dimension; if the API rejects it, degrade silently.
    let ai = null;
    try {
      const rows = await queryAnalytics(token, siteUrl, { ...range, dimensions: ['searchAppearance'], rowLimit: 50 });
      ai = rows.filter((r) => /ai|overview|generative/i.test(r.keys?.[0] || ''));
    } catch { ai = null; }

    // Opportunities: impressions >= 20, position 5-20 (page-2-ish), or CTR < expected.
    const opportunities = byPage
      .filter((r) => r.impressions >= 20 && r.position >= 4.5 && r.position <= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 50)
      .map((r) => ({ page: r.keys[0], impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: Math.round(r.position * 10) / 10 }));

    // Sturm signal: 7+-word natural-language (LLM-style) queries — proxy for AI surfacing.
    const aiQueries = byQuery.filter((r) => ((r.keys?.[0] || '').trim().split(/\s+/).length >= 7)).slice(0, 50);

    // Striking distance: a query stuck on page 1-2 (pos 8-20) with real demand — one nudge
    // (on-page focus, internal link, title) often moves it onto page 1. Highest ROI/effort.
    const strikingDistance = byQuery
      .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 30)
      .sort((a, b) => b.impressions - a.impressions).slice(0, 40)
      .map((r) => ({ query: r.keys[0], impressions: r.impressions, clicks: r.clicks, ctr: Math.round(r.ctr * 1000) / 10, position: Math.round(r.position * 10) / 10 }));

    // Cannibalization: queries where 2+ of our own URLs rank — the pages split signals and
    // suppress each other. The #1 self-inflicted failure when spinning service×city pages.
    const qp = new Map();
    for (const r of byQueryPage) { const q = r.keys[0], p = r.keys[1]; if (!qp.has(q)) qp.set(q, []); qp.get(q).push({ page: p, impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10 }); }
    const cannibalization = [...qp.entries()]
      .filter(([, ps]) => ps.length >= 2 && ps.reduce((s, x) => s + x.impressions, 0) >= 20)
      .map(([query, ps]) => ({ query, count: ps.length, impressions: ps.reduce((s, x) => s + x.impressions, 0), pages: ps.sort((a, b) => a.position - b.position) }))
      .sort((a, b) => b.impressions - a.impressions).slice(0, 40);

    log(`  GSC: ${byQuery.length} queries (${aiQueries.length} LLM-style 7+w), ${byPage.length} pages, ${opportunities.length} opportunities, ${strikingDistance.length} striking-distance, ${cannibalization.length} cannibalized${ai ? `, ${ai.length} AI-appearance rows` : ''}.`);
    return { enabled: true, siteUrl, range, queries: byQuery, pages: byPage, opportunities, strikingDistance, cannibalization, ai, aiQueries };
  } catch (e) {
    return { enabled: false, note: String(e.message || e) };
  }
}
