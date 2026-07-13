// seo-bot · research/fetcher — acquisition layer for the daily research routine.
//
// Node does the cheap paths natively (no Python): X tweets via the syndication
// JSON endpoint, RSS feeds, and plain HTML with browser-ish headers. It shells out
// to the Scrapling Python sidecar ONLY for `stealth` (Cloudflare / JS-walled pages).
//
// IMPORTANT: everything returned here is a CLAIM, not a fact. It must pass through
// credibility.mjs before anything influences the bot. Stealth ≠ auth bypass.

import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPage, sleep, hostOf } from '../util.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(__dirname, '..', '..', 'scraper', 'fetch.py');
const PYTHON = process.env.SEO_BOT_PYTHON || 'python';

const _cache = new Map();          // url -> { at, data }
const _lastHostHit = new Map();    // host -> ts (politeness)
const CACHE_MS = 15 * 60 * 1000;

async function polite(url, minGapMs = 1500) {
  const h = hostOf(url);
  const last = _lastHostHit.get(h) || 0;
  const wait = minGapMs - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  _lastHostHit.set(h, Date.now());
}

/** yt-dlp deterministic syndication token (fallback to 'a' which works today). */
export function syndicationToken(id) {
  try { return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '') || 'a'; }
  catch { return 'a'; }
}

/** Fetch ONE X/Twitter post by id via the public syndication endpoint (no auth). */
export async function fetchTweet(idOrUrl) {
  const id = String(idOrUrl).trim().split('/').pop().split('?')[0];
  const notes = [];
  for (const token of ['a', syndicationToken(id)]) {
    const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token}`;
    await polite(url);
    const res = await fetchPage(url, { timeoutMs: 15000 });
    if (res.ok && res.text && res.text.trim() !== '{}' && res.text.trim() !== 'null') {
      let d; try { d = JSON.parse(res.text); } catch { notes.push(`token=${token}: unparseable`); continue; }
      if (!d || d.__typename === 'TweetTombstone') { notes.push(`token=${token}: tombstone/empty`); continue; }
      const u = d.user || {};
      return {
        ok: true, mode: 'tweet', id, sourceKey: `x:@${(u.screen_name || '').toLowerCase()}`, url: `https://x.com/${u.screen_name}/status/${id}`,
        fetchedAt: new Date().toISOString(), usedStealth: false, via: 'node',
        text: d.text || '', createdAt: d.created_at,
        user: { screenName: u.screen_name, name: u.name, verified: !!(u.verified || u.is_blue_verified) },
        favoriteCount: d.favorite_count, conversationCount: d.conversation_count,
        urls: ((d.entities || {}).urls || []).map(e => e.expanded_url).filter(Boolean),
        notes,
      };
    }
    notes.push(`token=${token}: status=${res.status}`);
  }
  return { ok: false, mode: 'tweet', id, fetchedAt: new Date().toISOString(),
    notes: [...notes, 'no tweet from syndication endpoint (deleted/protected/age-gated, or try stealth on the x.com URL — ToS-restricted)'] };
}

/** Plain HTML/JSON fetch with browser headers (no stealth). */
export async function fetchPlain(url) {
  await polite(url);
  const res = await fetchPage(url, { timeoutMs: 15000 });
  return { ok: res.ok && res.status === 200, mode: 'page', url, status: res.status,
    fetchedAt: new Date().toISOString(), usedStealth: false, via: 'node', html: res.ok ? res.text : '',
    notes: res.ok ? [] : [`status=${res.status}${res.error ? ` ${res.error}` : ''}`] };
}

/** RSS/Atom feed → items[]. Minimal parser; good enough for practitioner/YT feeds.
 *  Uses fetchSmart so a Cloudflare-walled feed escalates to the stealth sidecar. */
export async function fetchRss(url) {
  const r = await fetchSmart(url);
  const items = [];
  if (r.ok) {
    const blocks = r.html.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
    for (const blk of blocks.slice(0, 40)) {
      const title = (blk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const link = (blk.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || (blk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '';
      const pub = (blk.match(/<(?:pubDate|updated|published)[^>]*>([\s\S]*?)<\/(?:pubDate|updated|published)>/i) || [])[1] || '';
      items.push({ title: title.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim(), link: link.trim(), published: pub.trim() });
    }
  }
  return { ok: items.length > 0, mode: 'rss', url, fetchedAt: new Date().toISOString(), items, notes: r.notes };
}

/** Stealth fetch via the Scrapling sidecar (Cloudflare / JS walls). */
export function fetchStealth(url, { timeout = 60000, proxy = null } = {}) {
  return new Promise((resolve) => {
    const args = [SIDECAR, '--mode', 'stealth', '--url', url, '--timeout', String(Math.max(timeout, 60000))];
    if (proxy) args.push('--proxy', proxy);
    execFile(PYTHON, args, { timeout: Math.max(timeout, 60000) + 20000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return resolve({ ok: false, mode: 'stealth', url, notes: [`sidecar failed: ${String(err.message || err).slice(0, 160)}`, 'is python + scrapling installed? see seo-bot/scraper/README.md'] });
      try { resolve(JSON.parse((stdout || '').trim().split('\n').filter(Boolean).pop())); }
      catch { resolve({ ok: false, mode: 'stealth', url, notes: ['unparseable sidecar output'] }); }
    });
  });
}

/** Smart fetch: plain first, escalate to stealth on 403/Cloudflare. */
export async function fetchSmart(url) {
  const cached = _cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  let r = await fetchPlain(url);
  const looksBlocked = !r.ok && [403, 429, 503].includes(r.status);
  const looksCloudflare = r.ok && /just a moment|cf-challenge|enable javascript and cookies/i.test(r.html.slice(0, 4000));
  if (looksBlocked || looksCloudflare) {
    const s = await fetchStealth(url);
    if (s.ok) r = s;
  }
  _cache.set(url, { at: Date.now(), data: r });
  return r;
}
