// seo-bot · email-auth — email-authentication posture scorer (SPF / DMARC / DKIM / MX).
//
// FRAMING (read this before touching the file): these are TRUST / VERIFICATION /
// DELIVERABILITY levers, NOT direct ranking factors. SPF/DKIM/DMARC do not move
// rankings. Their value is that off-domain outreach (the Epic-15 moat: PR pitches,
// HARO, citation requests) actually lands in inboxes instead of spam, and that the
// sending domain reads as a real, trustworthy business — the foundation OTTO, a
// SaaS overlay that never touches DNS, structurally cannot build. See the plan §8.
//
// Input is the record set already parsed by onboard/dns.mjs (lookupDns()): we do NOT
// re-resolve DNS here. DKIM is checked opportunistically (selectors aren't enumerable
// from a zone scan), so a caller may pass discovered selectors. Every proposal is the
// standard shape { type, severity, current, proposed, rationale, autoApplicable:false }
// — DNS writes are too hard to reverse to ever auto-apply; connect/dns.mjs owns the
// confirm-gated writers.

/** Common DKIM selectors worth probing per provider when none are supplied. */
export const COMMON_DKIM_SELECTORS = ['google', 'selector1', 'selector2', 's1', 's2', 'k1', 'k2', 'default', 'dkim', 'mail', 'mandrill', 'pic', 'zoho', 'fm1', 'fm2', 'fm3'];

/** Parse an SPF record into its mechanisms + the terminating "all" qualifier. */
export function parseSpf(spf) {
  if (!spf) return null;
  const terms = spf.trim().split(/\s+/);
  const all = terms.find((t) => /[-~?+]?all$/i.test(t)) || null;
  const qualifier = all ? (all.match(/^([-~?+])?all$/i)?.[1] || '+') : null; // missing qualifier == "+all"
  const lookups = terms.filter((t) => /^(include:|a$|a:|mx$|mx:|ptr|exists:|redirect=)/i.test(t)).length;
  return { record: spf, all, qualifier, lookups, hasPtr: /\bptr\b/i.test(spf) };
}

/** Parse a DMARC record into the tags that drive the score (p, pct, rua, sp, adkim/aspf). */
export function parseDmarc(dmarc) {
  if (!dmarc) return null;
  const tag = (k) => (dmarc.match(new RegExp(`${k}=([^;]+)`, 'i')) || [])[1]?.trim() || null;
  return {
    record: dmarc,
    p: (tag('p') || 'none').toLowerCase(),
    sp: tag('sp')?.toLowerCase() || null,
    pct: tag('pct') ? Number(tag('pct')) : 100,
    rua: tag('rua'),
    ruf: tag('ruf'),
    adkim: tag('adkim'),
    aspf: tag('aspf'),
  };
}

/**
 * Compute a 0-100 email-trust score + fix proposals from parsed DNS records.
 * @param dns the object returned by onboard/dns.mjs lookupDns() (or its .derived/.records)
 * @param opts.dkimSelectors discovered DKIM selectors (string[]) if a DKIM probe ran
 * @returns { score, signals, proposals[] }
 */
