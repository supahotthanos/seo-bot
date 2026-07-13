// seo-bot · connect/dns — higher-level DNS / trust manager over connect/cloudflare.mjs.
//
// FRAMING (read before extending): DNSSEC, CAA, BIMI, MTA-STS, TLS-RPT are TRUST /
// VERIFICATION / DELIVERABILITY levers, NOT direct ranking factors (plan §8). Their
// value is: domain verification (lights up the FREE GSC/Bing connectors), email
// deliverability (so the Epic-15 off-domain outreach lands), cert-issuance control,
// and brand/knowledge-panel trust. These are exactly the levers OTTO — a SaaS overlay
// that never owns the zone — is structurally locked out of. We own the DNS, so we
// write them.
//
// READ path:  DNSSEC (DS/DNSKEY via DoH), CAA (any-CA-can-issue flag), + a 0-100
//             DNS-trust subscore with standard-shape fix proposals.
// WRITE path: every writer is CONFIRM-ONLY (opts.confirm / --yes). DNS is hard to
//             reverse, so nothing here ever auto-applies. Writers reuse the exported
//             cloudflare helpers cf() / getZoneId() / cfToken() — one auth path.

import { cf, cfToken, getZoneId } from './cloudflare.mjs';

const DOH = 'https://cloudflare-dns.com/dns-query';

/** DNS-over-HTTPS query → array of answer records. Returns [] on any failure. */
async function doh(name, type) {
  try {
    const r = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = await r.json();
    return j.Answer || [];
  } catch { return []; }
}

/** The CAs we whitelist when writing a CAA record (the major ACME + commercial issuers). */
export const CAA_WHITELIST = ['letsencrypt.org', 'pki.goog', 'sectigo.com', 'ssl.com'];

// --- READ / SCORE ---------------------------------------------------------------

/** Detect DNSSEC by presence of DS (at parent) and/or DNSKEY (at zone) records. */
export async function detectDnssec(domain) {
  const [ds, dnskey] = await Promise.all([doh(domain, 'DS'), doh(domain, 'DNSKEY')]);
  return { ds: ds.length > 0, dnskey: dnskey.length > 0, enabled: ds.length > 0 || dnskey.length > 0 };
}

/** Parse CAA records (via the local resolver result OR DoH) into issuer + iodef flags. */
export async function getCaa(domain, { caaFromDns = null } = {}) {
  let issuers = [];
  let iodef = false;
  if (Array.isArray(caaFromDns) && caaFromDns.length) {
    issuers = caaFromDns.filter(Boolean);
  } else {
    const ans = await doh(domain, 'CAA');
    for (const a of ans) {
      const d = String(a.data || '');
      if (/issue|issuewild/i.test(d)) { const m = d.match(/"([^"]+)"/); if (m) issuers.push(m[1]); }
      if (/iodef/i.test(d)) iodef = true;
    }
  }
  return { present: issuers.length > 0, issuers, iodef, anyCaCanIssue: issuers.length === 0 };
}

/**
 * Compute a 0-100 DNS-trust subscore + standard-shape proposals from a domain's DNS.
 * @param dns the object from onboard/dns.mjs lookupDns() (used for CAA/SOA/NS hints)
 * @returns { score, signals, proposals[] }
 */
