// seo-bot · updates — Google algorithm/spam-update monitor. Reads the official
// Search Status Dashboard (FREE, no key, no auth — verified live) and tells the stats
// controller when to FREEZE judgement: reacting to a traffic dip mid-core-update turns
// a recoverable wobble into a permanent revert. Google itself says wait >=1 week after a
// rollout completes. This closes the loop on decideChange's coreUpdateActive gate, which
// previously had no data source.
//
// Source: https://status.search.google.com/incidents.json  (Atom fallback: /en/feed.atom)

const INCIDENTS_URL = 'https://status.search.google.com/incidents.json';

const fmt = (i) => ({ name: i.external_desc || i.name || 'update', begin: i.begin, end: i.end || null, severity: i.severity, service: i.service_name });

/**
 * Returns { coreUpdateActive, ongoing[], recent[], latest[] }.
 * coreUpdateActive = a Ranking update is currently rolling out OR finished within freezeDays.
 */
export async function googleUpdates({ log = () => {}, freezeDays = 7 } = {}) {
  try {
    const res = await fetch(INCIDENTS_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { coreUpdateActive: false, note: `status ${res.status}` };
    const all = await res.json();
    const ranking = (Array.isArray(all) ? all : []).filter((i) => /ranking/i.test(i.service_name || ''));
    const now = Date.now();
    const ongoing = ranking.filter((i) => !i.end);
    const recent = ranking.filter((i) => i.end && (now - Date.parse(i.end)) < freezeDays * 86400000 && (now - Date.parse(i.end)) >= 0);
    const coreUpdateActive = ongoing.length > 0 || recent.length > 0;
    log(`  Google updates: ${ongoing.length} ongoing, ${recent.length} ended <${freezeDays}d → stats judging ${coreUpdateActive ? 'FROZEN (confound)' : 'OK'}`);
    return { coreUpdateActive, ongoing: ongoing.map(fmt), recent: recent.map(fmt), latest: ranking.slice(0, 6).map(fmt) };
  } catch (e) { return { coreUpdateActive: false, note: String(e.message || e) }; }
}
