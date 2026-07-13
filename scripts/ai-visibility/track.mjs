#!/usr/bin/env node
/**
 * AI Visibility Tracker — the no-API way.
 *
 * Measures how a brand shows up in AI answer engines (ChatGPT, Perplexity,
 * Google AI Overviews) the way real users see them — by driving the actual
 * consumer web apps with a real browser, NOT the API.
 *
 * Why not the API: the OpenAI/Gemini APIs are a different product — no/inconsistent
 * web search, ~25% of answers carry no sources, and only ~4% of sources overlap
 * with the real web UI. Measuring via the API measures something your customers
 * never see. So we run the prompt set through the consumer surfaces and parse
 * the rendered answer + citations per engine.
 *
 * For each (prompt, engine) we capture: Visibility (mentioned?), Position
 * (rank among tracked brands by first appearance), Mentions (count), and
 * Citations (which URLs the engine pulled, and whether our domain is among them).
 *
 * Usage:
 *   npm run track:ai                       # uses scripts/ai-visibility/prompts.json
 *   HEADFUL=1 npm run track:ai             # watch it run (helps beat anti-bot)
 *   PROXY_SERVER=http://host:port PROXY_USERNAME=u PROXY_PASSWORD=p npm run track:ai
 *   CHATGPT_STORAGE=./chatgpt-auth.json npm run track:ai   # enable ChatGPT (needs login session)
 *
 * See README.md in this folder for proxy + ChatGPT-auth setup.
 *
 * NOTE: This drives third-party consumer apps; selectors drift and the engines
 * actively bot-block. Run from a residential IP (or proxy), keep volume modest,
 * and expect to tweak the per-engine selectors over time. This is a measurement
 * tool for your OWN brand visibility — standard GEO practice.
 */

