// seo-bot · connect/cloudflare — the DNS connector ("access to all the DNS"). Reads
// and (gated) writes DNS records via the Cloudflare API: site-verification TXT for
// Google/Bing, and the DMARC record onboarding flags as missing. Token-gated and
// write-gated — a real human flips --yes for any change (DNS is hard to reverse).
//
// Setup: create a Cloudflare API token (Zone:DNS:Edit on the client's zone) and set
//   CLOUDFLARE_API_TOKEN=...   (or cms.cfToken in the client config)

const API = 'https://api.cloudflare.com/client/v4';

// Exported for reuse by the Epic-4 DNS/trust layer (connect/dns.mjs) so every
// gated DNS writer shares one auth + zone-resolution path. EXPORT-only change.
export function cfToken(cfg) {
  const v = process.env.CLOUDFLARE_API_TOKEN || cfg?.cms?.cfToken;
  return v && v.startsWith('ENV:') ? process.env[v.slice(4)] : v;
}

export async function cf(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(`Cloudflare ${res.status}: ${(j.errors || []).map((e) => e.message).join('; ') || res.statusText}`);
  return j.result;
}

export async function getZoneId(token, domain) {
  const zones = await cf(token, `/zones?name=${encodeURIComponent(domain)}`);
  return zones?.[0]?.id || null;
}

/**
 * DNS connector. Reads the zone's records; with opts it can add a verification TXT or
 * a DMARC record (write-gated behind confirm).
 * @param opts { confirm, addDmarc, verifyGoogle, verifyBing }
 */
export async function dnsConnector(cfg, { log = () => {}, opts = {} } = {}) {
  const token = cfToken(cfg);
  if (!token) { log('  DNS connector off: set CLOUDFLARE_API_TOKEN (Zone:DNS:Edit) — or cms.cfToken. See seo-bot/SETUP.md.'); return { enabled: false }; }
  let zoneId;
  try { zoneId = await getZoneId(token, cfg.domain); } catch (e) { log(`  Cloudflare error: ${e.message}`); return { enabled: false, error: String(e.message) }; }
  if (!zoneId) { log(`  No Cloudflare zone for ${cfg.domain} (is it on this Cloudflare account?).`); return { enabled: false }; }

  const records = await cf(token, `/zones/${zoneId}/dns_records?per_page=200`);
  const txt = records.filter((r) => r.type === 'TXT');
  const hasDmarc = txt.some((r) => /^_dmarc\./.test(r.name) || /v=DMARC1/i.test(r.content));
  const hasSpf = txt.some((r) => /v=spf1/i.test(r.content));
  log(`  DNS (${cfg.domain}): ${records.length} records · SPF ${hasSpf ? 'yes' : 'MISSING'} · DMARC ${hasDmarc ? 'yes' : 'MISSING'}`);

  const planned = [];
  if (opts.addDmarc && !hasDmarc) planned.push({ name: `_dmarc.${cfg.domain}`, content: `v=DMARC1; p=none; rua=mailto:${process.env.SEO_BOT_DMARC_RUA || `postmaster@${cfg.domain}`}` });
  if (opts.verifyGoogle) planned.push({ name: cfg.domain, content: `google-site-verification=${opts.verifyGoogle}` });
  if (opts.verifyBing) planned.push({ name: cfg.domain, content: `MS=${opts.verifyBing}` });

  if (!planned.length) { log('  No DNS writes requested (use --add-dmarc / --verify-google <token> / --verify-bing <token>).'); return { enabled: true, zoneId, records: records.length, hasSpf, hasDmarc }; }

  if (!opts.confirm) {
    log('  Planned DNS writes (preview — pass --yes to apply):');
    for (const p of planned) log(`    + TXT ${p.name} = "${p.content}"`);
    return { enabled: true, planned, dryrun: true };
  }
  const added = [];
  for (const p of planned) {
    try { await cf(token, `/zones/${zoneId}/dns_records`, { method: 'POST', body: { type: 'TXT', name: p.name, content: p.content, ttl: 3600 } }); added.push(p); log(`    ✓ added TXT ${p.name}`); }
    catch (e) { log(`    ✗ ${p.name}: ${e.message}`); }
  }
  return { enabled: true, zoneId, added };
}
