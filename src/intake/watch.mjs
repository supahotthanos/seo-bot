// seo-bot · intake/watch — the AUTONOMOUS client-intake lane.
//
// The operating agreement: when the web-dev finishes a site, he grants Search Console
// access to the agency Gmail (your-agency@example.com). Nothing else. This watcher turns that
// single human act into a fully onboarded client:
//
//   sites.list (the _intake account's GSC)  ──diff──▶  new property
//     → onboard(domain)            (config + worksheet + citations + content plan — the C3 path)
//     → gsc.siteUrl = the granted property, gsc.enabled = true
//     → linkGoogleToken('_intake', slug)   (ONE consent covers every future grant)
//     → escalate 🆕 to the C-suite channel (link to the dashboard)
//   …and the multi-client Mini wrapper picks the new config up on its next cycle. Zero clicks.
//
// Why the API and not Gmail parsing: a GSC user-grant is VISIBLE in sites.list within minutes
// and needs no acceptance click. The email is just the notification artifact — the API is the
// ground truth (deterministic, no restricted Gmail scopes, no link-clicking surface).
// Fail-closed: unverified grants are reported, never onboarded; onboard errors surface to
// Slack; nothing here ever deletes or rewrites an EXISTING config.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, listConfigs } from '../config.mjs';
import { getAccessToken, connectGoogle, connectionStatus, linkGoogleToken } from '../connect/google.mjs';

export const INTAKE_ACCOUNT = '_intake'; // secrets/_intake.google.json — the your-agency@example.com grant

/** PURE: a GSC property id → its bare domain. sc-domain:example.com and URL-prefix both handled. */
export function domainOfProperty(siteUrl = '') {
  const s = String(siteUrl).trim();
  if (s.startsWith('sc-domain:')) return s.slice('sc-domain:'.length).replace(/^www\./, '').toLowerCase() || null;
  try { return new URL(s).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

/** PURE: which granted properties are NEW (no config knows their domain)?
 *  Unverified grants are separated out — reported, never auto-onboarded (fail-closed). */
export function diffNewSites(sites = [], knownDomains = new Set()) {
  const fresh = [], unverified = [];
  const seen = new Set(); // one property per domain (sc-domain + URL-prefix often both granted)
  for (const s of sites) {
    const domain = domainOfProperty(s.siteUrl);
    if (!domain || knownDomains.has(domain) || seen.has(domain)) continue;
    if (String(s.permissionLevel || '') === 'siteUnverifiedUser') { unverified.push({ ...s, domain }); continue; }
    seen.add(domain);
    fresh.push({ ...s, domain });
  }
  return { fresh, unverified };
}

/** PURE: prefer the sc-domain property when both shapes are granted for one domain. */
export function pickProperty(sites, domain) {
  const mine = sites.filter((s) => domainOfProperty(s.siteUrl) === domain);
  return (mine.find((s) => s.siteUrl.startsWith('sc-domain:')) || mine[0] || null)?.siteUrl || null;
}

/** GSC sites.list under the intake account's token. */
export async function listGscSites(token) {
  const res = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`sites.list failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 120)}`);
  return ((await res.json()).siteEntry || []).map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
}

/** Domains every existing config already covers (config = the source of truth for "known"). */
export function knownConfigDomains({ root = ROOT } = {}) {
  const known = new Set();
  for (const name of listConfigs()) {
    try {
      const j = JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));
      const d = domainOfProperty(j.gsc?.siteUrl || '') || domainOfProperty(j.baseUrl || '') || (j.domain ? String(j.domain).replace(/^www\./, '').toLowerCase() : null);
      if (d) known.add(d);
    } catch { /* unreadable config never blocks intake */ }
  }
  return known;
}

/** One-time: authorize the agency intake Gmail (browser consent) with the GSC scope only.
 *  The address comes from --hint or SEO_BOT_INTAKE_EMAIL — never hardcoded. */
export async function intakeConnect({ hint = process.env.SEO_BOT_INTAKE_EMAIL || null, log = () => {} } = {}) {
  const st = connectionStatus(INTAKE_ACCOUNT);
  if (st.connected) { log(`  intake already connected (scopes: ${st.scopes}). Delete secrets/_intake.google.json to redo.`); return { ok: true, already: true }; }
  if (!hint) { log('  need the agency intake Gmail: pass --hint <email> or set SEO_BOT_INTAKE_EMAIL in .env'); return { ok: false, note: 'no intake email configured' }; }
  log(`  Opening Google sign-in — use ${hint} (the account your web-dev grants access to)…`);
  const r = await connectGoogle(INTAKE_ACCOUNT, { scopes: ['gsc'], loginHint: hint, log });
  log(`  ✅ intake account connected → ${r.path} ${r.encrypted ? '(encrypted at rest)' : '⚠ set SEO_BOT_SECRET_KEY'}`);
  return { ok: true };
}

