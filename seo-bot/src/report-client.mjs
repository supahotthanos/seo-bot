// seo-bot · report-client — white-label per-client report (Epic 16, work-unit A11).
//
// Consolidates everything a client wants to see into ONE branded HTML + MD report,
// served from our own Next.js app at $0 (vs OTTO's $999/mo white-label Agency tier):
//   · audit health score (from run-latest.json / latest audit)
//   · GSC clicks/impressions WoW deltas (last 7d vs prior 7d, if connected)
//   · GA4 AI-referral sessions (the dark-traffic KPI)
//   · AI Share-of-Voice (from the AI-visibility capture, if present)
//   · tasks deployed / rolled-back (from the task ledger)
//   · optional LLM executive summary (only when ANTHROPIC_API_KEY is set)
//
// Reads run-latest.json + the task ledger; pulls fresh GSC/GA4 only when connected.
// Pure read/compute + writes the report files (the only writes; not gated since it's
// our own report output, never a production change).

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';
import { currentTasks } from './tasks.mjs';

function dirFor(client) { return join(ROOT, 'seo-bot', 'reports', client); }

function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; } }

/** Latest AI-visibility capture, if the measure step ever produced one. */
function latestAiVisibility(client) {
  const d = join(dirFor(client), 'ai-visibility');
  if (!existsSync(d)) return null;
  const files = readdirSync(d).filter((f) => f.endsWith('.json') && f !== 'trend.json').sort();
  if (!files.length) return null;
  return readJson(join(d, files[files.length - 1]));
}

/** Sum clicks/impressions across a GSC pages[] array. */
function totals(pages = []) {
  return pages.reduce((a, p) => ({ clicks: a.clicks + (p.clicks || 0), impressions: a.impressions + (p.impressions || 0) }), { clicks: 0, impressions: 0 });
}

function delta(cur, prev) {
  const d = cur - prev;
  const pct = prev ? Math.round((d / prev) * 1000) / 10 : null;
  return { cur, prev, abs: d, pct };
}

/** Optional LLM exec summary. No-ops (returns null) without ANTHROPIC_API_KEY. */
async function execSummary(facts) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const model = process.env.SEO_BOT_MODEL || 'claude-sonnet-4-6';
    const msg = await client.messages.create({
      model, max_tokens: 350,
      system: 'You write a 3-4 sentence executive summary for a med-spa SEO/AEO client report. Plain, factual, no hype, no superlatives, no invented numbers. Only use the metrics provided. Mention the single most important next action.',
      messages: [{ role: 'user', content: `Metrics JSON:\n${JSON.stringify(facts, null, 2)}\n\nWrite the executive summary.` }],
    });
    try { const { recordUsage, getCostContext } = await import('./cost.mjs'); const c = getCostContext(); recordUsage(facts.client, model, msg.usage, { tag: 'report-client' }); } catch { /* telemetry only */ }
    return (msg.content?.[0]?.text || '').trim() || null;
  } catch { return null; }
}

/**
 * Gather every metric for the report. Pulls fresh GSC/GA4 only if connected.
 * @returns a plain facts object (also handy for the portfolio rollup).
 */