// Prefer Patchright (patches the Runtime.enable / navigator.webdriver CDP leaks that vanilla
// Playwright exposes — the signals that get a logged-out ChatGPT session killed by Cloudflare
// Turnstile and a headless Google session served a CAPTCHA). Falls back to playwright if
// patchright isn't installed (`npm i patchright && npx patchright install chromium`).
import { launchBrowser } from '../../src/measure/browser.mjs';
import { extractAnswerPosition } from '../../src/measure/answer-position.mjs';
import { isChallenge, humanDelayMs, inCooldown, makeGovernor, SAFE_DEFAULTS } from '../../src/measure/capture-governor.mjs';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const cfgPath = process.env.PROMPTS || join(__dirname, 'prompts.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
const S = cfg.settings || {};
const HEADFUL = process.env.HEADFUL === '1' || S.headful === true;
const TIMEOUT = Number(process.env.TIMEOUT_MS || S.timeoutMs || 45000);
// Hard wall-clock cap on ONE (engine,prompt) capture. The per-op timeouts above only bound
// individual awaits; a browser op that never settles (hung nav, wedged context) would otherwise
// freeze the whole run and starve later engines — that's the 20-min-watchdog-kills-everything bug.
const CAPTURE_HARD_MS = Number(process.env.CAPTURE_HARD_MS || S.captureHardMs || (TIMEOUT * 3 + 15000));
const DELAY = Number(process.env.DELAY_MS || S.delayMs || 4000);

/** Race a capture against a hard timeout. Fail-closed: a timeout resolves to an EXCLUDED
 *  error row (status:'error'), never a fabricated "not mentioned". Pure/testable. */
export function withHardTimeout(promise, ms, label = 'capture') {
  let t;
  const guard = new Promise((resolve) => { t = setTimeout(() => resolve({ status: 'error', error: `hard-timeout ${ms}ms (${label})`, mentioned: false, cited: false, position: null }), ms); });
  return Promise.race([Promise.resolve(promise).then((v) => { clearTimeout(t); return v; }, (e) => { clearTimeout(t); return { status: 'error', error: String(e).slice(0, 200), mentioned: false, cited: false, position: null }; }), guard]);
}
// N-sampling: AI answers are non-deterministic (~10-34% run-to-run), so capture each
// (prompt,engine) SAMPLES times and report "appeared in k of N" + median rank. Default 1
// for back-compat; set settings.samples:3 (or env SAMPLES) for a stable reading.
const SAMPLES = Math.max(1, Number(process.env.SAMPLES || S.samples || 1));
const OUT_DIR = join(ROOT, S.outDir || 'data/ai-visibility');

const BRAND_TERMS = [cfg.brand, ...(cfg.aliases || [])].map(t => t.toLowerCase());
const COMPETITORS = cfg.competitors || [];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// Geo-pin Google to a city (uule) so results aren't biased to the Mac Mini's IP city — the
// one real way automation changes WHAT you observe (AIO/AI-Mode are location-personalized).
export function uuleFor(loc) {
  if (!loc) return '';
  // Canonical-name uule: 'w+CAIQICI' + SECRET[len(name) % 64] + base64(name). The length char
  // comes from this fixed 64-char alphabet (NOT the raw char code) or Google ignores the param.
  const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const name = String(loc);
  const b64 = Buffer.from(name, 'utf-8').toString('base64');
  return 'w+CAIQICI' + SECRET[Buffer.from(name, 'utf-8').byteLength % 64] + b64;
}
const UULE = cfg.location ? `&uule=${encodeURIComponent(uuleFor(cfg.location))}` : '';

// A flagged session (consent wall / reCAPTCHA "unusual traffic" / Turnstile / empty SERP) has
// NO answer block to parse. Recording that as "not mentioned" is a FALSE NEGATIVE that
// understates visibility — it's a failure of OUR scraper, not a ranking signal. Detect it so
// blocked rows are EXCLUDED from the denominator (vs a genuinely-absent AIO, which is a real 0).
async function detectBlocked(page) {
  try {
    if (/consent\.google\.com|\/sorry\/|sorry\.google|challenges\.cloudflare/i.test(page.url())) return true;
    return await page.evaluate(() => {
      const t = (document.body.innerText || '').toLowerCase();
      if (/unusual traffic|detected unusual|are you a robot|verify you.?re human|enable javascript and cookies|before you continue/.test(t)) return true;
      return !!document.querySelector('iframe[src*="challenges.cloudflare"], iframe[title*="challenge" i], #recaptcha, form#captcha, #captcha-form');
    });
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Whole-word/phrase match (case-insensitive) — avoids substring false positives like brand
// "Glow" matching "glowing" or "Ave" matching "average". Returns first index + count.
export function matchInfo(text, terms) {
  const t = (text || '').toLowerCase();
  let first = -1, count = 0;
  for (const term of terms) {
    if (!term) continue;
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(String(term).toLowerCase())}(?![a-z0-9])`, 'g');
    let m;
    while ((m = re.exec(t)) !== null) { count++; if (first === -1 || m.index < first) first = m.index; if (m.index === re.lastIndex) re.lastIndex++; }
  }
  return { first, count };
}

// Exact-or-subdomain host match — "nobsmedspareviews.com" must not match
// "notnobsmedspareviews.com" (substring bug) nor "nobsmedspareviews.com.evil.com".
function domainMatches(host, mine) {
  if (!mine) return false;
  return host === mine || host.endsWith('.' + mine);
}

export function analyze(answer, citations) {
  const text = (answer || '').toLowerCase();
  const bm = matchInfo(text, BRAND_TERMS);
  const mentioned = bm.first !== -1;

  const entities = [{ name: cfg.brand, idx: bm.first }];
  const compsMentioned = [];
  for (const c of COMPETITORS) {
    const ci = matchInfo(text, [c]).first;
    if (ci !== -1) { entities.push({ name: c, idx: ci }); compsMentioned.push(c); }
  }
  const present = entities.filter(e => e.idx !== -1).sort((a, b) => a.idx - b.idx);
  const position = mentioned ? present.findIndex(e => e.name === cfg.brand) + 1 : null;

  const citedDomains = [...new Set((citations || []).map(c => {
    try { return new URL(c.url).hostname.replace(/^www\./, ''); } catch { return null; }
  }).filter(Boolean))];
  const myDomain = (cfg.domain || '').replace(/^www\./, '').toLowerCase();
  const cited = citedDomains.some(d => domainMatches(d, myDomain));

  return { mentioned, position, mentionCount: bm.count, cited, citedDomains, competitorsMentioned: compsMentioned };
}

// Aggregate N samples of one (prompt,engine). Excludes blocked samples (scraper failure);
// reports mentionRate = "appeared in k of N", median rank, citedRate. A reading "counts" as
// mentioned/cited only if it persists across the majority of runs (>=50%) — kills outliers.
export function aggregateSamples(samples) {
  // Valid = answered OR genuinely-absent. Excludes blocked AND errored (scraper failures) —
  // a timeout must never be counted as a real "not mentioned" (fail-closed).
  const valid = (samples || []).filter(s => s && !s.error && s.status !== 'blocked');
  const n = valid.length;
  if (!n) return { samples: 0, status: 'blocked', mentioned: false, mentionRate: 0, position: null, cited: false, citedRate: 0, answerPosition: null, listSize: null, firstMentionCharRatio: null };
  const ment = valid.filter(s => s.mentioned).length;
  const cit = valid.filter(s => s.cited).length;
  const ps = valid.filter(s => s.position).map(s => s.position).sort((a, b) => a - b);
  const median = ps.length ? ps[Math.floor((ps.length - 1) / 2)] : null;
  const status = valid.some(s => s.status === 'answered') ? 'answered' : 'absent';
  // WHERE-in-the-answer fields (measure/answer-position.mjs). Additive + null-safe:
  // samples from old captures without these fields simply contribute nothing (null out).
  const medianOf = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
  const answerPosition = medianOf(valid.map(s => s.answerPosition));
  const listSize = medianOf(valid.map(s => s.listSize));
  const ratios = valid.map(s => s.firstMentionCharRatio).filter(r => typeof r === 'number' && Number.isFinite(r));
  const firstMentionCharRatio = ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 1000) / 1000 : null;
  return { samples: n, status, mentioned: ment / n >= 0.5, mentionRate: Math.round((ment / n) * 100), position: median, cited: cit / n >= 0.5, citedRate: Math.round((cit / n) * 100), answerPosition, listSize, firstMentionCharRatio };
}

// ---------------------------------------------------------------------------
// Engine adapters  — each returns { answer, citations:[{title,url}], note }
// Selectors are defensive + may need updating as the sites change.
// ---------------------------------------------------------------------------
async function extractCitations(page, scopeSel) {
  // Grab external anchor hrefs inside the answer scope.
  return page.evaluate((sel) => {
    const root = sel ? (document.querySelector(sel) || document.body) : document.body;
    const out = [];
    const seen = new Set();
    root.querySelectorAll('a[href^="http"]').forEach(a => {
      const u = a.href;
      try {
        const host = new URL(u).hostname;
        if (host.includes('google.') || host.includes('perplexity.ai') || host.includes('openai.com') || host.includes('bing.com')) return;
        if (seen.has(u)) return; seen.add(u);
        out.push({ title: (a.textContent || '').trim().slice(0, 120), url: u });
      } catch {}
    });
    return out.slice(0, 40);
  }, scopeSel);
}

const ENGINES = {
  // --- Perplexity ---------------------------------------------------------
  async perplexity(page, prompt) {
    await page.goto('https://www.perplexity.ai/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    const box = page.locator('textarea, [contenteditable="true"]').first();
    await box.waitFor({ timeout: TIMEOUT });
    await box.click();
    await box.fill(prompt).catch(async () => { await box.type(prompt, { delay: 12 }); });
    await page.keyboard.press('Enter');
    // Wait for an answer to render + settle.
    await page.waitForSelector('.prose, [class*="prose"], main', { timeout: TIMEOUT }).catch(() => {});
    await sleep(7000); // let the answer + sources stream in
    const answer = await page.evaluate(() => {
      const el = document.querySelector('.prose, [class*="prose"]') || document.querySelector('main');
      return el ? el.innerText : document.body.innerText;
    });
    const citations = await extractCitations(page, 'main');
    return { answer, citations };
  },

  // --- Google AI Overviews ------------------------------------------------
  async google_aio(page, prompt) {
    const q = encodeURIComponent(prompt);
    await page.goto(`https://www.google.com/search?q=${q}&hl=en&gl=us&pws=0${UULE}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    // consent screen (EU/sometimes US)
    const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree"), #L2AGLb').first();
    if (await consent.isVisible().catch(() => false)) { await consent.click().catch(() => {}); await sleep(1500); }
    await sleep(4000);
    const data = await page.evaluate(() => {
      // Find a block that looks like the AI Overview (text + "AI Overview" label).
      const labels = Array.from(document.querySelectorAll('*')).filter(e => /AI Overview/i.test(e.textContent || '') && e.children.length < 25);
      let block = null;
      for (const l of labels) { let p = l; for (let i = 0; i < 6 && p; i++) p = p.parentElement; if (p) { block = p; break; } }
      if (!block) return { present: false, answer: '', citations: [] };
      const answer = block.innerText || '';
      const citations = [];
      const seen = new Set();
      block.querySelectorAll('a[href^="http"]').forEach(a => {
        try { const h = new URL(a.href).hostname; if (h.includes('google.')) return; if (seen.has(a.href)) return; seen.add(a.href);
          citations.push({ title: (a.textContent || '').trim().slice(0, 120), url: a.href }); } catch {}
      });
      return { present: true, answer, citations: citations.slice(0, 40) };
    });
    if (!data.present) return { answer: '', citations: [], note: 'No AI Overview shown for this query' };
    return { answer: data.answer, citations: data.citations };
  },

  // --- ChatGPT (requires a logged-in session via CHATGPT_STORAGE) ---------
  async chatgpt(page, prompt) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    const composer = page.locator('#prompt-textarea, textarea, [contenteditable="true"]').first();
    await composer.waitFor({ timeout: TIMEOUT });
    await composer.click();
    await composer.type(prompt, { delay: 10 });
    await page.keyboard.press('Enter');
    // Wait for streaming to finish: the stop button disappears when done.
    await sleep(3000);
    await page.waitForFunction(() => !document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"]'), { timeout: TIMEOUT }).catch(() => {});
    await sleep(2000);
    const answer = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = msgs[msgs.length - 1];
      return last ? last.innerText : '';
    });
    const citations = await extractCitations(page, '[data-message-author-role="assistant"]:last-of-type');
    return { answer, citations };
  },

  // --- ChatGPT FREE (logged-OUT, no storage — the Peec-AI way) ------------
  // chatgpt.com lets you ask without an account; dismiss the login nudge and prompt it.
  async chatgpt_free(page, prompt) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(2500);
    for (const sel of ['a:has-text("Stay logged out")', 'button:has-text("Stay logged out")', 'a:has-text("stay logged out")', '[aria-label="Close dialog"]', 'button[aria-label="Close"]', 'button:has-text("Dismiss")']) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) { await el.click().catch(() => {}); await sleep(800); break; }
    }
    await page.keyboard.press('Escape').catch(() => {});
    const composer = page.locator('#prompt-textarea, textarea, [contenteditable="true"]').first();
    await composer.waitFor({ timeout: TIMEOUT });
    await composer.click();
    await composer.type(prompt, { delay: 10 });
    await page.keyboard.press('Enter');
    await sleep(4000);
    await page.waitForFunction(() => !document.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"]'), { timeout: TIMEOUT }).catch(() => {});
    await sleep(3000);
    const answer = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      const last = msgs[msgs.length - 1];
      return last ? last.innerText : (document.querySelector('main')?.innerText || '');
    });
    const citations = await extractCitations(page, '[data-message-author-role="assistant"]:last-of-type');
    return { answer, citations, note: answer ? null : 'no answer (login wall / bot-block — run HEADFUL on a residential IP)' };
  },

  // --- Google AI Mode (udm=50) -------------------------------------------
  async google_aimode(page, prompt) {
    const q = encodeURIComponent(prompt);
    await page.goto(`https://www.google.com/search?q=${q}&udm=50&hl=en&gl=us&pws=0${UULE}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree"), #L2AGLb').first();
    if (await consent.isVisible().catch(() => false)) { await consent.click().catch(() => {}); await sleep(1500); }
    await sleep(6000); // AI Mode streams its answer + sources
    const data = await page.evaluate(() => {
      const main = document.querySelector('#main, #rcnt, [role="main"], main') || document.body;
      const answer = main.innerText || '';
      const citations = []; const seen = new Set();
      main.querySelectorAll('a[href^="http"]').forEach((a) => {
        try { const h = new URL(a.href).hostname; if (h.includes('google.') || h.includes('gstatic')) return; if (seen.has(a.href)) return; seen.add(a.href);
          citations.push({ title: (a.textContent || '').trim().slice(0, 120), url: a.href }); } catch { /* */ }
      });
      return { answer, citations: citations.slice(0, 40) };
    });
    return { answer: data.answer, citations: data.citations, note: data.citations.length ? null : 'no AI Mode response parsed (may not be rolled out for this query/region)' };
  },

  // --- Google ORGANIC (normal SEO rankings) — top-20 domains + our position
  async google_organic(page, prompt) {
    const q = encodeURIComponent(prompt);
    await page.goto(`https://www.google.com/search?q=${q}&num=20&hl=en&gl=us&pws=0${UULE}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    const consent = page.locator('button:has-text("Accept all"), #L2AGLb').first();
    if (await consent.isVisible().catch(() => false)) { await consent.click().catch(() => {}); await sleep(1500); }
    await sleep(2500);
    const results = await page.evaluate(() => {
      const out = []; const seen = new Set();
      document.querySelectorAll('#search a h3, #rso a h3').forEach((h) => {
        const a = h.closest('a'); if (!a) return;
        try { const host = new URL(a.href).hostname.replace(/^www\./, ''); if (host.includes('google.')) return; if (seen.has(host)) return; seen.add(host);
          out.push({ title: (h.textContent || '').trim().slice(0, 120), url: a.href }); } catch { /* */ }
      });
      return out.slice(0, 20);
    });
    const myHost = (cfg.domain || '').replace(/^www\./, '');
    const idx = myHost ? results.findIndex(r => { try { return new URL(r.url).hostname.replace(/^www\./, '').includes(myHost); } catch { return false; } }) : -1;
    return { answer: '', citations: results, organicRank: idx >= 0 ? idx + 1 : null, note: results.length ? null : 'no organic results parsed' };
  },
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
// One capture of (engine,prompt) in a FRESH context, with ONE retry on block/timeout
// (a transient Cloudflare interstitial usually clears on a second pass).
async function captureOnce(ctxFactory, engine, prompt) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const context = await ctxFactory();
    const page = await context.newPage();
    try {
      const { answer, citations, note, organicRank } = await ENGINES[engine](page, prompt);
      const blocked = await detectBlocked(page);
      // SAFETY: is this a human-verification / rate-limit CHALLENGE (not just a missing answer)?
      // If so, flag it — main() halts the WHOLE run and cools down. We never try to solve it.
      const pageText = await page.content().catch(() => '');
      const challenge = isChallenge(`${pageText} ${answer || ''} ${note || ''}`);
      const a = analyze(answer, citations);
      // WHERE in the answer: list rank + first-mention depth (needs the FULL answer text,
      // which only exists here — downstream rows only keep the 280-char excerpt).
      const ap = extractAnswerPosition(answer, cfg.brand, { aliases: cfg.aliases || [] });
      const status = challenge ? 'blocked' : blocked ? 'blocked' : (note ? 'absent' : 'answered');
      const row = { ...a, answerPosition: ap.position, listSize: ap.listSize, firstMentionCharRatio: ap.firstMentionCharRatio, note: note || null, organicRank: organicRank ?? null, status, challenge, answerExcerpt: (answer || '').replace(/\s+/g, ' ').slice(0, 280) };
      await context.close().catch(() => {});
      if (challenge) return row;                                    // do NOT retry into a challenge
      if (status === 'blocked' && attempt === 0) { await sleep(2500); continue; }
      return row;
    } catch (err) {
      await context.close().catch(() => {});
      const challenge = isChallenge(String(err));
      if (challenge) return { error: String(err).slice(0, 200), status: 'blocked', challenge: true, mentioned: false, cited: false, position: null };
      if (attempt === 0) { await sleep(2000); continue; }
      return { error: String(err).slice(0, 200), status: 'error', mentioned: false, cited: false, position: null };
    }
  }
}

