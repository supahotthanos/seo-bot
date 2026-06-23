// seo-bot · config loading + validation.
// A "client" is any site you own the DNS for. One JSON file per client lives in
// seo-bot/config/<name>.json. The bot is otherwise identical across clients —
// that is the plug-and-play promise.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONFIG_DIR = join(__dirname, '..', 'config');
export const ROOT = join(__dirname, '..', '..'); // repo root

const DEFAULTS = {
  aliases: [],
  competitors: [],
  sitemaps: [],
  schemaTypesExpected: ['Organization'],
  engines: ['perplexity', 'google_aio'],
  promptPanel: [],
  cms: { type: 'dryrun' }, // dryrun | nextjs | wordpress
  gsc: { enabled: false },
  ga4: { propertyId: null }, // numeric GA4 property id — `connect <client>` grants access
  bing: { siteUrl: null },   // Bing Webmaster Tools; apiKey via env BING_WEBMASTER_API_KEY (free)
  tracking: { keywords: [], competitors: [], country: 'us' }, // for `serp` rank tracking
  // locations[]: multi-location clients. Each = { name, nap{name,street,city,state,zip,phone},
  // geo{lat,lng}, gbp{account,location}, pagePath, services[], unique:"local-specific copy" }.
  // Empty → the bot synthesizes ONE location from the legacy single-location fields (back-compat).
  locations: [],
  services: [],              // service names for per-location page generation
  gate: { minScore: 70, maxCritical: 0, maxHigh: null, maxScoreDrop: 5 }, // CI regression gate thresholds
  // autopilot: 'conservative' = only deterministic meta/title, proven non-negative class.
  // 'aggressive' = ANY auto-applicable structural fix flows to the verifier consensus (the gate);
  // unproven classes are allowed (verifier + change-ledger + CI gate are the safety net).
  // The legal/YMYL/irreversible/high-risk-path hard blocks ALWAYS apply, both modes.
  autopilot: { mode: 'conservative', consensusThreshold: null },
  riskTiers: { autoApplyMaxSeverity: 'low', highRiskPathRe: '(^/?$)|/(pricing|book|consult|contact|checkout|cart|appointment)' },
  // reviewers[]: the agency's REAL, credentialed medical reviewers — { name, credentials, npi? }.
  // When set, a content byline that names anyone NOT in this list fails the medical-reviewer
  // gate (anti-fabricated-authority). Empty → bylines are unverified (warn, don't block).
  reviewers: [],
  tacticsOptIn: [],          // grey-hat tactic ids the owner has explicitly enabled
  // vertical: set 'medspa' to enable the med-spa rule pack (schema/NAP/E-E-A-T/compliance).
  vertical: null,
  servicePathRe: null,   // e.g. "/(services|treatments)/" — gates service-page rules
  locationPathRe: null,  // e.g. "/(locations|[a-z-]+-[a-z]{2})/" — gates location-page rules
  listings: { canonicalNap: null, targets: [] }, // local-citations source of truth (see `citations`)
  audit: {
    maxPages: 40,
    includePaths: [],
    excludePaths: ['/api/', '/_next/', '/cdn-cgi/'],
    minWords: 300,
    titleMax: 70,
    titleMin: 15,
    metaMin: 50,
    metaMax: 160,
    answerWordsMin: 40,
    answerWordsMax: 60,
    freshnessDays: 90,
    medspaFreshnessDays: 30, // service/location pages — AI cites fresher content
    minInternalLinks: 3,
    politenessMs: 350,
  },
};

function deepMerge(base, over) {
  if (Array.isArray(over)) return over.slice();
  if (over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base?.[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

/** Build a validated config object from a raw object (no file). Used by onboarding
 *  for domains that don't have a config yet, and to synthesize starter configs. */
export function buildConfig(raw) {
  const cfg = deepMerge(DEFAULTS, raw || {});
  if (!cfg.domain) throw new Error('buildConfig: "domain" is required');
  cfg.brand = cfg.brand || cfg.domain;
  cfg.domain = cfg.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./i, '');
  cfg.name = cfg.name || cfg.domain.replace(/\./g, '-');
  cfg.baseUrl = (cfg.baseUrl || `https://${cfg.domain}`).replace(/\/$/, '');
  if (!cfg.sitemaps.length) cfg.sitemaps = [`${cfg.baseUrl}/sitemap.xml`];
  return cfg;
}

/** Resolve a client name or explicit path to a config object. */
export function loadConfig(nameOrPath) {
  if (!nameOrPath) throw new Error('loadConfig: pass a client name or config path');
  let file;
  if (nameOrPath.endsWith('.json')) {
    file = isAbsolute(nameOrPath) ? nameOrPath : resolve(process.cwd(), nameOrPath);
  } else {
    file = join(CONFIG_DIR, `${nameOrPath}.json`);
  }
  if (!existsSync(file)) throw new Error(`Config not found: ${file}`);

  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  const cfg = deepMerge(DEFAULTS, raw);

  // --- validate + normalize ---
  if (!cfg.brand) throw new Error(`Config ${file}: "brand" is required`);
  if (!cfg.domain) throw new Error(`Config ${file}: "domain" is required`);
  cfg.name = cfg.name || nameOrPath.replace(/\.json$/, '');
  cfg.domain = cfg.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./i, '');
  cfg.baseUrl = (cfg.baseUrl || `https://${cfg.domain}`).replace(/\/$/, '');
  if (!cfg.sitemaps.length) cfg.sitemaps = [`${cfg.baseUrl}/sitemap.xml`];
  cfg._file = file;
  return cfg;
}

// Config files that are NOT clients (shared bot config living in the same dir).
const NON_CLIENT_CONFIGS = new Set(['source-trust']);

/** List available client configs. */
export function listConfigs() {
  if (!existsSync(CONFIG_DIR)) return [];
  return readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith('.json') && !f.startsWith('example'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((name) => !NON_CLIENT_CONFIGS.has(name));
}