export function scoreEmailAuth(dns, { dkimSelectors = [] } = {}) {
  const derived = dns?.derived || dns || {};
  const records = dns?.records || {};
  const domain = dns?.domain || derived.domain || '';

  const hasMx = derived.hasEmail ?? ((records.mx || []).length > 0);
  const spf = parseSpf(derived.spfRecord || (records.txt || []).find((t) => /^v=spf1/i.test(t)) || null);
  const dmarc = parseDmarc(derived.dmarcRecord || (records.dmarc || []).map((t) => Array.isArray(t) ? t.join('') : t).find((t) => /^v=DMARC1/i.test(t)) || null);
  const dkim = dkimSelectors.filter(Boolean);

  // --- scoring (weights: SPF 25 · DMARC 40 · DKIM 20 · MX 15) ---
  let score = 0;
  const signals = { hasMx, spf: spf ? spf.qualifier : null, dmarcPolicy: dmarc ? dmarc.p : null, dkimSelectors: dkim };

  if (hasMx) score += 15;
  if (spf) {
    score += 15;
    if (spf.qualifier === '-') score += 10;       // hard fail — full credit
    else if (spf.qualifier === '~') score += 6;   // soft fail — partial
    // "+all" / "?all" / missing qualifier earns nothing beyond presence (it's a hole)
    if (spf.lookups > 10) score -= 4;             // RFC 7208 10-lookup limit → SPF permerror
  }
  if (dmarc) {
    score += 10;                                  // presence
    if (dmarc.p === 'reject') score += 30;
    else if (dmarc.p === 'quarantine') score += 20;
    else score += 4;                              // p=none monitors but enforces nothing
    if (dmarc.rua) score += 0;                    // rua needed for promotion but no score weight
    if ((dmarc.pct ?? 100) < 100 && dmarc.p !== 'none') score -= 4; // partial enforcement
  }
  if (dkim.length) score += 20;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // --- proposals (standard shape; never auto-applicable — DNS is hard to reverse) ---
  const proposals = [];
  const P = (severity, current, proposed, rationale, extra = {}) => proposals.push({ type: 'email-auth', severity, current, proposed, rationale, autoApplicable: false, ...extra });

  if (!hasMx) {
    P('medium', 'no MX record (no business email on the domain)',
      `Add MX records for your mail provider (e.g. Google Workspace ASPMX, or M365).`,
      'No MX = the domain cannot receive mail; off-domain outreach (Epic 15) has no inbox to reply to and the domain reads as parked. Trust/deliverability lever, not a ranking factor.',
      { record: 'MX' });
  }

  if (!spf) {
    P('high', 'SPF: MISSING',
      `v=spf1 ${hasMx && /google/i.test((records.mx || []).map((m) => m.exchange).join(' ')) ? 'include:_spf.google.com ' : ''}-all`,
      'Without SPF, receivers cannot confirm which servers may send for the domain → outreach lands in spam and the domain is trivially spoofable.',
      { record: 'SPF' });
  } else if (spf.qualifier === '+' || spf.qualifier === '?') {
    P('high', `SPF too permissive: "${spf.all}" (${spf.qualifier === '+' ? '+all passes ALL senders' : '?all is neutral'})`,
      spf.record.replace(/[+?]?all$/i, '~all') + '  (then graduate to -all)',
      'A +all/?all SPF authorizes the whole internet to send as you — worse than no SPF for deliverability and spoofing. Tighten to ~all, then -all once legitimate senders are enumerated.',
      { record: 'SPF' });
  } else if (spf.lookups > 10) {
    P('medium', `SPF DNS lookups: ${spf.lookups} (RFC 7208 limit is 10 → permerror)`,
      'Flatten includes / consolidate senders so the record resolves <= 10 DNS lookups.',
      'Over 10 lookups makes SPF return permerror, which many receivers treat as a fail — silently breaking deliverability.',
      { record: 'SPF' });
  }

  if (!dmarc) {
    P('high', 'DMARC: MISSING',
      `_dmarc.${domain} TXT  "v=DMARC1; p=none; rua=mailto:dmarc@${domain}"  (start at none to gather rua, then promote)`,
      'No DMARC = no policy telling receivers what to do with spoofed mail, and no aggregate (rua) visibility into who sends as you. Start at p=none to monitor; connect/dns.mjs can stage promotion once rua reports clear a threshold.',
      { record: 'DMARC' });
  } else if (dmarc.p === 'none') {
    P('medium', `DMARC p=none (monitoring only — enforces nothing)`,
      `Promote _dmarc.${domain} to p=quarantine, then p=reject once rua aggregate reports show authenticated-pass is high.`,
      'p=none watches but never blocks spoofed mail. Staged promotion none→quarantine→reject is the deliverability + brand-trust win; do it gated on rua data (data/dmarc.mjs + stats horizon), never blindly.',
      { record: 'DMARC' });
  } else if ((dmarc.pct ?? 100) < 100) {
    P('low', `DMARC pct=${dmarc.pct} (policy applies to only ${dmarc.pct}% of mail)`,
      'Once confident, set pct=100 so the policy covers all mail.',
      'A pct below 100 leaves a spoofing gap proportional to the untreated percentage.',
      { record: 'DMARC' });
  }
  if (dmarc && !dmarc.rua) {
    P('low', 'DMARC has no rua (no aggregate reporting address)',
      `Add rua=mailto:dmarc@${domain} so receivers send aggregate XML reports.`,
      'rua reports are the only feedback loop that lets us safely promote the policy (data/dmarc.mjs parses them); without rua, promotion is flying blind.',
      { record: 'DMARC' });
  }

  if (!dkim.length) {
    P('medium', 'DKIM: no selectors detected',
      'Enable DKIM signing at the mail provider and publish the selector._domainkey TXT (e.g. google._domainkey for Workspace).',
      'DKIM cryptographically signs mail; it is what DMARC alignment most reliably passes on. Missing DKIM means DMARC enforcement risks dropping legitimate mail. (Selectors are not enumerable from a zone scan — probe known selectors or read them from the provider.)',
      { record: 'DKIM' });
  }

  return { score, signals, proposals };
}

/** Compact human summary lines for a report. */
export function summarizeEmailAuth(result) {
  const s = result.signals;
  return [
    `Email-trust score: ${result.score}/100`,
    `MX: ${s.hasMx ? 'yes' : 'MISSING'} · SPF: ${s.spf ? `"${s.spf}all"` : 'MISSING'} · DMARC: ${s.dmarcPolicy ? `p=${s.dmarcPolicy}` : 'MISSING'} · DKIM: ${s.dkimSelectors.length ? s.dkimSelectors.join(', ') : 'none detected'}`,
    `${result.proposals.length} fix proposal(s) (trust/deliverability levers — not ranking factors)`,
  ];
}