export async function gatherClientFacts(cfg, { log = () => {} } = {}) {
  const client = cfg.name;
  const run = readJson(join(dirFor(client), 'run-latest.json')) || {};

  // GSC WoW deltas — last 7d vs the prior 7d (best-effort; off when not connected).
  let gscWoW = null;
  try {
    const { pullGSC } = await import('./gsc.mjs');
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const cur = await pullGSC(cfg, { range: { startDate: day(7), endDate: day(1) } });
    if (cur.enabled) {
      const prev = await pullGSC(cfg, { range: { startDate: day(14), endDate: day(8) } });
      const c = totals(cur.pages), p = totals(prev.enabled ? prev.pages : []);
      gscWoW = { clicks: delta(c.clicks, p.clicks), impressions: delta(c.impressions, p.impressions) };
    }
  } catch { /* GSC optional */ }

  // GA4 AI-referral sessions.
  let ai = null;
  try {
    const { ga4Report } = await import('./data/ga4.mjs');
    const g = await ga4Report(cfg, { log: () => {} });
    if (g.enabled) ai = { aiSessions: g.aiSessions || 0, aiReferrals: (g.aiReferrals || []).slice(0, 8), totalConversions: g.totalConversions || 0 };
  } catch { /* GA4 optional */ }

  // AI Share-of-Voice (from the AI-visibility capture).
  const aiv = latestAiVisibility(client);
  const aiSov = aiv ? { ranAt: aiv.ranAt, byEngine: aiv.summary || {} } : null;

  // Task ledger — deployed / rolled-back / queued counts.
  const tasks = currentTasks(client);
  const tally = tasks.reduce((m, t) => { m[t.status] = (m[t.status] || 0) + 1; return m; }, {});
  const taskStats = {
    deployed: (tally.deployed || 0) + (tally.verified || 0),
    rolledBack: tally.rolled_back || 0,
    queued: (tally.queued || 0) + (tally.proposed || 0),
    approved: tally.approved || 0,
    rejected: tally.rejected || 0,
  };

  return {
    client, brand: cfg.brand, baseUrl: cfg.baseUrl, ranAt: nowIso(),
    auditScore: run.auditScore ?? null, progressScore: run.progressScore ?? null,
    gscWoW, ai, aiSov, taskStats, topGaps: run.topGaps || [],
  };
}

const num = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const arrow = (d) => (d == null ? '' : d.abs > 0 ? '▲' : d.abs < 0 ? '▼' : '·');
const deltaStr = (d) => (d == null ? '—' : `${num(d.cur)} (${arrow(d)} ${d.pct == null ? '—' : (d.pct > 0 ? '+' : '') + d.pct + '%'} WoW)`);

/** Render the markdown report. */
export function renderMd(f, summary) {
  const L = [];
  L.push(`# ${f.brand} — SEO/AEO Report`);
  L.push(`${f.baseUrl} · ${new Date(f.ranAt).toUTCString()}`);
  L.push('');
  if (summary) { L.push(`> ${summary.replace(/\n+/g, ' ')}`); L.push(''); }
  L.push(`## Scorecard`);
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| Audit health | ${f.auditScore == null ? '—' : f.auditScore + '/100'} |`);
  L.push(`| Build progress | ${f.progressScore == null ? '—' : f.progressScore + '/100'} |`);
  if (f.gscWoW) {
    L.push(`| GSC clicks (7d) | ${deltaStr(f.gscWoW.clicks)} |`);
    L.push(`| GSC impressions (7d) | ${deltaStr(f.gscWoW.impressions)} |`);
  } else L.push(`| GSC | not connected |`);
  if (f.ai) L.push(`| AI-referral sessions (28d) | ${num(f.ai.aiSessions)} |`);
  L.push(`| Tasks deployed | ${num(f.taskStats.deployed)} |`);
  L.push(`| Tasks rolled back | ${num(f.taskStats.rolledBack)} |`);
  L.push(`| Tasks queued for review | ${num(f.taskStats.queued)} |`);
  L.push('');
  if (f.aiSov) {
    L.push(`## AI Share-of-Voice`);
    L.push(`<sub>captured ${new Date(f.aiSov.ranAt).toUTCString()}</sub>`);
    L.push(`| Engine | Visibility | Cited | Avg pos |`);
    L.push(`|---|---|---|---|`);
    for (const [eng, s] of Object.entries(f.aiSov.byEngine)) L.push(`| ${eng} | ${s.visibility_pct ?? '—'}% | ${s.cited_pct ?? '—'}% | ${s.avg_position ?? '—'} |`);
    L.push('');
  }
  if (f.ai?.aiReferrals?.length) {
    L.push(`## AI engines sending traffic`);
    for (const r of f.ai.aiReferrals) L.push(`- ${r.source} — ${num(r.sessions)} sessions, ${num(r.conversions)} conversions`);
    L.push('');
  }
  if (f.topGaps?.length) { L.push(`## Recommended next steps`); for (const g of f.topGaps) L.push(`- ${g}`); L.push(''); }
  L.push('---');
  L.push('_Server-rendered fixes only (what AI crawlers see on first byte). Permanent + version-controlled — not a rented overlay. Not legal/medical advice._');
  return L.join('\n');
}

