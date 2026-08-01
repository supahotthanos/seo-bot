// seo-bot · strategist — the daily "what should we actually do next" pass.
//
// Shubh (2026-07-15): Claude on the Mini should DRIVE DECISIONS, not just polish text. This is
// that lane: a headless `claude -p` session (the Mini's Max login — no API key) reads the
// engine's OWN accrued artifacts — crawl audit, GSC opportunities, pending proposals, the live
// AI-answer panel, the Google SERP playbook, experiment plans — and produces one prioritized
// action memo for #c-suite every morning.
//
// DECIDE-vs-DO boundary (safety invariants stay intact): the memo PROPOSES and prioritizes;
// execution still flows through the existing fail-closed machinery (propose → verify → PR →
// approvals). The strategist can never push a change, only argue for one — with evidence.
//
// FAIL-CLOSED: no claude CLI, a hung session, or an off-contract reply → status ≠ ok, nothing
// written, nothing posted. Never a fake plan.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { ROOT } from './config.mjs';

const CLAUDE = process.env.SEO_BOT_CLAUDE_BIN || 'claude';
const STRATEGIST_TIMEOUT_MS = 8 * 60 * 1000;
export const STRATEGIST_MODEL = process.env.SEO_BOT_STRATEGIST_MODEL || null; // null → the CLI's default model

const LANES = ['content', 'technical', 'aeo', 'local', 'offsite', 'measurement'];
// The bettable-metric contract mirrors src/outcomes.mjs METRICS — kept as a static list here
// so the prompt/parser stay dependency-light; the bets module re-validates against the live
// registry at placement (defense in depth: an id drifting out of METRICS is refused there).
const BET_METRICS = ['northStar.solv', 'northStar.atrp', 'gsc.clicks', 'gsc.avgPos', 'gsc.top10', 'panel.appearanceRate', 'aiVis.visibilityPct', 'ga4.sessions', 'ga4.conversions', 'verifier.score', 'audit.score'];

/** Collect a bounded, per-client evidence pack from the artifacts the engine already writes.
 *  Every source is optional (take() → null on absence); a client with nothing is skipped. */
export function gatherBriefing(clients = [], { root = ROOT, fsi = { readFileSync } } = {}) {
  const take = (p, n) => { try { return String(fsi.readFileSync(p, 'utf8')).slice(0, n); } catch { return null; } };
  const sections = [];
  for (const c of clients) {
    const rep = (f) => join(root, 'reports', c, f);
    const parts = {
      audit: take(rep('latest.md'), 1800),
      dailyBrief: take(rep('daily-brief.md'), 1800),
      gscOpportunities: take(rep('gsc-opportunities.md'), 1800),
      proposals: take(rep('proposals-latest.md'), 1500),
      aiPanel: take(join(root, 'reports', 'query-bank', c, 'report.md'), 2200),
      serpPlaybook: take(join(root, 'research', 'serp-playbook', c, 'PLAYBOOK.md'), 2200),
      experiments: take(rep('experiments-plan.json'), 1200),
      // Rank Loop inputs: the outcome scoreboard (what's actually moving) + the agent's own
      // bet ledger (its record, its open bets — memory across cycles, no re-proposing).
      scoreboard: take(rep('scoreboard.md'), 1500),
      betLedger: take(rep('bets-brief.md'), 1200),
    };
    if (Object.values(parts).some(Boolean)) sections.push({ client: c, parts });
  }
  return sections;
}