export async function scoreDnsTrust(dns, { log = () => {} } = {}) {
  const domain = dns?.domain || dns?.derived?.domain || '';
  const dnssec = await detectDnssec(domain);
  const caa = await getCaa(domain, { caaFromDns: dns?.records?.caa });
  const hasNs = (dns?.records?.ns || []).length > 0;
  const soaTtl = dns?.records?.soa?.minttl ?? dns?.records?.soa?.expire ?? null;

  // --- scoring (DNSSEC 40 · CAA 35 · NS sanity 15 · iodef 10) ---
  let score = 0;
  if (dnssec.enabled) score += 40;
  if (caa.present) { score += 25; if (caa.iodef) score += 10; }
  if (hasNs) score += 15;
  // NOTE: TTL hygiene is informational only — not scored (low/high TTL is a reliability
  // tradeoff, not a trust signal).
  score = Math.max(0, Math.min(100, Math.round(score)));

  const proposals = [];
  const P = (severity, current, proposed, rationale, extra = {}) => proposals.push({ type: 'dns-trust', severity, current, proposed, rationale, autoApplicable: false, ...extra });

  if (!dnssec.enabled) {
    P('medium', 'DNSSEC: not enabled (no DS/DNSKEY)',
      'Enable DNSSEC at the DNS host (Cloudflare: one-click, then add the DS record at the registrar).',
      'DNSSEC cryptographically signs DNS answers, preventing cache-poisoning/hijack of the zone. Trust/integrity lever (foundation OTTO cannot touch) — not a direct ranking factor.',
      { record: 'DNSSEC' });
  }
  if (caa.anyCaCanIssue) {
    P('medium', 'CAA: MISSING — ANY certificate authority can issue a cert for this domain',
      `Add CAA records whitelisting only your CAs: ${CAA_WHITELIST.join(', ')} (+ iodef for misissuance alerts).`,
      'With no CAA, any CA worldwide can mint a cert for your domain (mis-issuance / impersonation risk). CAA restricts issuance to approved CAs. Trust/security lever, not ranking.',
      { record: 'CAA' });
  } else if (!caa.iodef) {
    P('low', 'CAA present but no iodef contact',
      `Add an iodef CAA record (mailto:security@${domain}) so CAs report mis-issuance attempts.`,
      'iodef gives you notification if a CA is asked to issue a cert outside your whitelist.',
      { record: 'CAA' });
  }
  if (!hasNs) {
    P('high', 'No NS records resolved (zone may be misconfigured)',
      'Verify nameserver delegation at the registrar.',
      'A zone with no resolvable NS is broken at the most basic level.',
      { record: 'NS' });
  }

  return { score, signals: { dnssec: dnssec.enabled, caa: caa.present, caaIssuers: caa.issuers, iodef: caa.iodef, soaTtl }, proposals };
}

// --- GATED WRITERS --------------------------------------------------------------
// Every writer follows the same contract:
//   * needs a Cloudflare token (env CLOUDFLARE_API_TOKEN or cfg.cms.cfToken)
//   * builds a `planned` list of records
//   * if !opts.confirm → returns { dryrun:true, planned } and logs a preview
//   * if opts.confirm  → POSTs (or PATCHes) each record and returns { added }
// This mirrors connect/cloudflare.mjs's existing dnsConnector contract exactly.

/** Resolve the token + zone for a client, or return a disabled result. */
async function zoneCtx(cfg, log) {
  const token = cfToken(cfg);
  if (!token) { log('  DNS manager off: set CLOUDFLARE_API_TOKEN (Zone:DNS:Edit) or cms.cfToken.'); return null; }
  let zoneId;
  try { zoneId = await getZoneId(token, cfg.domain); } catch (e) { log(`  Cloudflare error: ${e.message}`); return null; }
  if (!zoneId) { log(`  No Cloudflare zone for ${cfg.domain}.`); return null; }
  return { token, zoneId };
}

/** Existing TXT records for the zone (used to upsert / version-bump). */
async function existingTxt(token, zoneId, name) {
  const recs = await cf(token, `/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}&per_page=100`);
  return recs || [];
}

/** Write one TXT, upserting if a same-name record already exists. confirm-gated. */
async function putTxt(ctx, name, content, { log, confirm, ttl = 3600 }) {
  const { token, zoneId } = ctx;
  const existing = await existingTxt(token, zoneId, name);
  const match = existing.find((r) => r.content === content) || existing[0];
  const action = match ? (match.content === content ? 'noop' : 'update') : 'create';
  if (action === 'noop') { log(`    = TXT ${name} already set`); return { name, action }; }
  if (!confirm) { log(`    + (preview) TXT ${name} = "${content}" [${action}]`); return { name, content, action, dryrun: true }; }
  if (action === 'update') await cf(token, `/zones/${zoneId}/dns_records/${match.id}`, { method: 'PATCH', body: { type: 'TXT', name, content, ttl } });
  else await cf(token, `/zones/${zoneId}/dns_records`, { method: 'POST', body: { type: 'TXT', name, content, ttl } });
  log(`    ✓ ${action} TXT ${name}`);
  return { name, content, action };
}