async function main() {
  const engines = (cfg.engines || ['perplexity', 'google_aio']).filter(e => ENGINES[e]);
  log(`\n  AI Visibility Tracker — brand: "${cfg.brand}"  (domain ${cfg.domain})`);
  log(`  Engines: ${engines.join(', ')}  ·  Prompts: ${cfg.prompts.length}  ·  ${HEADFUL ? 'headful' : 'headless'}\n`);

  const proxy = process.env.PROXY_SERVER ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD } : undefined;
  const L = await launchBrowser({ headless: !HEADFUL, stealth: true, proxy });
  if (L.status) { console.error(`  no usable browser (${L.status}) — install patchright + system Edge/Chrome`); process.exit(1); }
  const browser = L.browser;
  log(`  Driver: ${L.driver} · channel ${L.channel}${proxy ? ' · proxy' : ''}${L.driver === 'playwright' ? '  ⚠ install patchright for stealth' : ''}`);

  // No hard-coded UA: a Windows-Chrome UA on a Mac (or on Firefox/Camoufox) is a fingerprint
  // mismatch tell. Let the real browser's UA stand (channel:chrome supplies a correct one).
  const ctxOpts = {
    locale: S.locale || 'en-US',
    viewport: { width: 1366, height: 900 },
  };
  // ChatGPT needs an authenticated session you capture once (see README).
  const chatgptStorage = process.env.CHATGPT_STORAGE;
  const results = [];

  // ── SAFETY RAILS (capture-governor) — never get the residential IP banned ──────────────
  // 1) Cooldown gate: if a recent run hit a human-verification challenge, do NOT query at all.
  const cooldownFile = join(ROOT, 'data', 'ai-visibility', '.cooldown');
  const lastChallengeAt = existsSync(cooldownFile) ? (Number(readFileSync(cooldownFile, 'utf8').trim()) || 0) : 0;
  const cd = inCooldown(lastChallengeAt, Date.now(), SAFE_DEFAULTS.cooldownMs);
  if (cd.cooling) {
    log(`  ⏸  In post-challenge cooldown (${Math.round(cd.remainingMs / 60000)} min left) — skipping ALL captures to protect the IP. (Safety rail working, not an error.)`);
    await browser.close().catch(() => {}); process.exit(0);
  }
  // 2) Hard per-run / per-day query cap + human-paced delays.
  const gov = makeGovernor({ maxPerRun: SAFE_DEFAULTS.maxPerRun, maxPerDay: SAFE_DEFAULTS.maxPerDay });
  log(`  Safety: ≤${gov.hardCap()} queries this run · ${Math.round(SAFE_DEFAULTS.minDelayMs / 1000)}-${Math.round(SAFE_DEFAULTS.maxDelayMs / 1000)}s apart · HALT+cooldown on any verify-human/CAPTCHA (never solved).`);
  let halted = false;

  for (const engine of engines) {
    if (halted) break;
    const useStorage = engine === 'chatgpt' && chatgptStorage && existsSync(chatgptStorage);
    if (engine === 'chatgpt' && !useStorage) {
      log(`  ⏭  Skipping chatgpt — set CHATGPT_STORAGE for a logged-in session (README). For measurement prefer chatgpt_free; the authed path injects YOUR account's memory/personalization.`);
      continue;
    }

    for (const prompt of cfg.prompts) {
      if (halted) break;
      if (!gov.allow()) { log(`  ⏹  Query cap reached (${gov.count()}/${gov.hardCap()}) — stopping to stay under the rate limit; remaining prompts roll to the next run.`); halted = true; break; }
      // FRESH context per sample (no self-contamination / memory carryover); sampled SAMPLES×.
      process.stdout.write(`  [${engine}] "${prompt.slice(0, 48)}${prompt.length > 48 ? '…' : ''}" `);
      const ctxFactory = () => browser.newContext(useStorage ? { ...ctxOpts, storageState: chatgptStorage } : ctxOpts);
      const samples = [];
      let lastNote = null, lastExcerpt = '', organicRankAgg = null;
      for (let s = 0; s < SAMPLES; s++) {
        gov.spend();
        const sample = await withHardTimeout(captureOnce(ctxFactory, engine, prompt), CAPTURE_HARD_MS, `${engine}:${prompt.slice(0, 24)}`);
        samples.push(sample);
        if (sample.challenge) {
          try { mkdirSync(dirname(cooldownFile), { recursive: true }); writeFileSync(cooldownFile, String(Date.now())); } catch { /* */ }
          log(`\n  🛑 CHALLENGE (verify-human / rate-limit) — HALTING all captures + ${Math.round(SAFE_DEFAULTS.cooldownMs / 3600000)}h cooldown to protect the IP. We do NOT attempt to solve it.`);
          halted = true; break;
        }
        if (sample.note) lastNote = sample.note;
        if (sample.answerExcerpt) lastExcerpt = sample.answerExcerpt;
        if (sample.organicRank != null) organicRankAgg = sample.organicRank;
        if (s < SAMPLES - 1) await sleep(humanDelayMs(SAFE_DEFAULTS.minDelayMs, SAFE_DEFAULTS.maxDelayMs));
      }
      if (halted) break;
      const row = { engine, prompt, ts: new Date().toISOString(), ...aggregateSamples(samples), note: lastNote, answerExcerpt: lastExcerpt };
      if (engine === 'google_organic') {
        row.position = organicRankAgg ?? null; row.mentioned = organicRankAgg != null; row.cited = organicRankAgg != null;
        row.status = samples.every(s => s.status === 'blocked' || s.status === 'error') ? 'blocked' : 'answered';
      }
      const tag = SAMPLES > 1 && row.status === 'answered' ? ` [${row.mentionRate}% of ${row.samples}]` : '';
      log(row.status === 'blocked' ? `⊘ blocked (excluded, NOT a real 0)`
        : engine === 'google_organic' ? (row.position ? `✓ organic #${row.position}` : '✗ not in top-20')
        : (row.mentioned ? `✓ mentioned (pos ${row.position ?? '—'}${row.cited ? ', cited' : ''})${tag}` : (lastNote ? `– ${lastNote}` : `✗ not mentioned${tag}`)));
      results.push(row);
      await sleep(humanDelayMs(SAFE_DEFAULTS.minDelayMs, SAFE_DEFAULTS.maxDelayMs));
    }
  }
  await browser.close();

  // ---- aggregate + write ----
  const byEngine = {};
  for (const e of engines) {
    const rows = results.filter(r => r.engine === e && !r.error);
    const blocked = rows.filter(r => r.status === 'blocked').length;
    // Denominator = every session that actually rendered (answered OR genuinely-absent). Exclude
    // ONLY blocked (scraper failure). absent rows carry mentioned=false → counted as real misses,
    // so a query where the engine showed no answer correctly drags visibility DOWN, not up.
    const valid = rows.filter(r => r.status !== 'blocked');
    const mentioned = valid.filter(r => r.mentioned).length;
    const cited = valid.filter(r => r.cited).length;
    byEngine[e] = {
      prompts: rows.length,
      answered: valid.length,
      blocked,
      visibility_pct: valid.length ? Math.round((mentioned / valid.length) * 100) : 0,
      cited_pct: valid.length ? Math.round((cited / valid.length) * 100) : 0,
      avg_position: (() => { const ps = valid.filter(r => r.position).map(r => r.position); return ps.length ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 10) / 10 : null; })(),
      // Avg rank inside detected answer lists (answer-position.mjs) — null when no lists detected.
      avg_answer_position: (() => { const ps = valid.map(r => r.answerPosition).filter(Number.isFinite); return ps.length ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 10) / 10 : null; })(),
    };
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = join(OUT_DIR, `${stamp}.json`);
  writeFileSync(outFile, JSON.stringify({ brand: cfg.brand, domain: cfg.domain, ranAt: new Date().toISOString(), summary: byEngine, results }, null, 2));

  // Append a row per engine to a running trend CSV — diff this over weeks to
  // see Visibility/Position move. One file, ever-growing, easy to chart.
  const trendFile = join(OUT_DIR, 'trend.csv');
  const day = new Date().toISOString().slice(0, 10);
  if (!existsSync(trendFile)) writeFileSync(trendFile, 'date,engine,visibility_pct,cited_pct,avg_position,answered,blocked,prompts\n');
  let csv = '';
  for (const [e, s] of Object.entries(byEngine)) {
    csv += `${day},${e},${s.visibility_pct},${s.cited_pct},${s.avg_position ?? ''},${s.answered},${s.blocked || 0},${s.prompts}\n`;
  }
  appendFileSync(trendFile, csv);

  log('\n  ── Summary ─────────────────────────────────────────');
  for (const [e, s] of Object.entries(byEngine)) {
    log(`  ${e.padEnd(12)}  visibility ${String(s.visibility_pct).padStart(3)}%  ·  cited ${String(s.cited_pct).padStart(3)}%  ·  avg pos ${s.avg_position ?? '—'}  (${s.answered}/${s.prompts} answered${s.blocked ? `, ⊘${s.blocked} blocked` : ''})`);
  }
  const totalBlocked = Object.values(byEngine).reduce((n, s) => n + (s.blocked || 0), 0);
  if (totalBlocked) log(`\n  ⚠ ${totalBlocked} session(s) blocked (bot-challenge/consent) — excluded from %s. If high, run HEADFUL + verify the residential IP isn't flagged.`);
  log(`\n  Full results → ${outFile}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(err => { console.error('\nTracker failed:', err); process.exit(1); });
