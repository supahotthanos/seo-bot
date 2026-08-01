// seo-bot · measure/fanout-agent — Claude DRIVES the capture (Shubh 2026-07-17: "drive
// playwright from the Mac mini's claude so we can actually get these fan-out queries fully
// done; we're hitting the request thing too often and you're not realizing").
//
// The scripted runner is blind: it types, waits, and only recognizes walls it has regexes
// for. This lane hands the browser to a headless `claude -p` session with the Playwright MCP
// attached to the LOGGED-IN CDP Chrome — an operator that SEES the page: it reads the fan-out
// trace and the Sources panel like a human, notices a rate-limit modal the instant it renders,
// and stops. Slower per prompt, near-zero wasted budget.
//
// POLITE-CITIZEN RAILS (DO NOT WEAKEN):
//   * shares the runner's .cooldown gate — one throttle for every consumer of the session;
//   * hard prompt cap per run; one tab; 45-75s pacing between prompts;
//   * any wall/challenge → stop instantly, report walled, stamp cooldown. NEVER solve, NEVER retry.
// FAIL-CLOSED: no CLI / off-contract reply → status failed, nothing persisted.
// OWN-SHELL ONLY: a nested `claude -p` inside another Claude Code session can 401.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { inCooldown, SAFE_DEFAULTS } from './capture-governor.mjs';

const CLAUDE = process.env.SEO_BOT_CLAUDE_BIN || 'claude';
const AGENT_TIMEOUT_MS = 18 * 60 * 1000; // N prompts × (answer + pacing) — generous, SIGKILL past it

