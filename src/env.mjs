// seo-bot · env — tiny dependency-free .env loader, NON-OVERRIDING by contract:
// a value already in process.env (shell export, launchd EnvironmentVariables, Task
// Scheduler, CI) ALWAYS beats the file. The file only fills gaps, so ad-hoc
// `node bin/seo-bot.mjs …` invocations get SLACK_BOT_TOKEN / SEO_BOT_SECRET_KEY etc.
// without every caller having to source .env first (mini-run.sh still sources it —
// harmless double, same non-overriding result).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** PURE: parse KEY=VALUE lines. Supports `export KEY=…`, quoted values, # comment lines. */
export function parseDotEnv(text = '') {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Fill process.env gaps from ROOT/.env (or a given file). Returns { loaded } — the count of
 *  keys the FILE actually supplied (pre-set keys are never touched, never counted). */
export function loadDotEnv({ file = join(ROOT, '.env'), env = process.env } = {}) {
  if (!existsSync(file)) return { loaded: 0 };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return { loaded: 0 }; }
  let loaded = 0;
  for (const [k, v] of Object.entries(parseDotEnv(text))) {
    if (env[k] === undefined) { env[k] = v; loaded++; }
  }
  return { loaded };
}
