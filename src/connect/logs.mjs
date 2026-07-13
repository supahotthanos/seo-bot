// seo-bot · connect/logs — access-log ingest (the layer OTTO structurally can't have:
// it owns no server, so it can never see which bot fetched which URL). Streams logs from
// (a) a Vercel Log Drain JSON/NDJSON file or URL (cfg.logs.drainUrl) and (b) plain
// combined/NGINX/Apache access-log files, normalizes every line to a flat event
// {ts,ip,method,path,status,bytes,ua,referer}, and appends to a rolling per-client store
// at reports/<client>/access-events.ndjson. Line-by-line so multi-GB files never load
// into memory. Zero new deps — node built-ins + the project's fetch().

import { createReadStream, createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';

/** Where the rolling normalized store lives for a client. */
export function eventsStorePath(client) {
  return join(ROOT, 'reports', client, 'access-events.ndjson');
}

// --- combined / common / NGINX access-log line parser -----------------------
// Combined Log Format:
//   IP - user [10/Oct/2025:13:55:36 +0000] "GET /path HTTP/1.1" 200 2326 "ref" "ua"
// We tolerate the common variant (no referer/ua) and an optional leading vhost.
const COMBINED = new RegExp(
  '^(?:\\S+\\s+)?' +                           // optional vhost
  '(\\S+)\\s+\\S+\\s+\\S+\\s+' +               // ip ident authuser
  '\\[([^\\]]+)\\]\\s+' +                       // [timestamp]
  '"([A-Z]+)\\s+([^ "]+)[^"]*"\\s+' +          // "METHOD path proto"
  '(\\d{3})\\s+(\\d+|-)' +                      // status bytes
  '(?:\\s+"([^"]*)"\\s+"([^"]*)")?',           // "referer" "ua" (optional)
);

/** Apache/NGINX-style timestamp → ISO. Returns the raw string if it can't parse. */
function clfTimeToIso(s) {
  // 10/Oct/2025:13:55:36 +0000
  const m = String(s || '').match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?$/);
  if (!m) { const d = new Date(s); return Number.isNaN(+d) ? String(s || '') : d.toISOString(); }
  const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const [, dd, mon, yyyy, hh, mi, ss, tz] = m;
  const off = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : 'Z';
  const d = new Date(`${yyyy}-${MON[mon] || '01'}-${dd}T${hh}:${mi}:${ss}${off}`);
  return Number.isNaN(+d) ? String(s) : d.toISOString();
}

/** Normalize one combined/common log line → event or null. */
export function parseCombinedLine(line) {
  const m = String(line || '').match(COMBINED);
  if (!m) return null;
  const [, ip, ts, method, path, status, bytes, referer, ua] = m;
  return {
    ts: clfTimeToIso(ts),
    ip,
    method,
    path,
    status: Number(status),
    bytes: bytes === '-' ? 0 : Number(bytes),
    ua: ua || '',
    referer: referer && referer !== '-' ? referer : '',
  };
}

/** Pull a URL's pathname out of an absolute or relative path/url field. */
function toPath(v) {
  if (!v) return '';
  if (v.startsWith('/')) return v;
  try { return new URL(v).pathname + new URL(v).search; } catch { return v; }
}

/** Normalize one Vercel Log Drain JSON object → event or null.
 *  Vercel drains emit one JSON object per line (NDJSON) with a `proxy` block for
 *  request logs; we tolerate several field spellings across drain versions. */
export function parseVercelDrainObject(o) {
  if (!o || typeof o !== 'object') return null;
  const p = o.proxy || o.request || {};
  const method = p.method || o.method;
  const path = toPath(p.path || p.url || o.path || o.url);
  if (!method && !path) return null; // not a request log (e.g. a build/lambda line)
  const tsRaw = o.timestamp ?? o.timestampInMs ?? p.timestamp ?? Date.now();
  const ts = typeof tsRaw === 'number' ? new Date(tsRaw).toISOString() : clfTimeToIso(tsRaw);
  return {
    ts,
    ip: p.clientIp || p.ip || o.clientIp || o.ip || '',
    method: method || 'GET',
    path: path || '',
    status: Number(p.statusCode ?? p.status ?? o.statusCode ?? o.status ?? 0),
    bytes: Number(p.bytes ?? p.responseBytes ?? o.bytes ?? 0) || 0,
    ua: p.userAgent || p.ua || o.userAgent || (o.headers && (o.headers['user-agent'] || o.headers['User-Agent'])) || '',
    referer: p.referer || p.referrer || o.referer || (o.headers && (o.headers.referer || o.headers.referrer)) || '',
  };
}

