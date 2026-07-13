// seo-bot · stealth — single entry point to the Scrapling stealth sidecar (StealthyFetcher,
// JS-rendered). Used by geogrid + serp for logged-out, low-volume, jittered Google reads
// (website-first + stealth-Maps/SERP posture; NOT the paid Places/SERP APIs). Realistically
// needs a residential IP — datacenter IPs get blank/blocked Google. Run on the Mac Mini.

import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(__dirname, '..', 'scraper', 'fetch.py');
const PYTHON = process.env.SEO_BOT_PYTHON || 'python';

export function stealthFetch(url, { timeout = 70000 } = {}) {
  return new Promise((resolve) => {
    execFile(PYTHON, [SIDECAR, '--mode', 'stealth', '--url', url, '--timeout', String(timeout)], { timeout: timeout + 20000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return resolve({ ok: false, note: `sidecar failed (python+scrapling installed? residential IP?): ${String(err.message || err).slice(0, 120)}` });
      try { const j = JSON.parse(stdout); resolve({ ok: !!(j.html || j.content), html: j.html || j.content || '', status: j.status }); }
      catch { resolve({ ok: false, note: 'unparseable sidecar output' }); }
    });
  });
}
