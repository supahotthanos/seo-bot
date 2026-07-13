// seo-bot · sources/entity — entity-consistency auditor. AI engines ground answers on a
// brand's ENTITY (Knowledge Graph + Wikidata), not just its pages. This checks whether
// the brand exists + is consistent across Google KG and Wikidata, and emits the corrected
// Organization JSON-LD (with a sameAs graph) the apply layer should publish. Wikidata
// needs no key; Google KG uses a free key (KG_API_KEY, 100k/day) when present.

export async function entityConsistency(cfg, { log = () => {} } = {}) {
  const brand = cfg.brand;
  const out = { brand, wikidata: null, google: null, issues: [], recommendedSameAs: [] };

  // Wikidata (no key) — wbsearchentities
  try {
    const r = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(brand)}&language=en&format=json&origin=*`, { headers: { 'User-Agent': 'seo-bot/1.0' } });
    const j = await r.json();
    out.wikidata = (j.search || [])[0] || null;
  } catch (e) { out.issues.push('wikidata: ' + String(e.message || e)); }

  // Google Knowledge Graph Search API (free key)
  const key = process.env.KG_API_KEY || process.env.GOOGLE_API_KEY;
  if (key) {
    try {
      const r = await fetch(`https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(brand)}&key=${key}&limit=1&languages=en`);
      const j = await r.json();
      const top = (j.itemListElement || [])[0];
      out.google = top?.result || null;
      // KG resultScore = Google's confidence in the entity = a movable brand-authority KPI
      // (Kalicube Process). Capture it so the bot can track entity strength over time.
      out.kgResultScore = top?.resultScore ?? null;
    } catch (e) { out.issues.push('kg: ' + String(e.message || e)); }
  } else out.issues.push('no KG_API_KEY → Wikidata-only (set a free GCP key for Knowledge Graph)');

  // Build the recommended sameAs graph
  const same = [];
  if (out.wikidata?.id) same.push(`https://www.wikidata.org/wiki/${out.wikidata.id}`);
  if (out.google?.detailedDescription?.url) same.push(out.google.detailedDescription.url);
  for (const u of cfg.listings?.socialProfiles || cfg.socialProfiles || []) same.push(u);
  out.recommendedSameAs = [...new Set(same)];

  if (!out.wikidata) out.issues.push('NO Wikidata entity — brand is invisible to entity-grounded AI. Consider creating one (notability permitting).');
  if (key && !out.google) out.issues.push('NO Google Knowledge Graph entity — no Knowledge Panel; build entity signals (sameAs, consistent NAP, citations).');

  out.recommendedJsonLd = { '@context': 'https://schema.org', '@type': 'MedicalBusiness', name: brand, url: cfg.baseUrl, ...(out.recommendedSameAs.length ? { sameAs: out.recommendedSameAs } : {}) };

  log(`\n  Entity: Wikidata ${out.wikidata ? '✅ ' + out.wikidata.id : '❌ none'} · Google KG ${out.google ? '✅' : key ? '❌ none' : '— (no key)'}`);
  out.issues.forEach((i) => log(`  • ${i}`));
  if (out.recommendedSameAs.length) log(`  sameAs → ${out.recommendedSameAs.join(', ')}`);
  return out;
}