/**
 * Write CAA records whitelisting our CAs + an iodef contact. confirm-gated.
 * Cloudflare CAA records use a structured `data` object.
 */
export async function writeCaa(cfg, { log = () => {}, confirm = false, cas = CAA_WHITELIST, iodef = null } = {}) {
  const ctx = await zoneCtx(cfg, log); if (!ctx) return { enabled: false };
  const { token, zoneId } = ctx;
  const planned = [];
  for (const ca of cas) { planned.push({ flags: 0, tag: 'issue', value: ca }); planned.push({ flags: 0, tag: 'issuewild', value: ca }); }
  planned.push({ flags: 0, tag: 'iodef', value: `mailto:${iodef || `security@${cfg.domain}`}` });
  if (!confirm) { log('  Planned CAA writes (preview — pass --yes):'); planned.forEach((p) => log(`    + CAA ${cfg.domain} ${p.tag} "${p.value}"`)); return { enabled: true, dryrun: true, planned }; }
  const added = [];
  for (const p of planned) {
    try { await cf(token, `/zones/${zoneId}/dns_records`, { method: 'POST', body: { type: 'CAA', name: cfg.domain, data: p, ttl: 3600 } }); added.push(p); log(`    ✓ CAA ${p.tag} ${p.value}`); }
    catch (e) { log(`    ✗ CAA ${p.tag} ${p.value}: ${e.message}`); }
  }
  return { enabled: true, added };
}

/**
 * Staged DMARC promotion: none → quarantine → reject. confirm-gated.
 * Pass the next policy explicitly; promotion gating (rua thresholds) lives in the
 * caller (data/dmarc.mjs + stats horizon) — this writer only applies the chosen step.
 */
export async function writeDmarc(cfg, { log = () => {}, confirm = false, policy = 'none', pct = 100, rua = null, sp = null } = {}) {
  const ctx = await zoneCtx(cfg, log); if (!ctx) return { enabled: false };
  if (!['none', 'quarantine', 'reject'].includes(policy)) throw new Error(`invalid DMARC policy: ${policy}`);
  const parts = [`v=DMARC1`, `p=${policy}`];
  if (sp) parts.push(`sp=${sp}`);
  if (pct != null && pct !== 100) parts.push(`pct=${pct}`);
  parts.push(`rua=mailto:${rua || `dmarc@${cfg.domain}`}`);
  const content = parts.join('; ');
  const name = `_dmarc.${cfg.domain}`;
  const res = await putTxt(ctx, name, content, { log, confirm });
  return { enabled: true, ...res, policy };
}

/** default._bimi BIMI TXT (logo + optional VMC). confirm-gated. */
export async function writeBimi(cfg, { log = () => {}, confirm = false, logoUrl, vmcUrl = null } = {}) {
  const ctx = await zoneCtx(cfg, log); if (!ctx) return { enabled: false };
  if (!logoUrl) { log('  BIMI needs a logoUrl (HTTPS SVG Tiny-PS).'); return { enabled: true, skipped: true }; }
  const content = `v=BIMI1; l=${logoUrl};${vmcUrl ? ` a=${vmcUrl};` : ''}`;
  const res = await putTxt(ctx, `default._bimi.${cfg.domain}`, content, { log, confirm });
  return { enabled: true, ...res };
}

/**
 * MTA-STS: _mta-sts TXT (with monotonic version bump) — the policy file itself is
 * hosted at https://mta-sts.{domain}/.well-known/mta-sts.txt (scaffold via apply/nextjs).
 * confirm-gated.
 */
