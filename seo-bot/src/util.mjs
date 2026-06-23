// seo-bot · shared utilities (zero deps beyond Node built-ins)
//
// The bot fetches RAW HTML (no JS execution) on purpose: that is what the AI
// crawlers (GPTBot/ClaudeBot/PerplexityBot) and the initial Googlebot pass see.
// If content only exists after hydration, it is invisible to answer engines —
// so "what plain fetch returns" is the ground truth we audit against.

export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// A UA that identifies us honestly as an auditing bot for sites WE own.
export const BOT_UA =
  'seo-bot/1.0 (+https://nobsmedspareviews.com; site self-audit)';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch() with a hard timeout + sane defaults. Returns { ok, status, text, headers, ms, error }. */
export async function fetchPage(url, { timeoutMs = 15000, ua = DESKTOP_UA, method = 'GET' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const text = method === 'HEAD' ? '' : await res.text();
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url || url,
      text,
      headers: res.headers,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { ok: false, status: 0, finalUrl: url, text: '', headers: null, ms: Date.now() - started, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

/** Fetch following redirects ONE HOP AT A TIME so the chain is visible (not collapsed).
 *  Returns { chain:[{url,status,location}], finalUrl, status, text, headers, loop }. */
export async function fetchWithChain(url, { timeoutMs = 15000, ua = DESKTOP_UA, maxHops = 8, wantBody = true } = {}) {
  const chain = [];
  let current = url;
  const seen = new Set();
  for (let hop = 0; hop <= maxHops; hop++) {
    if (seen.has(current)) return { chain, finalUrl: current, status: chain.at(-1)?.status || 0, text: '', headers: null, loop: true };
    seen.add(current);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(current, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' } });
      const loc = res.headers.get('location');
      chain.push({ url: current, status: res.status, location: loc || null });
      if (res.status >= 300 && res.status < 400 && loc) { current = absUrl(current, loc) || loc; clearTimeout(t); continue; }
      const text = wantBody ? await res.text() : '';
      clearTimeout(t);
      return { chain, finalUrl: current, status: res.status, text, headers: res.headers, loop: false };
    } catch (err) {
      clearTimeout(t);
      chain.push({ url: current, status: 0, location: null, error: String(err?.message || err) });
      return { chain, finalUrl: current, status: 0, text: '', headers: null, loop: false };
    }
  }
  return { chain, finalUrl: current, status: chain.at(-1)?.status || 0, text: '', headers: null, loop: false, truncated: true };
}

/** Parse robots directives from an X-Robots-Tag header value or a meta-robots content string. */
export function parseRobotsDirectives(value) {
  const v = (value || '').toLowerCase();
  return { noindex: /\bnoindex\b/.test(v), nofollow: /\bnofollow\b/.test(v), nosnippet: /\bnosnippet\b/.test(v), noarchive: /\bnoarchive\b/.test(v), noimageindex: /\bnoimageindex\b/.test(v), maxSnippet: (v.match(/max-snippet:\s*(-?\d+)/) || [])[1] ?? null, maxImagePreview: (v.match(/max-image-preview:\s*(\w+)/) || [])[1] ?? null };
}

export function normalizeHost(h) {
  return (h || '').replace(/^www\./i, '').toLowerCase();
}

export function hostOf(url) {
  try { return normalizeHost(new URL(url).hostname); } catch { return ''; }
}

export function sameSite(a, b) {
  return hostOf(a) && hostOf(a) === hostOf(b);
}

/** Resolve href against a base; return absolute URL or null. */
export function absUrl(base, href) {
  if (!href) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
}

export function countWords(s) {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function nowIso() { return new Date().toISOString(); }

export function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

/** Stable, dependency-free slug for filenames. */
export function slugify(s) {
  return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';
}

/** Severity ordering for sorting/prioritization. */
export const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
