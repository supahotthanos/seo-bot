// seo-bot · cost — LLM token + spend telemetry. The Anthropic calls discarded msg.usage;
// this captures it into a per-client ledger so an agency can see what each client's
// automation actually costs (and cap it). Prices are per-million tokens (June 2026,
// override via SEO_BOT_PRICES JSON if they change).

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';

const PRICES = { 'claude-opus-4-8': [15, 75], 'claude-sonnet-4-6': [3, 15], 'claude-haiku-4-5': [1, 5], default: [3, 15] };
function priceFor(model) {
  try { const o = JSON.parse(process.env.SEO_BOT_PRICES || '{}'); if (o[model]) return o[model]; } catch { /* ignore */ }
  return PRICES[model] || PRICES.default;
}
const ledgerPath = (client) => join(ROOT, 'seo-bot', 'reports', client || '_global', 'cost-ledger.ndjson');

export function recordUsage(client, model, usage, { tag = '' } = {}) {
  if (!usage) return null;
  const [pin, pout] = priceFor(model);
  const inTok = usage.input_tokens || 0, outTok = usage.output_tokens || 0;
  const cost = (inTok / 1e6) * pin + (outTok / 1e6) * pout;
  try {
    const dir = join(ROOT, 'seo-bot', 'reports', client || '_global');
    mkdirSync(dir, { recursive: true });
    appendFileSync(ledgerPath(client), JSON.stringify({ ts: nowIso(), model, tag, inTok, outTok, cost: Math.round(cost * 1e6) / 1e6 }) + '\n');
  } catch { /* telemetry must never break the run */ }
  return { inTok, outTok, cost };
}

export function costSummary(client, { log = () => {} } = {}) {
  const p = ledgerPath(client);
  if (!existsSync(p)) return { calls: 0, cost: 0, note: 'no LLM spend recorded yet' };
  const rows = readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const cost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const inTok = rows.reduce((s, r) => s + (r.inTok || 0), 0);
  const outTok = rows.reduce((s, r) => s + (r.outTok || 0), 0);
  const byTag = {};
  for (const r of rows) byTag[r.tag || '?'] = (byTag[r.tag || '?'] || 0) + (r.cost || 0);
  log(`  Cost ledger (${client}): ${rows.length} calls · ${inTok + outTok} tokens · $${cost.toFixed(4)}`);
  Object.entries(byTag).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => log(`    ${t}: $${c.toFixed(4)}`));
  return { calls: rows.length, inTok, outTok, cost, byTag };
}

// Module-level context so the low-level llm() helper can attribute spend without
// threading client/tag through every call site.
let _ctx = { client: null, tag: '' };
export function setCostContext(ctx = {}) { _ctx = { ..._ctx, ...ctx }; }
export function getCostContext() { return _ctx; }
