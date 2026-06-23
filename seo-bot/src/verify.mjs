// seo-bot · verify — re-fetch live URLs as RAW HTML and confirm the fix is
// server-rendered (visible to non-JS AI crawlers). This is the check that OTTO's
// client-side JS pixel structurally cannot pass.

import { fetchPage } from './util.mjs';
import { parsePage } from './rules.mjs';

/**
 * @param expect map of url -> substring that MUST appear in the raw HTML (optional)
 * Returns [{url, ok, status, serverRendered, bodyWords, hasExpected}]
 */
export async function verifyUrls(cfg, urls, { expect = {}, log = () => {} } = {}) {
  const out = [];
  for (const url of urls) {
    const res = await fetchPage(url, { timeoutMs: 15000 });
    const parsed = res.ok ? parsePage(res.text, url, cfg) : null;
    const serverRendered = !!parsed && parsed.bodyWords >= 50 && !parsed.looksSpaShell ? true : !!parsed && parsed.bodyWords >= 50;
    const need = expect[url];
    const hasExpected = need ? (res.text || '').includes(need) : null;
    const ok = res.ok && res.status === 200 && serverRendered && (need ? hasExpected : true);
    out.push({ url, ok, status: res.status, serverRendered, bodyWords: parsed?.bodyWords ?? 0, hasExpected });
    log(`    ${ok ? '✓' : '✗'} ${url} — HTTP ${res.status}, ${parsed?.bodyWords ?? 0} server-rendered words${need ? `, expected:${hasExpected}` : ''}`);
  }
  return out;
}