/** Best-effort: detect & parse a single line as Vercel-JSON, else combined-log. */
export function parseLine(line, { format = 'auto' } = {}) {
  const s = (line || '').trim();
  if (!s) return null;
  if (format === 'combined') return parseCombinedLine(s);
  if (format === 'vercel' || (format === 'auto' && s[0] === '{')) {
    try { return parseVercelDrainObject(JSON.parse(s)); } catch { return format === 'vercel' ? null : parseCombinedLine(s); }
  }
  return parseCombinedLine(s);
}

/** Open a streaming line reader over a source: a file path (optionally .gz) or a URL.
 *  Returns a readline.Interface. */
async function openLineReader(source) {
  let raw;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { Accept: 'application/x-ndjson, application/json, text/plain' } });
    if (!res.ok || !res.body) throw new Error(`logs: fetch ${source} → ${res.status}`);
    raw = Readable.fromWeb(res.body);
    if (/\.gz($|\?)/i.test(source) || res.headers.get('content-encoding') === 'gzip') raw = raw.pipe(createGunzip());
  } else {
    if (!existsSync(source)) throw new Error(`logs: file not found: ${source}`);
    raw = createReadStream(source);
    if (/\.gz$/i.test(source)) raw = raw.pipe(createGunzip());
  }
  return createInterface({ input: raw, crlfDelay: Infinity });
}

/**
 * Ingest access logs from a source into the rolling per-client store, streaming
 * line-by-line (constant memory regardless of file size).
 *
 * @param {object} cfg                    client config (uses cfg.name, cfg.logs)
 * @param {object} opts
 * @param {string} [opts.source]          file path / URL / .gz; defaults to cfg.logs.drainUrl
 * @param {'auto'|'combined'|'vercel'} [opts.format='auto']
 * @param {boolean} [opts.append=true]    append to (vs truncate) the store
 * @param {boolean} [opts.botsOnly=false] keep only rows whose UA looks like a known bot
 * @param {(s:string)=>void} [opts.log]
 * @returns {Promise<{store,read,written,skipped,bySource}>}
 */
export async function ingestLogs(cfg, { source, format = 'auto', append = true, botsOnly = false, log = () => {} } = {}) {
  const src = source || cfg.logs?.drainUrl || cfg.logs?.file;
  if (!src) throw new Error('ingestLogs: no source (pass {source} or set cfg.logs.drainUrl / cfg.logs.file)');
  const store = eventsStorePath(cfg.name);
  mkdirSync(join(ROOT, 'reports', cfg.name), { recursive: true });

  const BOT_RE = /bot|crawl|spider|slurp|gptbot|claudebot|perplexity|oai-search|chatgpt|google-extended|bingbot|amazonbot|applebot|ccbot|bytespider/i;
  const out = createWriteStream(store, { flags: append ? 'a' : 'w' });
  let read = 0, written = 0, skipped = 0;

  const rl = await openLineReader(src);
  for await (const line of rl) {
    if (!line.trim()) continue;
    read++;
    const ev = parseLine(line, { format });
    if (!ev || !ev.path) { skipped++; continue; }
    if (botsOnly && !BOT_RE.test(ev.ua)) { skipped++; continue; }
    if (!out.write(JSON.stringify(ev) + '\n')) await new Promise((r) => out.once('drain', r));
    written++;
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));

  log(`  logs: ingested ${src} → ${written} events (${read} lines read, ${skipped} skipped) → ${store}`);
  return { store, read, written, skipped, bySource: src };
}

/**
 * Stream the rolling store back as normalized events (line-by-line; constant memory).
 * Consumers (crawlbudget / crawl-to-cite) iterate this rather than reading the whole file.
 * Corrupt/unparseable lines are skipped but COUNTED, never silently dropped: pass
 * `counts` (a mutable object) and its `.dropped` is incremented per corrupt line, so
 * agent-analytics can fold them into its skippedCount (coverage honesty).
 * @param {string} client
 * @param {{storePath?:string, counts?:{dropped?:number}}} [opts]
 * @returns {AsyncGenerator<object>}
 */
export async function* readEvents(client, { storePath, counts = null } = {}) {
  const store = storePath || eventsStorePath(client);
  if (!existsSync(store)) return;
  const rl = createInterface({ input: createReadStream(store), crlfDelay: Infinity });
  for await (const line of rl) {
    const s = line.trim();
    if (!s) continue;
    try { yield JSON.parse(s); } catch { if (counts) counts.dropped = (counts.dropped || 0) + 1; } // corrupt line: skipped AND counted
  }
}

/** Convenience: collect events into an array (small stores / tests only).
 *  Pass {counts} through to readEvents to receive the corrupt-line dropped count. */
export async function loadEvents(client, opts) {
  const all = [];
  for await (const ev of readEvents(client, opts)) all.push(ev);
  return all;
}