/** PURE: the strategist prompt. Strict-JSON contract so parsing is mechanical and fail-closed. */
export function buildStrategistPrompt(briefing = [], { today = '' } = {}) {
  const blocks = briefing.map((s) => {
    const parts = Object.entries(s.parts).filter(([, v]) => v)
      .map(([k, v]) => `--- ${k} ---\n${v}`).join('\n');
    return `=== CLIENT: ${s.client} ===\n${parts}`;
  }).join('\n\n');
  return [
    `You are the chief SEO/AEO strategist for SeenAI (med-spa vertical). Date: ${today}.`,
    'SeenAI plays the LOCAL SEO game (map pack, local organic, service-area architecture, AI',
    'answers for local intent) — NOT SaaS/e-com SEO and NOT rank-and-rent directories. Weigh',
    'every action through that lens: local conversion surfaces, GBP-adjacent signals, reviews,',
    'service-area coverage, and local AI visibility outrank generic content plays.',
    'Below are the engine\'s own measured artifacts per client (crawl audit, GSC opportunities,',
    'pending proposals, live AI-answer panel, Google SERP playbook, experiment plans).',
    '',
    'Produce the day\'s priorities. Rules:',
    '- Base every action ONLY on evidence in the briefing; name the source section in "why".',
    '- Never invent data. If evidence is thin, say so in "risks" instead of guessing.',
    `- "lane" must be one of: ${LANES.join(' | ')}.`,
    '- 3 to 6 actions, ranked by expected impact per unit of effort.',
    '- BETS (accountability): you may place up to 3 tracked bets — a concrete action with the',
    '  OUTCOME metric you expect it to move and a 2-6 week horizon. Your bet ledger (record +',
    '  open bets) is in the briefing: do NOT re-propose open bets; learn from misses. Only bet',
    `  on metrics from this exact list: ${BET_METRICS.join(' | ')}. A human approves every bet`,
    '  before it becomes work. No scoreboard/bet-ledger section in the briefing → place NO bets.',
    '',
    'Reply with ONLY this JSON object, no prose:',
    '{"headline":"<one sentence, the single most important move>",',
    ' "actions":[{"title":"","client":"","lane":"","why":"<evidence-cited>","impact":"high|medium|low","effort":"low|medium|high"}],',
    ' "bets":[{"title":"","client":"","lane":"","action":"<the concrete work>","metric":"<from the list>","horizonWeeks":4,"why":"<evidence-cited>"}],',
    ' "experiments":[{"title":"","client":"","hypothesis":""}],',
    ' "risks":["<short>"]}',
    '',
    blocks,
  ].join('\n');
}

/** PURE + fail-closed: parse the memo. Off-contract in any way → null (post nothing). */
export function parseStrategistMemo(raw = '') {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j = null;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!j || typeof j.headline !== 'string' || !j.headline.trim()) return null;
  if (!Array.isArray(j.actions) || j.actions.length < 1 || j.actions.length > 8) return null;
  const actions = [];
  for (const a of j.actions) {
    if (!a || typeof a.title !== 'string' || !a.title.trim()) return null;
    actions.push({
      title: String(a.title).slice(0, 140), client: String(a.client || '').slice(0, 64),
      lane: LANES.includes(a.lane) ? a.lane : 'measurement',
      why: String(a.why || '').slice(0, 400),
      impact: ['high', 'medium', 'low'].includes(a.impact) ? a.impact : 'medium',
      effort: ['high', 'medium', 'low'].includes(a.effort) ? a.effort : 'medium',
    });
  }
  return {
    headline: j.headline.trim().slice(0, 200),
    actions,
    // Bets are OPTIONAL and individually fail-closed: a bet missing any required field or
    // naming an off-list metric is dropped (never coerced — a mis-specified bet cannot be
    // scored honestly, so it must not exist).
    bets: (Array.isArray(j.bets) ? j.bets : []).slice(0, 3)
      .map((b) => ({
        title: String(b?.title || '').slice(0, 140), client: String(b?.client || '').slice(0, 64),
        lane: LANES.includes(b?.lane) ? b.lane : null, action: String(b?.action || '').slice(0, 300),
        metric: BET_METRICS.includes(b?.metric) ? b.metric : null,
        horizonWeeks: Number.isFinite(Number(b?.horizonWeeks)) ? Math.min(6, Math.max(2, Math.round(Number(b.horizonWeeks)))) : null,
        why: String(b?.why || '').slice(0, 400),
      }))
      .filter((b) => b.title && b.lane && b.metric && b.horizonWeeks && b.action),
    experiments: (Array.isArray(j.experiments) ? j.experiments : []).slice(0, 3)
      .map((e) => ({ title: String(e?.title || '').slice(0, 140), client: String(e?.client || '').slice(0, 64), hypothesis: String(e?.hypothesis || '').slice(0, 300) }))
      .filter((e) => e.title),
    risks: (Array.isArray(j.risks) ? j.risks : []).slice(0, 3).map((r) => String(r).slice(0, 200)),
  };
}