/** Render a self-contained, branded HTML report. Branding pulled from cfg. */
export function renderHtml(f, summary, cfg) {
  const brandColor = cfg.branding?.color || '#0f766e';
  const logo = cfg.branding?.logoUrl ? `<img src="${esc(cfg.branding.logoUrl)}" alt="${esc(f.brand)}" style="height:40px">` : `<strong style="font-size:20px">${esc(f.brand)}</strong>`;
  const row = (k, v) => `<tr><td>${esc(k)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${v}</td></tr>`;
  const scorecard = [
    row('Audit health', f.auditScore == null ? '—' : `${f.auditScore}/100`),
    row('Build progress', f.progressScore == null ? '—' : `${f.progressScore}/100`),
    f.gscWoW ? row('GSC clicks (7d)', esc(deltaStr(f.gscWoW.clicks))) : row('GSC', 'not connected'),
    f.gscWoW ? row('GSC impressions (7d)', esc(deltaStr(f.gscWoW.impressions))) : '',
    f.ai ? row('AI-referral sessions (28d)', num(f.ai.aiSessions)) : '',
    row('Tasks deployed', num(f.taskStats.deployed)),
    row('Tasks rolled back', num(f.taskStats.rolledBack)),
    row('Tasks queued', num(f.taskStats.queued)),
  ].filter(Boolean).join('');
  const sov = f.aiSov ? `<h2>AI Share-of-Voice</h2><table><thead><tr><th>Engine</th><th>Visibility</th><th>Cited</th><th>Avg pos</th></tr></thead><tbody>${Object.entries(f.aiSov.byEngine).map(([e, s]) => `<tr><td>${esc(e)}</td><td>${s.visibility_pct ?? '—'}%</td><td>${s.cited_pct ?? '—'}%</td><td>${s.avg_position ?? '—'}</td></tr>`).join('')}</tbody></table>` : '';
  const gaps = f.topGaps?.length ? `<h2>Recommended next steps</h2><ul>${f.topGaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '';
  const summaryHtml = summary ? `<p class="exec">${esc(summary)}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(f.brand)} — SEO/AEO Report</title>
<style>
:root{--brand:${esc(brandColor)}}
*{box-sizing:border-box}body{font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:760px;margin:0 auto;padding:32px}
header{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid var(--brand);padding-bottom:14px;margin-bottom:8px}
h1{font-size:22px;margin:18px 0 2px}h2{font-size:16px;margin:26px 0 8px;color:var(--brand)}
.meta{color:#666;font-size:13px}.exec{background:#f5f7f7;border-left:3px solid var(--brand);padding:12px 16px;border-radius:4px}
table{width:100%;border-collapse:collapse;margin:6px 0}td,th{padding:7px 10px;border-bottom:1px solid #eee;text-align:left}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#888}
footer{margin-top:32px;padding-top:14px;border-top:1px solid #eee;color:#888;font-size:12px}
</style></head><body>
<header>${logo}<span class="meta">${new Date(f.ranAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span></header>
<h1>SEO/AEO Performance</h1><div class="meta">${esc(f.baseUrl)}</div>
${summaryHtml}
<h2>Scorecard</h2><table><tbody>${scorecard}</tbody></table>
${sov}
${gaps}
<footer>Server-rendered fixes only — what AI crawlers see on first byte. Permanent &amp; version-controlled, not a rented overlay. Not legal/medical advice.</footer>
</body></html>`;
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** Build + persist the client report (HTML + MD). Returns { mdPath, htmlPath }. */
export async function reportClient(cfg, { log = () => {}, llm = true } = {}) {
  const f = await gatherClientFacts(cfg, { log });
  const summary = llm ? await execSummary(f) : null;
  const dir = dirFor(cfg.name);
  mkdirSync(dir, { recursive: true });
  const mdPath = join(dir, 'client-report.md');
  const htmlPath = join(dir, 'client-report.html');
  writeFileSync(mdPath, renderMd(f, summary));
  writeFileSync(htmlPath, renderHtml(f, summary, cfg));
  log(`  client report → ${mdPath}`);
  log(`                → ${htmlPath}${summary ? '' : '  (no LLM exec summary — set ANTHROPIC_API_KEY)'}`);
  return { mdPath, htmlPath, facts: f };
}
