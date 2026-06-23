// seo-bot · data/clarity — Microsoft Clarity Data Export API (FREE, unlimited product).
// Surfaces the UX-FRUSTRATION signals GA4/GSC can't: rage clicks, dead clicks, quickbacks,
// excessive scroll, JS errors — the "why a booking/consult page loses people" signal.
// Token: Clarity → Settings → Data Export → generate (per project). HARD cap 10 req/
// project/DAY, trailing 1–3 days only → pull once/day on a cron and accumulate your own
// series. No funnel/recording export (UI only). Pure CRO/UX, not tied to indexing.

const ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';

export async function clarityInsights(cfg, { numOfDays = 3, dimension = 'URL', log = () => {} } = {}) {
  const token = process.env.CLARITY_API_TOKEN || cfg.clarity?.token;
  if (!token) return { enabled: false, note: 'set CLARITY_API_TOKEN (Clarity → Settings → Data Export)' };
  try {
    const qs = new URLSearchParams({ numOfDays: String(Math.min(3, numOfDays)) });
    if (dimension) qs.set('dimension1', dimension);
    const r = await fetch(`${ENDPOINT}?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = null; }
    if (!r.ok) return { enabled: false, note: (j && (j.message || j.error)) || text.slice(0, 120) || `status ${r.status}`, quota: r.status === 429 };
    const rows = Array.isArray(j) ? j : [];
    const metric = (name) => rows.find((x) => (x.metricName || x.metric) === name);
    const frustration = ['RageClickCount', 'DeadClickCount', 'QuickbackClick', 'ExcessiveScroll', 'ScriptErrorCount', 'ErrorClickCount'].map((n) => ({ metric: n, data: metric(n)?.information || metric(n)?.data || null })).filter((x) => x.data);
    log(`  Clarity: ${rows.length} metric groups · ${frustration.length} frustration signals (last ${Math.min(3, numOfDays)}d)`);
    return { enabled: true, raw: rows, frustration };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}
