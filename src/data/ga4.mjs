// seo-bot · data/ga4 — pull GA4 conversions/sessions via the Analytics Data API,
// using the one-click OAuth connection (connect/google.mjs). Conversions (booking/
// consult key-events) are the load-bearing KPI for the stats controller's guardrail.

import { getAccessToken } from '../connect/google.mjs';

/**
 * Pull per-page sessions + conversions for the last 28 days.
 * Needs cfg.ga4.propertyId (numeric GA4 property id) + a Google connection.
 */
export async function ga4Report(cfg, { log = () => {}, days = 28 } = {}) {
  if (!cfg.ga4?.propertyId) return { enabled: false, note: 'ga4.propertyId not set in config' };
  let token = null;
  try { token = await getAccessToken(cfg.name); } catch { token = null; } // missing OAuth creds must no-op, not crash
  if (!token) return { enabled: false, note: 'not connected — run `connect <client>`' };
  const body = {
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'keyEvents' }],
    limit: 250,
  };
  try {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4.propertyId}:runReport`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) return { enabled: false, note: `GA4 ${r.status}: ${(await r.text()).slice(0, 160)}` };
    const data = await r.json();
    const rows = (data.rows || []).flatMap((row) => {
      const page = row.dimensionValues?.[0]?.value;
      if (!page) return []; // skip malformed/empty rows — fail closed, not loud
      return [{
        page,
        // Clamp at the SOURCE: GA4 returns strings; a negative/NaN value must never reach the
        // stats/guardrail layer (it can fabricate significance / certify garbage). Fail to 0.
        sessions: Math.max(0, Number(row.metricValues?.[0]?.value) || 0),
        conversions: Math.max(0, Number(row.metricValues?.[1]?.value) || 0),
        keyEvents: Math.max(0, Number(row.metricValues?.[2]?.value) || 0),
      }];
    });
    const totalConv = rows.reduce((s, x) => s + x.conversions, 0);

    // Sturm signal: AI-referral sessions (sessionSource matching the AI engines).
    let aiReferrals = [];
    try {
      const aiBody = {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }, { name: 'conversions' }],
        dimensionFilter: { filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: 'chatgpt|openai|perplexity|gemini|copilot|claude|mistral' } } },
        limit: 50,
      };
      const ar = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4.propertyId}:runReport`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(aiBody) });
      if (ar.ok) aiReferrals = ((await ar.json()).rows || []).flatMap((row) => {
        const source = row.dimensionValues?.[0]?.value;
        if (!source) return [];
        return [{ source, sessions: Math.max(0, Number(row.metricValues?.[0]?.value) || 0), conversions: Math.max(0, Number(row.metricValues?.[1]?.value) || 0) }];
      });
    } catch { /* best-effort */ }
    const aiSessions = aiReferrals.reduce((s, x) => s + x.sessions, 0);

    // Key-event breakdown — split bookings from leads/calls (the med-spa money actions).
    let eventBreakdown = [];
    try {
      const eb = {
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
        dimensions: [{ name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'keyEvents' }],
        dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'PARTIAL_REGEXP', value: 'book|appointment|consult|lead|contact|call|submit|schedule|phone|form' } } },
        limit: 25,
      };
      const er = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4.propertyId}:runReport`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(eb) });
      if (er.ok) eventBreakdown = ((await er.json()).rows || []).flatMap((row) => {
        const event = row.dimensionValues?.[0]?.value;
        if (!event) return [];
        return [{ event, count: Number(row.metricValues?.[0]?.value || 0), keyEvents: Number(row.metricValues?.[1]?.value || 0) }];
      }).sort((a, b) => b.keyEvents - a.keyEvents);
    } catch { /* best-effort */ }

    log(`  GA4: ${rows.length} pages, ${totalConv} conversions, ${rows.reduce((s, x) => s + x.sessions, 0)} sessions (${days}d); ${aiSessions} AI-referral sessions; ${eventBreakdown.length} money events.`);
    return { enabled: true, rows, totalConversions: totalConv, aiReferrals, aiSessions, eventBreakdown };
  } catch (e) { return { enabled: false, note: String(e.message || e) }; }
}
