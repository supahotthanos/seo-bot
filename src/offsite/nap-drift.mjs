// seo-bot · offsite/nap-drift — monitor the PUBLIC listing pages that are fetchable
// without auth, extract the NAP they display, and diff it against the canonical NAP.
// READ-ONLY: this module never writes anywhere off-site; drift produces an alert row
// for the human worksheet. Fail closed: an unreachable/unparseable listing page is
// status 'unreachable'/'no-nap-found' — NEVER counted as "no drift".
//
// Evidence/source: research/medspa-seo-framework.md (NAP consistency is a top local
// ranking factor; aggregator drift silently re-corrupts fixed listings).

import * as cheerio from 'cheerio';
import { normalizeNap } from '../listings/index.mjs';

/** Extract a NAP { name, phone, address } from a listing page's HTML. Null when not found. */
export function extractNap(html = '') {
  if (!html || typeof html !== 'string') return null;
  let $;
  try { $ = cheerio.load(html); } catch { return null; }

  // 1) JSON-LD LocalBusiness/MedicalBusiness/Organization — the most reliable source.
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    let j; try { j = JSON.parse($(el).contents().text()); } catch { continue; }
    const nodes = Array.isArray(j) ? j : (j['@graph'] || [j]);
    for (const n of nodes) {
      const type = String(Array.isArray(n?.['@type']) ? n['@type'].join(' ') : n?.['@type'] || '');
      if (!/business|organization|medicalclinic|localbusiness|healthandbeautybusiness/i.test(type)) continue;
      const addr = n.address && typeof n.address === 'object'
        ? [n.address.streetAddress, n.address.addressLocality, n.address.addressRegion, n.address.postalCode].filter(Boolean).join(', ')
        : (typeof n.address === 'string' ? n.address : '');
      if (n.name || n.telephone || addr) return { name: n.name || '', phone: n.telephone || '', address: addr, source: 'json-ld' };
    }
  }

  // 2) Microdata / visible fallbacks: tel: link + address element.
  const phone = $('a[href^="tel:"]').first().attr('href')?.replace(/^tel:/, '') || $('[itemprop="telephone"]').first().text().trim() || '';
  const address = $('[itemprop="address"]').first().text().trim() || $('address').first().text().replace(/\s+/g, ' ').trim() || '';
  const name = $('[itemprop="name"]').first().text().trim() || $('h1').first().text().trim() || '';
  if (phone || address) return { name, phone, address, source: 'dom' };
  return null;
}

/** Diff an observed NAP against the canonical one (both normalized). Pure. */
export function diffNap(canonicalRaw, observedRaw) {
  const canonical = normalizeNap(canonicalRaw);
  const observed = observedRaw ? normalizeNap(observedRaw) : null;
  if (!canonical) return { comparable: false, reason: 'no canonical NAP' };
  if (!observed) return { comparable: false, reason: 'no NAP extracted from the listing page' };
  const drift = [];
  for (const field of ['name', 'phone', 'address']) {
    const want = canonical[field], got = observed[field];
    if (!got) { drift.push({ field, canonical: want, observed: null, kind: 'missing' }); continue; }
    if (field === 'phone' ? want.replace(/^\+1/, '') !== got.replace(/^\+1/, '') : want !== got) drift.push({ field, canonical: want, observed: got, kind: 'mismatch' });
  }
  return { comparable: true, drifted: drift.length > 0, drift };
}

/**
 * Fetch each publicly-listed profile URL (cfg.listings.targets[].publicUrl) and diff its NAP.
 * @param fetchFn injected — tests use fixtures; runOffsite only calls this on a live run.
 */
export async function napDriftMonitor(cfg, { fetchFn = globalThis.fetch, log = () => {} } = {}) {
  const canonical = cfg?.listings?.canonicalNap || null;
  if (!canonical) return { refused: true, reason: 'no canonical NAP — cannot diff (fail closed)', rows: [] };
  const urls = (cfg.listings?.targets || []).filter((t) => t.publicUrl).map((t) => ({ id: t.id, url: t.publicUrl }));
  if (!urls.length) return { refused: false, rows: [], note: 'no listings.targets[].publicUrl configured — add the live profile URLs to monitor drift' };

  const rows = [];
  for (const { id, url } of urls) {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0 (seo-bot nap-monitor)' } });
      if (!res.ok) { rows.push({ id, url, status: 'unreachable', httpStatus: res.status }); continue; }
      const html = await res.text();
      const observed = extractNap(html);
      if (!observed) { rows.push({ id, url, status: 'no-nap-found', note: 'page fetched but no NAP extracted — NOT counted as consistent (fail closed)' }); continue; }
      const d = diffNap(canonical, observed);
      rows.push({ id, url, status: d.drifted ? 'DRIFT' : 'consistent', observed, drift: d.drift || [] });
    } catch (e) {
      rows.push({ id, url, status: 'unreachable', error: String(e.message || e) });
    }
  }
  const drifted = rows.filter((r) => r.status === 'DRIFT');
  log(`  NAP drift: ${rows.length} listings checked · ${drifted.length} drifted · ${rows.filter((r) => r.status !== 'consistent' && r.status !== 'DRIFT').length} unverifiable (fail closed)`);
  return { refused: false, rows, alerts: drifted };
}
