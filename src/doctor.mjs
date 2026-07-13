// seo-bot · doctor — preflight readiness check. Tells you EXACTLY what's configured
// vs missing to take a client live, with the precise fix for each. The bot is built;
// this minimizes the human work to cross the credential gap (see ../SETUP.md).

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionStatus } from './connect/google.mjs';
import { listConfigs, loadConfig } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const has = (cmd) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };
const ICON = (ok) => (ok ? '✅' : '☐');

export function doctor(clientName, { log = () => {} } = {}) {
  log(`\n  seo-bot doctor — go-live readiness\n`);

  // ---- Global (one-time, agency-wide) ----
  const oauth = !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) || existsSync(join(__dirname, '..', 'config', 'google-oauth.json'));
  const checks = [
    [oauth, 'Google OAuth client', 'Create a "Desktop app" OAuth client → set GOOGLE_OAUTH_CLIENT_ID/SECRET (or seo-bot/config/google-oauth.json). See seo-bot/SETUP.md.'],
    [!!process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY', 'Set it so `content draft/batch` auto-writes copy (gates apply regardless).'],
    [!!process.env.SEO_BOT_SECRET_KEY, 'SEO_BOT_SECRET_KEY', 'Set it to encrypt stored OAuth refresh tokens at rest (AES-256-GCM).'],
    [!!process.env.INDEXNOW_KEY || listConfigs().some((n) => { try { return !!loadConfig(n).indexnowKey; } catch { return false; } }), 'IndexNow key', 'Set INDEXNOW_KEY (or per-config indexnowKey) + host {key}.txt for instant Bing/ChatGPT indexing.'],
    [has('gh'), 'gh CLI (PRs)', 'Install GitHub CLI so `apply`/`content publish` can open PRs automatically.'],
    [has('python') || has('python3'), 'Python (Scrapling stealth)', 'Optional: install Python + `pip install "scrapling[fetchers]" && scrapling install` for stealth fetches.'],
    [!!process.env.CLOUDFLARE_API_TOKEN, 'Cloudflare DNS token (optional)', 'Set CLOUDFLARE_API_TOKEN (Zone:DNS:Edit) so `dns` can read + auto-fix DMARC / write verification TXT.'],
    [!!process.env.BING_WEBMASTER_API_KEY, 'Bing Webmaster key (free keyword volume)', 'Generate a key in Bing Webmaster Tools → API access; set BING_WEBMASTER_API_KEY. Free search-volume data (no Ahrefs bill).'],
    [!!(process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY), 'PageSpeed/CrUX key (free, optional)', 'Create a plain GCP API key, enable PageSpeed Insights + Chrome UX Report APIs; set PAGESPEED_API_KEY/CRUX_API_KEY (or GOOGLE_API_KEY). Lifts CWV quota; enables field data.'],
    [!!(process.env.KG_API_KEY || process.env.GOOGLE_API_KEY), 'Knowledge Graph key (free, optional)', 'Same GCP key with the Knowledge Graph Search API enabled → set KG_API_KEY. Enables Google-entity consistency checks (Wikidata works without it).'],
    [!!process.env.CLARITY_API_TOKEN, 'Microsoft Clarity token (free, optional)', 'Clarity → Settings → Data Export → generate a token; set CLARITY_API_TOKEN for rage/dead-click + JS-error UX signals.'],
  ];
  log('  GLOBAL (one-time):');
  let globalOk = 0;
  for (const [ok, name, fix] of checks) { log(`    ${ICON(ok)} ${name}${ok ? '' : ' — ' + fix}`); if (ok) globalOk++; }

  // ---- Per client ----
  const clients = clientName ? [clientName] : listConfigs();
  for (const name of clients) {
    let cfg; try { cfg = loadConfig(name); } catch (e) { log(`\n  ${name}: ⚠ ${e.message}`); continue; }
    const conn = connectionStatus(cfg.name);
    const cc = [
      [conn.connected, 'Google connected', `Run \`connect ${cfg.name}\` (after the OAuth client exists).`],
      [conn.encrypted, 'Tokens encrypted', 'Set SEO_BOT_SECRET_KEY before connecting.'],
      [cfg.connectorsProductionReady === true, 'Consent In-Production', 'Move the OAuth consent screen to In-Production, then set connectorsProductionReady:true (Testing tokens expire in 7d).'],
      [!!cfg.ga4?.propertyId, 'GA4 property id', 'Set ga4.propertyId (the numeric id) in the config.'],
      [cfg.vertical === 'medspa', 'vertical: medspa', 'Set vertical:medspa + servicePathRe + locationPathRe to enable the med-spa rule pack.'],
      [!!cfg.listings?.canonicalNap, 'Canonical NAP', 'Set listings.canonicalNap (exact legal name/address/phone) — the citation source of truth.'],
      [(cfg.services?.length || 0) > 0, 'Services + prices', 'Add services[] with real price ranges.'],
      [(cfg.promptPanel?.length || 0) >= 20, 'Prompt panel (≥20)', 'Expand promptPanel to 30-50 non-branded/comparison prompts.'],
      [cfg.cms?.type && cfg.cms.type !== 'dryrun', 'CMS apply adapter', 'Set cms.type (nextjs/wordpress) + repoPath/wp creds so fixes + blogs can ship.'],
    ];
    let n = 0; for (const [ok] of cc) if (ok) n++;
    log(`\n  ${cfg.brand} (${cfg.name}) — ${n}/${cc.length} ready:`);
    for (const [ok, label, fix] of cc) log(`    ${ICON(ok)} ${label}${ok ? '' : ' — ' + fix}`);
  }

  const liveReady = oauth && !!process.env.ANTHROPIC_API_KEY;
  log(`\n  ${liveReady ? '✅ Core credentials present — run `setup <domain>` then `connect`.' : '☐ Add the Google OAuth client + ANTHROPIC_API_KEY to go live (see seo-bot/SETUP.md). Everything else is built.'}\n`);
  return { globalOk, globalTotal: checks.length, liveReady };
}
