// seo-bot · llm — the model provider. The bot lives inside Claude Code, so by DEFAULT it
// runs completions through the `claude` CLI in headless mode (`claude -p`), which uses the
// logged-in Max-plan subscription — NO ANTHROPIC_API_KEY needed. Falls back to the Anthropic
// API only if the CLI isn't available (or SEO_BOT_LLM=api is forced). If neither can run, it
// returns null and every caller fails closed (the verifier panel queues for a human, content
// won't draft). This is what lets the autopilot + content + verifier consensus run on the
// subscription tokens with zero per-call billing.
//
// NOTE: a nested `claude -p` inside another Claude Code session can 401 (auth isn't
// inherited); run the bot/cron in your authenticated shell and it uses your login.

import { spawn, execFileSync } from 'node:child_process';

const CLAUDE = process.env.SEO_BOT_CLAUDE_BIN || 'claude';
let _avail;

export function claudeAvailable() {
  if (_avail !== undefined) return _avail;
  try { execFileSync(CLAUDE, ['--version'], { stdio: 'ignore', timeout: 8000 }); _avail = true; } catch { _avail = false; }
  return _avail;
}
const preferCli = () => claudeAvailable() && process.env.SEO_BOT_LLM !== 'api';

/** Can ANY model path run? (CLI present, or an API key set.) */
export function llmAvailable() { return preferCli() || !!process.env.ANTHROPIC_API_KEY; }
export function llmProvider() { return preferCli() ? 'claude-cli (subscription, no API key)' : (process.env.ANTHROPIC_API_KEY ? 'anthropic-api' : 'none'); }

function viaClaudeCli(prompt, { system, model, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (system) args.push('--append-system-prompt', system);
    if (model || process.env.SEO_BOT_MODEL) args.push('--model', model || process.env.SEO_BOT_MODEL);
    let out = '', done = false;
    let p;
    try { p = spawn(CLAUDE, args, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve(null); }
    const timer = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch { /* */ } resolve(null); } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
    p.on('close', () => {
      if (done) return; done = true; clearTimeout(timer);
      try { const j = JSON.parse(out); resolve(j.is_error ? null : ((j.result || '').trim() || null)); }
      catch { resolve(null); } // asked for --output-format json; non-JSON stdout = failure → fail closed (never treat a CLI banner as a real completion)
    });
  });
}

async function viaApi(prompt, { system, model, maxTokens } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const m = model || process.env.SEO_BOT_MODEL || 'claude-sonnet-4-6';
    const msg = await client.messages.create({ model: m, max_tokens: maxTokens || 700, system, messages: [{ role: 'user', content: prompt }] });
    return { text: (msg.content?.[0]?.text || '').trim(), usage: msg.usage, model: m };
  } catch { return null; }
}

/** One completion. Prefers the Claude Code subscription; falls back to the API; else null. */
export async function complete(prompt, { system, model, maxTokens = 700, client = null, tag = '' } = {}) {
  if (preferCli()) {
    const text = await viaClaudeCli(prompt, { system, model });
    if (text) return text;
    // CLI present but failed (e.g. 401/unauthed) → try the API key if one exists, else null.
  }
  const r = await viaApi(prompt, { system, model, maxTokens });
  if (r?.text) { try { const { recordUsage } = await import('./cost.mjs'); recordUsage(client, r.model, r.usage, { tag }); } catch { /* */ } return r.text; }
  return null;
}
