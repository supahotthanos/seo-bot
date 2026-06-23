// seo-bot · data/crux — Chrome UX Report API (FREE). Real-world FIELD Core Web Vitals
// (what users actually experience), plus the History API for 25–40 weeks of trend.
// Needs CRUX_API_KEY (a plain GCP key — enable "Chrome UX Report API"; NOT the OAuth
// client). Low-traffic spa URLs may 404 (no field sample) → fall back to origin level.

const REC = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
const HIST = 'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord';
const p75 = (m, k) => m?.[k]?.percentiles?.p75 ?? null;
const rate = (good, ni, v) => (v == null ? '?' : Number(v) <= good ? 'good' : Number(v) <= ni ? 'needs-improvement' : 'poor');

async function call(url, key, body) {
  const r = await fetch(`${url}?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  return { ok: r.ok, status: r.status, j };
}

export async function cruxRecord(cfg, { url = null, formFactor = 'PHONE', log = () => {} } = {}) {
  const key = process.env.CRUX_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { enabled: false, note: 'set CRUX_API_KEY (free GCP key, enable Chrome UX Report API)' };
  try {
    // Try URL-level, fall back to origin-level (more likely to have a sample).
    let { ok, status, j } = await call(REC, key, { url: url || undefined, origin: url ? undefined : cfg.baseUrl, formFactor });
    if (!ok && url && status === 404) ({ ok, status, j } = await call(REC, key, { origin: cfg.baseUrl, formFactor }));
    if (!ok) return { enabled: false, note: j.error?.message || `status ${status}`, noData: status === 404 };
    const m = j.record?.metrics || {};
    const lcp = p75(m, 'largest_contentful_paint'), inp = p75(m, 'interaction_to_next_paint'), cls = p75(m, 'cumulative_layout_shift'), ttfb = p75(m, 'experimental_time_to_first_byte');
    const out = { enabled: true, key: j.record?.key, formFactor, lcpMs: lcp, inpMs: inp, cls, ttfbMs: ttfb, lcp: rate(2500, 4000, lcp), inp: rate(200, 500, inp), cls_rating: rate(0.1, 0.25, cls) };
    log(`  CrUX ${formFactor}: LCP ${out.lcp} (${lcp}ms) · INP ${out.inp} (${inp}ms) · CLS ${out.cls_rating} (${cls})`);
    return out;
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}

export async function cruxHistory(cfg, { formFactor = 'PHONE', log = () => {} } = {}) {
  const key = process.env.CRUX_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return { enabled: false, note: 'set CRUX_API_KEY' };
  try {
    const { ok, status, j } = await call(HIST, key, { origin: cfg.baseUrl, formFactor });
    if (!ok) return { enabled: false, note: j.error?.message || `status ${status}` };
    const m = j.record?.metrics || {};
    const series = (k) => (m[k]?.percentilesTimeseries?.p75s || []);
    return { enabled: true, periods: (j.record?.collectionPeriods || []).length, lcp: series('largest_contentful_paint'), inp: series('interaction_to_next_paint'), cls: series('cumulative_layout_shift') };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}
