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
let chromium, DRIVER;
try { ({ chromium } = await import('patchright')); DRIVER = 'patchright'; }
catch { ({ chromium } = await import('playwright')); DRIVER = 'playwright ⚠ DETECTABLE — run `npm i patchright && npx patchright install chromium` on the Mac'; }
import { readFileSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
const DELAY = Number(process.env.DELAY_MS || S.delayMs || 4000);
const OUT_DIR = join(ROOT, S.outDir || 'data/ai-visibility');

const BRAND_TERMS = [cfg.brand, ...(cfg.aliases || [])].map(t => t.toLowerCase());
const COMPETITORS = cfg.competitors || [];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// Geo-pin Google to a city (uule) so results aren't biased to the Mac Mini's IP city — the
// one real way automation changes WHAT you observe (AIO/AI-Mode are location-personalized).
function uuleFor(loc) {
  if (!loc) return '';
  // Canonical-name uule: 'w+CAIQICI' + SECRET[len(name) % 64] + base64(name). The length char
  // comes from this fixed 64-char alphabet (NOT the raw char code) or Google ignores the param.
  const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const name = String(loc);
  const b64 = Buffer.from(name, 'utf-8').toString('base64');
  return 'w+CAIQICI' + SECRET[name.length % 64] + b64;
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
function firstIndexOfAny(haystack, terms) {
  let min = -1;
  for (const t of terms) {
    if (!t) continue;
    const i = haystack.indexOf(t.toLowerCase());
    if (i !== -1 && (min === -1 || i < min)) min = i;
  }
  return min;
}

function analyze(answer, citations) {
  const text = (answer || '').toLowerCase();
  const brandIdx = firstIndexOfAny(text, BRAND_TERMS);
  const mentioned = brandIdx !== -1;
  let mentionCount = 0;
  for (const t of BRAND_TERMS) {
    if (!t) continue;
    mentionCount += text.split(t.toLowerCase()).length - 1;
  }

  // Position: rank our brand among all tracked entities (brand + competitors)
  // by order of first appearance in the answer. 1 = named first.
  const entities = [{ name: cfg.brand, idx: brandIdx }];
  const compsMentioned = [];
  for (const c of COMPETITORS) {
    const i = text.indexOf(c.toLowerCase());
    if (i !== -1) { entities.push({ name: c, idx: i }); compsMentioned.push(c); }
  }
  const present = entities.filter(e => e.idx !== -1).sort((a, b) => a.idx - b.idx);
  const position = mentioned ? present.findIndex(e => e.name === cfg.brand) + 1 : null;

  // Citations: did the engine cite OUR domain?
  const citedDomains = [...new Set((citations || []).map(c => {
    try { return new URL(c.url).hostname.replace(/^www\./, ''); } catch { return null; }
  }).filter(Boolean))];
  const cited = citedDomains.some(d => d.includes(cfg.domain.replace(/^www\./, '')));

  return { mentioned, position, mentionCount, cited, citedDomains, competitorsMentioned: compsMentioned };
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
async function main() {
  const engines = (cfg.engines || ['perplexity', 'google_aio']).filter(e => ENGINES[e]);
  log(`\n  AI Visibility Tracker — brand: "${cfg.brand}"  (domain ${cfg.domain})`);
  log(`  Engines: ${engines.join(', ')}  ·  Prompts: ${cfg.prompts.length}  ·  ${HEADFUL ? 'headful' : 'headless'}\n`);

  log(`  Driver: ${DRIVER}`);
  const launchOpts = { headless: !HEADFUL, channel: 'chrome' }; // real Chrome → genuine TLS/UA
  if (process.env.PROXY_SERVER) {
    launchOpts.proxy = { server: process.env.PROXY_SERVER, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD };
    log(`  Proxy: ${process.env.PROXY_SERVER}`);
  }
  let browser;
  try { browser = await chromium.launch(launchOpts); }
  catch (e) { log(`  channel:chrome unavailable (${String(e.message || e).slice(0, 60)}) — using bundled browser`); delete launchOpts.channel; browser = await chromium.launch(launchOpts); }

  // No hard-coded UA: a Windows-Chrome UA on a Mac (or on Firefox/Camoufox) is a fingerprint
  // mismatch tell. Let the real browser's UA stand (channel:chrome supplies a correct one).
  const ctxOpts = {
    locale: S.locale || 'en-US',
    viewport: { width: 1366, height: 900 },
  };
  // ChatGPT needs an authenticated session you capture once (see README).
  const chatgptStorage = process.env.CHATGPT_STORAGE;
  const results = [];

  for (const engine of engines) {
    const useStorage = engine === 'chatgpt' && chatgptStorage && existsSync(chatgptStorage);
    if (engine === 'chatgpt' && !useStorage) {
      log(`  ⏭  Skipping chatgpt — set CHATGPT_STORAGE for a logged-in session (README). For measurement prefer chatgpt_free; the authed path injects YOUR account's memory/personalization.`);
      continue;
    }

    for (const prompt of cfg.prompts) {
      // FRESH context per prompt → the engine can't learn the brand from our own earlier
      // prompts (self-contamination); no chat-memory / cookie carryover between prompts.
      const context = await browser.newContext(useStorage ? { ...ctxOpts, storageState: chatgptStorage } : ctxOpts);
      const page = await context.newPage();
      process.stdout.write(`  [${engine}] "${prompt.slice(0, 48)}${prompt.length > 48 ? '…' : ''}" `);
      let row = { engine, prompt, ts: new Date().toISOString() };
      try {
        const { answer, citations, note, organicRank } = await ENGINES[engine](page, prompt);
        const blocked = await detectBlocked(page);
        const a = analyze(answer, citations);
        // google_organic has no "answer" — its signal is OUR domain's rank within the results.
        if (engine === 'google_organic') { a.position = organicRank ?? null; a.mentioned = organicRank != null; a.cited = organicRank != null; }
        // status: answered (real data) · absent (engine genuinely showed no answer block — a real 0,
        //         counted) · blocked (bot-challenge/consent/empty — OUR scraper failed, EXCLUDE).
        const status = blocked ? 'blocked' : (note ? 'absent' : 'answered');
        row = { ...row, ...a, note: note || null, status, answerExcerpt: (answer || '').replace(/\s+/g, ' ').slice(0, 280) };
        log(blocked ? `⊘ blocked (bot-challenge/consent — excluded, NOT a real 0)`
          : engine === 'google_organic' ? (a.position ? `✓ organic #${a.position}` : '✗ not in top-20')
          : (a.mentioned ? `✓ mentioned (pos ${a.position}${a.cited ? ', cited' : ''})` : (note ? `– ${note}` : '✗ not mentioned')));
      } catch (err) {
        row.error = String(err).slice(0, 200);
        log(`⚠ ${row.error}`);
      } finally {
        try { await context.close(); } catch { /* never let a wedged close abort the run + lose all output */ }
      }
      results.push(row);
      await sleep(DELAY);
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

main().catch(err => { console.error('\nTracker failed:', err); process.exit(1); });