/** PURE: the memo as markdown (saved next to the JSON for humans reading the repo). */
export function renderMemoMd(memo, { date = '' } = {}) {
  const L = [`# Strategy brief — ${date}`, '', `**${memo.headline}**`, '', '## Actions (ranked)'];
  memo.actions.forEach((a, i) => L.push(`${i + 1}. **${a.title}**${a.client ? ` (${a.client})` : ''} — \`${a.lane}\` · impact ${a.impact} · effort ${a.effort}\n   ${a.why}`));
  if (memo.bets?.length) { L.push('', '## Bets placed (await human approval — scored at horizon)'); for (const b of memo.bets) L.push(`- 🎯 **${b.title}**${b.client ? ` (${b.client})` : ''} — ${b.action}\n  expect \`${b.metric}\` to improve within ${b.horizonWeeks}w · ${b.why}`); }
  if (memo.experiments.length) { L.push('', '## Experiments to run'); for (const e of memo.experiments) L.push(`- **${e.title}**${e.client ? ` (${e.client})` : ''} — ${e.hypothesis}`); }
  if (memo.risks.length) { L.push('', '## Risks / honesty notes'); for (const r of memo.risks) L.push(`- ${r}`); }
  L.push('', '_Proposed by the strategist pass (claude headless on the Mini). Execution still flows through propose → verify → PR → approvals._');
  return L.join('\n');
}

/** Run one strategist pass. `exec` injectable for tests (the suite never spawns the real CLI). */
export function runStrategist({ clients = [], root = ROOT, exec = null, log = () => {}, model = STRATEGIST_MODEL, nowIso = new Date().toISOString() } = {}) {
  const briefing = gatherBriefing(clients, { root });
  if (!briefing.length) { log('  strategist: no artifacts on disk yet — nothing to reason over'); return { status: 'no-data' }; }
  const day = String(nowIso).slice(0, 10);
  const prompt = buildStrategistPrompt(briefing, { today: day });
  log(`  strategist: briefing ${briefing.length} client(s), ${Math.round(prompt.length / 1024)}KB evidence → claude${model ? ` --model ${model}` : ''}`);
  const run = exec || ((bin, args, input) => execFileSync(bin, args, { cwd: root, encoding: 'utf8', timeout: STRATEGIST_TIMEOUT_MS, killSignal: 'SIGKILL', input, stdio: ['pipe', 'pipe', 'ignore'] }));
  let raw = null;
  try { raw = run(CLAUDE, ['-p', ...(model ? ['--model', model] : []), '--output-format', 'text'], prompt); }
  catch (e) { log(`  strategist: claude run failed (${String(e && e.message || e).slice(0, 100)}) — fail-closed`); return { status: 'llm-failed' }; }
  const memo = parseStrategistMemo(raw);
  if (!memo) { log('  strategist: off-contract reply — fail-closed, nothing posted'); return { status: 'unparseable' }; }
  const dir = join(root, 'reports', '_strategist');
  mkdirSync(dir, { recursive: true });
  const mdPath = join(dir, `${day}.md`);
  writeFileSync(join(dir, `${day}.json`), JSON.stringify({ ...memo, at: nowIso, clients }, null, 2));
  writeFileSync(mdPath, renderMemoMd(memo, { date: day }));
  log(`  strategist: ${memo.actions.length} action(s) — "${memo.headline.slice(0, 80)}"`);
  return { status: 'ok', memo, mdPath, day };
}