export async function writeMtaSts(cfg, { log = () => {}, confirm = false } = {}) {
  const ctx = await zoneCtx(cfg, log); if (!ctx) return { enabled: false };
  const name = `_mta-sts.${cfg.domain}`;
  // Version bump: derive next id from any existing record so receivers re-fetch the policy.
  const existing = await existingTxt(ctx.token, ctx.zoneId, name);
  const prev = existing.map((r) => (r.content.match(/id=([0-9]+)/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a)[0] || 0;
  const id = Math.max(prev + 1, Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) * 100);
  const content = `v=STSv1; id=${id}`;
  const res = await putTxt(ctx, name, content, { log, confirm });
  return { enabled: true, ...res, id };
}

/** _smtp._tls TLS-RPT TXT — receivers report TLS-negotiation failures here. confirm-gated. */
export async function writeTlsRpt(cfg, { log = () => {}, confirm = false, rua = null } = {}) {
  const ctx = await zoneCtx(cfg, log); if (!ctx) return { enabled: false };
  const content = `v=TLSRPTv1; rua=mailto:${rua || `tls-reports@${cfg.domain}`}`;
  const res = await putTxt(ctx, `_smtp._tls.${cfg.domain}`, content, { log, confirm });
  return { enabled: true, ...res };
}

/**
 * One-pass site-verification TXT writer for GSC / Bing / Pinterest. confirm-gated.
 * Lighting these up is what unlocks the FREE GSC/Bing connectors with no manual step.
 */
export async function writeVerification(cfg, { log = () => {}, confirm = false, google = null, bing = null, pinterest = null } = {}) {
  const ctx = await zoneCtx(cfg, log); if (!ctx) return { enabled: false };
  const planned = [];
  if (google) planned.push([cfg.domain, `google-site-verification=${google}`]);
  if (bing) planned.push([cfg.domain, `MS=${bing}`]);
  if (pinterest) planned.push([cfg.domain, `pinterest-site-verification=${pinterest}`]);
  if (!planned.length) { log('  No verification tokens passed (google/bing/pinterest).'); return { enabled: true, skipped: true }; }
  const out = [];
  for (const [name, content] of planned) out.push(await putTxt(ctx, name, content, { log, confirm }));
  return { enabled: true, records: out };
}

/**
 * Host the IndexNow key as a DNS fallback. IndexNow primarily wants the key at
 * https://{host}/{key}.txt; some setups also accept a TXT carrying it. confirm-gated.
 */
export async function writeIndexNowKey(cfg, { log = () => {}, confirm = false, key = process.env.INDEXNOW_KEY || cfg.indexnowKey } = {}) {
  const ctx = await zoneCtx(cfg, log); if (!ctx) return { enabled: false };
  if (!key) { log('  No IndexNow key (set INDEXNOW_KEY or cfg.indexnowKey).'); return { enabled: true, skipped: true }; }
  const res = await putTxt(ctx, `_indexnow.${cfg.domain}`, `indexnow=${key}`, { log, confirm });
  return { enabled: true, ...res, note: 'Primary IndexNow proof is still the hosted /{key}.txt file; this TXT is a fallback.' };
}

/**
 * Convenience: run the read/score path and return everything for a report.
 * (Writers are intentionally NOT invoked here — they are confirm-gated and called
 * explicitly by onboarding / orchestrator steps.)
 */
export async function auditDnsTrust(cfg, dns, { log = () => {} } = {}) {
  const trust = await scoreDnsTrust(dns, { log });
  trust.summary = [
    `DNS-trust score: ${trust.score}/100`,
    `DNSSEC: ${trust.signals.dnssec ? 'enabled' : 'OFF'} · CAA: ${trust.signals.caa ? trust.signals.caaIssuers.join('/') : 'MISSING (any CA can issue)'}${trust.signals.iodef ? ' +iodef' : ''}`,
  ];
  return trust;
}
