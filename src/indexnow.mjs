// seo-bot · IndexNow — submit changed URLs to Bing (powers ChatGPT's web index).
// Mirrors lib/indexnow.ts but standalone for the bot. Needs INDEXNOW_KEY (env or
// config.indexnowKey) and the key file hosted at https://{host}/{KEY}.txt.

// Submitting to ONE IndexNow participant federates to all, but trying a second on
// failure adds resilience. Bing powers ChatGPT's web index; Yandex is the other live one.
const ENDPOINTS = ['https://www.bing.com/indexnow', 'https://yandex.com/indexnow'];

export async function pingIndexNow(urls, host, key = process.env.INDEXNOW_KEY) {
  if (!key) return { ok: false, skipped: true, message: 'no INDEXNOW_KEY' };
  const list = [];
  const seen = new Set();
  for (let u of urls || []) {
    if (!u) continue;
    if (!u.startsWith('http')) u = `https://${host}${u.startsWith('/') ? '' : '/'}${u}`;
    try { const p = new URL(u); if (p.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) continue; if (seen.has(p.href)) continue; seen.add(p.href); list.push(p.href); } catch {}
  }
  if (!list.length) return { ok: true, skipped: true, submitted: 0, message: 'no same-host URLs' };
  const body = JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: list });
  let lastStatus = 0, lastErr;
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body });
      lastStatus = res.status;
      if (res.ok || res.status === 202) return { ok: true, status: res.status, submitted: list.length, endpoint };
    } catch (e) { lastErr = String(e.message || e); }
  }
  return { ok: false, status: lastStatus, submitted: 0, message: lastErr || `all IndexNow endpoints failed (last ${lastStatus})` };
}

/** Bing Webmaster SubmitUrlbatch as a stronger complement when a WMT key is present. */
export async function bingSubmitIfKeyed(cfg, urls) {
  if (!process.env.BING_WEBMASTER_API_KEY && !cfg?.bing?.apiKey) return { skipped: true };
  try { const { bingSubmitUrls } = await import('./data/bing.mjs'); return bingSubmitUrls(cfg, urls); }
  catch (e) { return { ok: false, message: String(e.message || e) }; }
}