export async function intakeStatus({ log = () => {} } = {}) {
  const st = connectionStatus(INTAKE_ACCOUNT);
  if (!st.connected) { log('  intake: NOT connected — run `seo-bot intake connect` (sign in as your-agency@example.com)'); return { connected: false }; }
  log(`  intake: connected (${st.scopes}) since ${st.obtainedAt}${st.encrypted ? ' · encrypted' : ''}`);
  try {
    const token = await getAccessToken(INTAKE_ACCOUNT);
    if (!token) { log('  ⚠ stored token no longer refreshes — reconnect (`intake connect` after deleting secrets/_intake.google.json)'); return { connected: false, stale: true }; }
    const sites = await listGscSites(token);
    const known = knownConfigDomains();
    for (const s of sites) {
      const d = domainOfProperty(s.siteUrl);
      log(`    ${known.has(d) ? '✓' : '🆕'} ${s.siteUrl}  (${s.permissionLevel})`);
    }
    return { connected: true, sites: sites.length };
  } catch (e) { log(`  ⚠ ${e.message}`); return { connected: true, error: e.message }; }
}

/** The watcher: new grant → onboarded client. Safe to run every 30 minutes forever. */
export async function intakeWatch({ log = () => {}, dryRun = false, root = ROOT, deps = {} } = {}) {
  const {
    tokenFn = () => getAccessToken(INTAKE_ACCOUNT),
    listFn = listGscSites,
    knownFn = () => knownConfigDomains({ root }),
    onboardFn = null, // default lazy-imported (heavy module)
    linkFn = linkGoogleToken,
    escalateFn = null, // default lazy-imported
  } = deps;

  const token = await tokenFn();
  if (!token) return { ok: false, note: 'intake account not connected — run `seo-bot intake connect` once (your-agency@example.com)' };

  const sites = await listFn(token);
  const known = knownFn();
  const { fresh, unverified } = diffNewSites(sites, known);
  log(`  intake: ${sites.length} propert${sites.length === 1 ? 'y' : 'ies'} granted · ${known.size} known client(s) · ${fresh.length} new · ${unverified.length} unverified`);

  const esc = escalateFn || (await import('../escalate.mjs')).escalate;
  const results = [];
  for (const u of unverified) {
    await esc(null, { severity: 'warning', area: 'intake', title: `GSC grant is UNVERIFIED — ${u.domain}`, detail: `your-agency-account was added to \`${u.siteUrl}\` but the property is unverified (permission: ${u.permissionLevel}). Ask the dev to verify the property; intake will pick it up on the next pass.` }, { log });
    results.push({ domain: u.domain, status: 'unverified' });
  }
  for (const site of fresh) {
    if (dryRun) { log(`  would onboard: ${site.domain} (${site.siteUrl})`); results.push({ domain: site.domain, status: 'dry-run' }); continue; }
    try {
      const ob = onboardFn || (await import('../onboard/index.mjs')).onboard;
      const r = await ob(site.domain, { log, writeConfig: true });
      const slug = r.slug;
      // Patch the fresh config: the granted property is the GSC source of truth; the shared
      // intake token becomes this client's credential (no extra consent, pulls work TODAY).
      const cfgPath = join(root, 'config', `${slug}.json`);
      if (existsSync(cfgPath)) {
        const j = JSON.parse(readFileSync(cfgPath, 'utf8'));
        j.gsc = { ...(j.gsc || {}), enabled: true, siteUrl: pickProperty(sites, site.domain) || site.siteUrl };
        writeFileSync(cfgPath, JSON.stringify(j, null, 2));
      }
      const link = linkFn(INTAKE_ACCOUNT, slug);
      await esc(null, {
        severity: 'info', area: 'intake',
        title: `🆕 New client site landed — ${site.domain}`,
        detail: `The dev granted \`${site.siteUrl}\` to the agency account. Onboarded as \`${slug}\` (config + worksheet + citations + content plan), GSC ${link.ok ? 'LINKED (pulls live now)' : `link failed: ${link.error}`}. It joins the weekly loop automatically. Still human: vertical/NAP/services in the config.`,
      }, { log });
      results.push({ domain: site.domain, status: 'onboarded', slug });
      log(`  ✅ intake: ${site.domain} → onboarded as ${slug}`);
    } catch (e) {
      await esc(null, { severity: 'critical', area: 'intake', title: `Intake onboarding FAILED — ${site.domain}`, detail: String(e && e.message || e).slice(0, 400) }, { log });
      results.push({ domain: site.domain, status: 'error', error: String(e && e.message || e) });
    }
  }
  return { ok: true, granted: sites.length, new: fresh.length, unverified: unverified.length, results };
}
