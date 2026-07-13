// seo-bot · measure/scrapling — the bridge to the scraper/fetch.py Camoufox/Scrapling sidecar.
// One place that knows how to shell out to the Python stealth fetcher, so the SERP lane AND blog
// harvesting share it. Camoufox (a hardened anti-detect Firefox) defeats Cloudflare/Google
// bot-walls that plain fetch and even patchright cannot — but it's Mac-Mini-only (needs the
// residential IP) and slower, so callers use it as a FALLBACK for blocked pages, not the default.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';

/** Resolve the sidecar's python + script, or null when the venv isn't set up on this host. */
export function scraplingPaths() {
  const py = process.env.SEO_BOT_SCRAPLING_PY || join(ROOT, 'scraper', '.venv', 'bin', 'python');
  const script = join(ROOT, 'scraper', 'fetch.py');
  return (existsSync(py) && existsSync(script)) ? { python: py, script } : null;
}

/** Fetch one URL's HTML via the sidecar. mode 'page' (curl-impersonate, fast) or 'stealth'
 *  (Camoufox, solves Cloudflare/consent). Returns { ok, blocked, html, status, note }. */
export async function sidecarFetch(url, { python, script, mode = 'stealth', timeout = 70000 } = {}) {
  if (!python || !script) return { ok: false, blocked: false, html: '', note: 'no sidecar' };
  return new Promise((resolve) => {
    execFile(python, [script, '--mode', mode, '--url', url, '--timeout', String(timeout)],
      { maxBuffer: 48 * 1024 * 1024, timeout: timeout + 30000, env: { ...process.env } },
      (err, stdout) => {
        if (!stdout) return resolve({ ok: false, blocked: false, html: '', note: String(err?.message || err || 'no output').slice(0, 160) });
        try { const j = JSON.parse(String(stdout).trim().split('\n').pop()); resolve({ ok: !!j.ok, blocked: !!j.blocked, html: j.html || '', status: j.status || null, note: (j.notes || []).join('; ') }); }
        catch { resolve({ ok: false, blocked: false, html: '', note: 'unparseable sidecar output' }); }
      });
  });
}

/** Build a fetchOne(url)→html|null that tries a plain polite fetch first, then falls back to the
 *  Camoufox sidecar on a hard block (403/429/503/empty). For harvesting blogs behind Cloudflare.
 *  When no sidecar is configured it degrades to plain fetch — nothing hard-breaks off the Mini. */
export function makeResilientFetchOne({ python = null, script = null, log = () => {}, delayMs = 400 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return async (url) => {
    if (delayMs) await sleep(delayMs);
    let hardBlock = false;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'seo-bot/1.0 (+contact via nobsmedspareviews.com)' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) { const t = await r.text(); if (t && t.length > 500) return t; return null; }
      hardBlock = [403, 429, 503].includes(r.status);
    } catch { hardBlock = true; }
    if (!hardBlock || !python) return null;
    const s = await sidecarFetch(url, { python, script, mode: 'stealth' });
    if (s.ok && s.html) { log(`    ↺ Camoufox recovered ${url}`); return s.html; }
    return null;
  };
}