/** The Playwright MCP config: attach to the ALREADY-RUNNING logged-in Chrome, never a fresh one. */
export function writeAgentMcpConfig(dir, cdpEndpoint = 'http://localhost:9222', fsi = { mkdirSync, writeFileSync }) {
  const cfg = { mcpServers: { playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--cdp-endpoint', cdpEndpoint] } } };
  try { fsi.mkdirSync(dir, { recursive: true }); } catch { /* injected fs may be a no-op in tests */ }
  const p = join(dir, 'mcp-playwright-cdp.json');
  fsi.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}

/** PURE: the driving prompt. Strict JSON contract + absolute stop rules. */
export function buildAgentPrompt(prompts = []) {
  return [
    'You are operating the owner\'s OWN logged-in ChatGPT browser session (already running;',
    'attach via the playwright tools — the browser is connected over CDP). Mission: for each',
    'prompt below, capture ChatGPT\'s hidden FAN-OUT searches and the SOURCES it cites.',
    '',
    'Per prompt, do exactly this:',
    '1. Navigate to https://chatgpt.com/?temporary-chat=true (fresh temporary chat each time).',
    '2. Type the prompt into the composer and send it. Wait for the answer to FULLY finish.',
    '3. Read and record:',
    '   - fanouts: the reasoning trace\'s "Searched <query>" lines (click/expand the collapsed',
    '     "Worked for Ns" / thinking header if needed to reveal them);',
    '   - sources: open the answer\'s citations/Sources panel if present and record every',
    '     {title, url} pair you can see; otherwise record the link chips in the answer;',
    '   - ranked: business/company names the answer ranks or recommends, in order;',
    '   - model: the model label shown in the composer/menu if visible.',
    `4. Wait 45-75 seconds (vary it) before the next prompt. ONE tab only. Max ${prompts.length} prompts.`,
    '',
    'ABSOLUTE STOP RULES — these override the mission:',
    '- If ANY of these appear: "unusual activity", a rate-limit or "too many requests" notice,',
    '  a message-cap notice, a login wall, a CAPTCHA or human-verification challenge — STOP',
    '  IMMEDIATELY. Do not retry, do not dismiss-and-continue, do not attempt to solve or bypass',
    '  anything, ever. Record what you saw and report walled:true.',
    '- If the page misbehaves twice in a row (blank answers, errors), stop and report it.',
    '- Never log out, never change settings, never touch conversations in the sidebar.',
    '',
    'Reply with ONLY this JSON (no prose before or after):',
    '{"status":"ok"|"walled"|"failed","walled":false,"captures":[{"prompt":"<verbatim>",',
    ' "fanouts":["..."],"sources":[{"title":"","url":""}],"ranked":["..."],"model":""}],"notes":"<short>"}',
    'Include a capture entry for every prompt you COMPLETED (even if it had no fan-outs — empty',
    'arrays are honest). Never invent fan-outs or sources you did not see.',
    '',
    'PROMPTS:',
    ...prompts.map((p, i) => `${i + 1}. ${p}`),
  ].join('\n');
}

/** PURE + fail-closed: parse the agent's reply. Off-contract → null. */
export function parseAgentResult(raw = '', maxPrompts = 12) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j = null;
  try { j = JSON.parse(m[0]); } catch { return null; }
  if (!j || !['ok', 'walled', 'failed'].includes(j.status) || !Array.isArray(j.captures)) return null;
  if (j.captures.length > maxPrompts) return null;
  const captures = [];
  for (const c of j.captures) {
    if (!c || typeof c.prompt !== 'string' || !c.prompt.trim()) return null;
    captures.push({
      prompt: c.prompt.trim(),
      fanouts: (Array.isArray(c.fanouts) ? c.fanouts : []).filter((q) => typeof q === 'string' && q.trim().length >= 3).map((q) => q.trim().slice(0, 200)),
      sources: (Array.isArray(c.sources) ? c.sources : []).filter((s) => s && typeof s.url === 'string' && /^https?:\/\//.test(s.url))
        .map((s) => ({ title: String(s.title || '').slice(0, 160), url: s.url.slice(0, 300) })),
      ranked: (Array.isArray(c.ranked) ? c.ranked : []).filter((n) => typeof n === 'string' && n.trim()).map((n, i) => ({ rank: i + 1, name: n.trim().slice(0, 80) })),
      model: typeof c.model === 'string' ? c.model.slice(0, 40) : null,
    });
  }
  return { status: j.status, walled: !!j.walled || j.status === 'walled', captures, notes: String(j.notes || '').slice(0, 400) };
}

/** PURE: agent captures → observation rows (spec-joined so the panel dimensions are real).
 *  Rows are marked capturedVia:'claude-agent'; answer text stays EMPTY (we never fabricate). */
export function agentRowsFromCaptures(captures = [], specs = [], { nowIso = '' } = {}) {
  const byPrompt = new Map(specs.map((s) => [s.promptText.toLowerCase(), s]));
  const rows = [];
  for (const c of captures) {
    const spec = byPrompt.get(c.prompt.toLowerCase());
    if (!spec) continue; // unknown prompt → refuse the row (never guess dimensions)
    rows.push({
      status: 'ok', capturedVia: 'claude-agent',
      queryId: spec.queryId, intent: spec.intent, variantId: spec.variantId, template: spec.template,
      promptText: spec.promptText, engine: spec.engine || 'chatgpt', tier: spec.tier || 'low', city: spec.city,
      capturedAt: nowIso, dow: (() => { try { return new Date(nowIso).getUTCDay(); } catch { return null; } })(), day: String(nowIso).slice(0, 10),
      model: c.model || null, answerHash: 'agent-ui', ranked: c.ranked, subqueries: c.fanouts,
      citations: { urls: c.sources.map((s) => s.url) },
      sturm: { searchModelQueries: c.fanouts, contentReferences: c.sources.map((s) => ({ url: s.url, title: s.title, resultSource: null })), supportingWebsites: [], rewrittenQueries: [], searchResultGroup: [], safeUrls: [], resultSourceCounts: {}, resolvedModelSlug: null },
      answerExcerpt: '', answer: '',
    });
  }
  return rows;
}

/** Run one agent capture session. `exec`/`fsi` injectable (the suite never spawns the CLI). */
export function runFanoutAgent({ prompts = [], dir, cdpEndpoint = process.env.SEO_BOT_CDP_ENDPOINT || 'http://localhost:9222',
  exec = null, fsi = { readFileSync, writeFileSync, existsSync, mkdirSync }, log = () => {}, model = null, nowIso = new Date().toISOString() } = {}) {
  if (!prompts.length || !dir) return { status: 'no-prompts' };
  // Shared cooldown gate — the agent is a polite citizen of the SAME session as the runner.
  const cooldownFile = join(dir, '.cooldown');
  const nowMs = Date.parse(nowIso) || Date.now();
  if (fsi.existsSync(cooldownFile)) {
    const cd = inCooldown(Number(fsi.readFileSync(cooldownFile, 'utf8').trim()) || 0, nowMs, SAFE_DEFAULTS.cooldownMs);
    if (cd.cooling) { log(`  fanout-agent: 🧊 in COOLDOWN — ${Math.ceil(cd.remainingMs / 60000)} min remaining. Not touching the browser.`); return { status: 'cooling', remainingMs: cd.remainingMs }; }
  }
  const mcpConfig = writeAgentMcpConfig(join(dir, '_agent'), cdpEndpoint, fsi);
  const prompt = buildAgentPrompt(prompts);
  log(`  fanout-agent: driving ${prompts.length} prompt(s) via claude${model ? ` --model ${model}` : ''} + playwright(cdp)`);
  const run = exec || ((bin, args, input) => execFileSync(bin, args, { encoding: 'utf8', timeout: AGENT_TIMEOUT_MS, killSignal: 'SIGKILL', input, stdio: ['pipe', 'pipe', 'ignore'] }));
  let raw = null;
  try { raw = run(CLAUDE, ['-p', ...(model ? ['--model', model] : []), '--output-format', 'text', '--mcp-config', mcpConfig, '--allowedTools', 'mcp__playwright__*'], prompt); }
  catch (e) { log(`  fanout-agent: claude run failed (${String(e && e.message || e).slice(0, 100)}) — fail-closed`); return { status: 'llm-failed' }; }
  const result = parseAgentResult(raw, prompts.length);
  if (!result) { log('  fanout-agent: off-contract reply — fail-closed, nothing persisted'); return { status: 'unparseable' }; }
  if (result.walled) {
    fsi.writeFileSync(cooldownFile, String(nowMs)); // one wall gates EVERY consumer of the session
    log(`  fanout-agent: ⏸ agent SAW a wall (“${result.notes.slice(0, 80)}”) — cooldown stamped, ${result.captures.length} capture(s) kept`);
  } else {
    log(`  fanout-agent: ${result.captures.length} capture(s), ${result.captures.reduce((n, c) => n + c.fanouts.length, 0)} fan-outs, ${result.captures.reduce((n, c) => n + c.sources.length, 0)} sources`);
  }
  return { status: result.walled ? 'walled' : 'ok', ...result };
}
