// seo-bot · data/dmarc — DMARC aggregate (rua) report parser.
//
// FRAMING: this feeds the AUTONOMOUS DMARC PROMOTION loop (plan Epic 4, C3). DMARC
// is a deliverability / trust lever, NOT a ranking factor. The promotion gate
// (none → quarantine → reject) advances only when the authenticated-pass rate clears
// a threshold over a locked horizon — reuse stats/controller.mjs for that decision.
// connect/dns.mjs writeDmarc() applies the chosen step; this module supplies the data.
//
// rua reports arrive as gzipped XML attachments to a mailbox. MAILBOX POLLING IS A
// TODO (transport) — this parser is the pure, testable core: hand it the decompressed
// XML string (or a file path) and it returns normalized rows. No external deps; a tiny
// regex/scan reader (the XML is shallow and regular: <record><row><source_ip>…).

import { readFileSync, existsSync } from 'node:fs';

/** Pull the first text value of a tag within a chunk (shallow, attribute-agnostic). */
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** All <record>…</record> chunks. */
function records(xml) {
  return [...xml.matchAll(/<record\b[^>]*>([\s\S]*?)<\/record>/gi)].map((m) => m[1]);
}

/**
 * Parse a DMARC rua aggregate XML document.
 * @param input XML string, OR a filesystem path to a (decompressed) XML file
 * @returns { reporter, domain, dateRange:{begin,end}, rows:[{sourceIp,spf,dkim,disposition,count}], totals }
 */
export function parseDmarcAggregate(input) {
  let xml = input || '';
  if (typeof input === 'string' && !/[<]/.test(input) && existsSync(input)) xml = readFileSync(input, 'utf-8');
  if (!/<feedback/i.test(xml)) return { reporter: null, domain: null, dateRange: null, rows: [], totals: empty() };

  const meta = xml.match(/<report_metadata\b[^>]*>([\s\S]*?)<\/report_metadata>/i)?.[1] || '';
  const pub = xml.match(/<policy_published\b[^>]*>([\s\S]*?)<\/policy_published>/i)?.[1] || '';
  const reporter = tag(meta, 'org_name');
  const domain = tag(pub, 'domain');
  const begin = Number(tag(meta, 'begin')) || null;
  const end = Number(tag(meta, 'end')) || null;

  const rows = [];
  for (const rec of records(xml)) {
    const row = rec.match(/<row\b[^>]*>([\s\S]*?)<\/row>/i)?.[1] || '';
    const policy = row.match(/<policy_evaluated\b[^>]*>([\s\S]*?)<\/policy_evaluated>/i)?.[1] || '';
    rows.push({
      sourceIp: tag(row, 'source_ip'),
      count: Number(tag(row, 'count')) || 0,
      disposition: (tag(policy, 'disposition') || 'none').toLowerCase(),  // none | quarantine | reject
      spf: (tag(policy, 'spf') || tag(rec, 'spf') || 'fail').toLowerCase(), // pass | fail
      dkim: (tag(policy, 'dkim') || tag(rec, 'dkim') || 'fail').toLowerCase(),
    });
  }

  return { reporter, domain, dateRange: begin && end ? { begin, end } : null, rows, totals: tally(rows) };
}

function empty() { return { messages: 0, dmarcPass: 0, spfPass: 0, dkimPass: 0, dmarcPassRate: 0, quarantined: 0, rejected: 0 }; }

/** Aggregate rows into the totals the promotion gate cares about. */
export function tally(rows = []) {
  const t = empty();
  for (const r of rows) {
    const n = r.count || 0;
    t.messages += n;
    const spfOk = r.spf === 'pass';
    const dkimOk = r.dkim === 'pass';
    if (spfOk) t.spfPass += n;
    if (dkimOk) t.dkimPass += n;
    // DMARC passes when at least one of SPF/DKIM passes AND is aligned. Aggregate
    // policy_evaluated already reflects alignment, so treat any pass here as aligned.
    if (spfOk || dkimOk) t.dmarcPass += n;
    if (r.disposition === 'quarantine') t.quarantined += n;
    if (r.disposition === 'reject') t.rejected += n;
  }
  t.dmarcPassRate = t.messages ? Math.round((t.dmarcPass / t.messages) * 1000) / 1000 : 0;
  return t;
}

/** Merge totals across several parsed reports (a polling window). */
export function mergeReports(reports = []) {
  const all = reports.flatMap((r) => r.rows || []);
  return { reports: reports.length, rows: all.length, totals: tally(all) };
}

/**
 * Promotion recommendation given merged totals + the current policy.
 * Conservative defaults; the REAL gate should wrap this in stats/controller.mjs over a
 * locked horizon (don't promote on a single noisy window).
 * @returns { canPromote, next, reason }
 */
export function recommendPromotion(totals, currentPolicy = 'none', { minMessages = 100, passThreshold = 0.98 } = {}) {
  const order = { none: 'quarantine', quarantine: 'reject', reject: null };
  const next = order[currentPolicy] ?? 'quarantine';
  if (!next) return { canPromote: false, next: null, reason: 'already at p=reject' };
  if ((totals.messages || 0) < minMessages) return { canPromote: false, next, reason: `insufficient volume (${totals.messages} < ${minMessages})` };
  if ((totals.dmarcPassRate || 0) < passThreshold) return { canPromote: false, next, reason: `pass rate ${(totals.dmarcPassRate * 100).toFixed(1)}% < ${passThreshold * 100}% — fix failing senders first` };
  return { canPromote: true, next, reason: `pass rate ${(totals.dmarcPassRate * 100).toFixed(1)}% over ${totals.messages} msgs clears the bar` };
}

// TODO(transport): mailbox polling. Connect an IMAP/Graph mailbox, pull rua attachments,
// gunzip (.gz) / unzip (.zip) the XML, then feed each through parseDmarcAggregate().
// Kept out of this module so the parser stays pure + testable with no creds/deps.
