// seo-bot · onboard/dns — pull a domain's DNS records (free, Node stdlib) and
// derive the SEO/ownership/trust signals that matter when onboarding a new site:
//   A/AAAA   -> hosting / CDN (Vercel, Cloudflare, etc.)
//   MX       -> email provider (Workspace/M365) — a live business signal
//   TXT      -> SPF / DMARC (domain trust + deliverability) + verification tokens
//   NS       -> DNS host / registrar
//   CAA, SOA -> cert authority + zone authority
// No external dependency; falls back to DNS-over-HTTPS (Cloudflare) for anything
// the local resolver can't answer.

import { promises as dns } from 'node:dns';

const safe = async (fn) => { try { return await fn(); } catch { return []; } };

async function doh(name, type) {
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.Answer || []).map((a) => a.data.replace(/^"|"$/g, ''));
  } catch { return []; }
}

const MX_PROVIDERS = [
  [/google|googlemail|aspmx/i, 'Google Workspace'],
  [/outlook|office365|microsoft/i, 'Microsoft 365'],
  [/zoho/i, 'Zoho Mail'],
  [/proofpoint|pphosted/i, 'Proofpoint'],
  [/mimecast/i, 'Mimecast'],
  [/secureserver|godaddy/i, 'GoDaddy email'],
  [/messagingengine|fastmail/i, 'Fastmail'],
];
const NS_PROVIDERS = [
  [/cloudflare/i, 'Cloudflare DNS'],
  [/awsdns/i, 'AWS Route 53'],
  [/vercel-dns/i, 'Vercel DNS'],
  [/googledomains|google/i, 'Google Domains/Cloud DNS'],
  [/domaincontrol|godaddy/i, 'GoDaddy'],
  [/nsone|ns1/i, 'NS1'],
  [/dnsmadeeasy/i, 'DNS Made Easy'],
  [/registrar-servers|namecheap/i, 'Namecheap'],
];

function match(list, hay) {
  for (const [re, name] of list) if (re.test(hay)) return name;
  return null;
}

/** Pull + derive DNS intelligence for a domain. */
export async function lookupDns(domain) {
  const d = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  const [a, aaaa, mxRaw, txtRaw, ns, caaRaw, soaRaw, dmarcRaw] = await Promise.all([
    safe(() => dns.resolve4(d)),
    safe(() => dns.resolve6(d)),
    safe(() => dns.resolveMx(d)),
    safe(() => dns.resolveTxt(d)),
    safe(() => dns.resolveNs(d)),
    safe(() => dns.resolveCaa(d)),
    safe(() => dns.resolveSoa(d).then((s) => [s])),
    safe(() => dns.resolveTxt(`_dmarc.${d}`)),
  ]);

  const mx = (mxRaw.length ? mxRaw : (await doh(d, 'MX')).map((x) => { const [p, e] = x.split(' '); return { priority: Number(p) || 0, exchange: (e || x).replace(/\.$/, '') }; }))
    .sort((x, y) => x.priority - y.priority);
  const txt = (txtRaw.length ? txtRaw.map((t) => t.join('')) : await doh(d, 'TXT'));
  const dmarcTxt = (dmarcRaw.length ? dmarcRaw.map((t) => t.join('')) : await doh(`_dmarc.${d}`, 'TXT'));
  const caa = caaRaw.map((c) => (c.issue || c.issuewild || JSON.stringify(c)));

  // Derive signals
  const spf = txt.find((t) => /^v=spf1/i.test(t)) || null;
  const dmarc = dmarcTxt.find((t) => /^v=DMARC1/i.test(t)) || null;
  const verifications = [];
  for (const t of txt) {
    if (/google-site-verification=/.test(t)) verifications.push({ provider: 'Google Search Console', token: t.split('=')[1] });
    else if (/^MS=/.test(t)) verifications.push({ provider: 'Microsoft/Bing', token: t.slice(3) });
    else if (/facebook-domain-verification=/.test(t)) verifications.push({ provider: 'Meta', token: t.split('=')[1] });
    else if (/apple-domain-verification=/.test(t)) verifications.push({ provider: 'Apple', token: t.split('=')[1] });
    else if (/stripe-verification=/.test(t)) verifications.push({ provider: 'Stripe', token: t.split('=')[1] });
  }
  const emailProvider = mx.length ? (match(MX_PROVIDERS, mx.map((m) => m.exchange).join(' ')) || mx[0].exchange) : null;
  const dnsHost = ns.length ? (match(NS_PROVIDERS, ns.join(' ')) || ns[0]) : null;

  return {
    domain: d, fetchedAt: new Date().toISOString(),
    records: { a, aaaa, mx, txt, ns, caa, soa: soaRaw[0] || null, dmarc: dmarcTxt },
    derived: {
      hasWebHosting: a.length > 0 || aaaa.length > 0,
      emailProvider, hasEmail: mx.length > 0,
      dnsHost,
      spf: !!spf, spfRecord: spf,
      dmarc: !!dmarc, dmarcRecord: dmarc,
      dmarcPolicy: dmarc ? (dmarc.match(/p=(\w+)/) || [])[1] || 'none' : null,
      verifications,
      certAuthorities: caa,
    },
  };
}

/** Compact human summary lines for a report. */
export function summarizeDns(info) {
  const d = info.derived;
  const lines = [];
  lines.push(`A: ${info.records.a.join(', ') || '—'}${info.records.aaaa.length ? ` · AAAA: ${info.records.aaaa.join(', ')}` : ''}`);
  lines.push(`DNS host: ${d.dnsHost || '—'} (${info.records.ns.join(', ') || 'no NS'})`);
  lines.push(`Email: ${d.hasEmail ? d.emailProvider : 'no MX (no business email on domain)'}`);
  lines.push(`SPF: ${d.spf ? 'yes' : 'MISSING'} · DMARC: ${d.dmarc ? `yes (p=${d.dmarcPolicy})` : 'MISSING'}`);
  lines.push(`Site verifications present: ${d.verifications.length ? d.verifications.map((v) => v.provider).join(', ') : 'none found'}`);
  if (info.records.caa.length) lines.push(`CAA (cert issuers): ${info.records.caa.join(', ')}`);
  return lines;
}
