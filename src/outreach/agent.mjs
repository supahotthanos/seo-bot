// seo-bot · offsite/outreach-agent — the SENDING outreach agent (operator's order 2026-07-12:
// "remove the human edit step entirely; the agent sends"). EMAIL lane only — forum/Reddit posting
// stays out (platforms ban posting bots; that's account-death, not an editing question).
//
// How it stays white-hat while fully automated:
//   - targets come from evidence (the offsite worksheet / thread-radar: sites AI engines already
//     cite where we belong) — never bought lists
//   - every pitch is TRUTHFUL: honest identification (who we are, why we're writing), a real
//     physical address + an opt-out line (CAN-SPAM), no deceptive subjects
//   - suppression is permanent-by-default: one contact per domain per 90 days; any "no thanks"
//     reply goes on the permanent suppression list
//   - throttled: small daily cap, alternating between the two Mini mailboxes
//   - the SEND switch is config (outreach.autoSend=true) + per-run; default writes an outbox only
// Transport: Gmail API (send-only scope) via the existing Google OAuth machinery — the two
// mailboxes each hold their own token (connect-mailbox <email>), sends logged to outreach-log.ndjson.

const norm = (d = '') => String(d).toLowerCase().replace(/^www\./, '').trim();
const localPart = (email = '') => String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');

/** PURE: build today's send queue — evidence-bearing targets with emails, deduped by domain,
 *  suppressed (90d re-contact + opt-outs), capped, round-robined across the sending accounts. */
export function buildOutreachQueue(targets = [], { sentLog = [], suppression = [], dailyCap = 8, accounts = [], nowIso = '' } = {}) {
  const nowMs = Date.parse(nowIso) || Date.now();
  const suppressed = new Set(suppression.map(norm));
  const lastSent = new Map();
  for (const s of sentLog) { const d = norm(s.domain || s.to?.split('@')[1]); if (d) lastSent.set(d, Math.max(lastSent.get(d) || 0, Date.parse(s.sentAt || s.at || 0) || 0)); }
  const seen = new Set();
  const queue = [], skipped = [];
  for (const t of targets) {
    const domain = norm(t.domain || (t.url ? (() => { try { return new URL(t.url).hostname; } catch { return ''; } })() : ''));
    const email = String(t.email || t.contactEmail || '').trim().toLowerCase();
    if (!domain) continue;
    if (!email || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { skipped.push({ domain, reason: 'no-contact-email' }); continue; }
    if (suppressed.has(domain) || suppressed.has(email)) { skipped.push({ domain, reason: 'suppressed (opt-out)' }); continue; }
    if (seen.has(domain)) { skipped.push({ domain, reason: 'dedup (one per domain per run)' }); continue; }
    const last = lastSent.get(domain) || 0;
    if (nowMs - last < 90 * 864e5 && last > 0) { skipped.push({ domain, reason: '90-day re-contact window' }); continue; }
    seen.add(domain);
    queue.push({ domain, email, evidence: t.evidence || t.why || t.reason || '', url: t.url || `https://${domain}`, tier: t.tier || null });
    if (queue.length >= dailyCap) break;
  }
  // Round-robin the senders so neither mailbox carries the whole volume.
  const accs = accounts.filter(Boolean);
  queue.forEach((q, i) => { q.from = accs.length ? accs[i % accs.length] : null; });
  return { queue, skipped };
}

/** PURE: wrap a drafted pitch body with the compliance frame (CAN-SPAM: identify, locate, opt-out). */
export function renderPitch({ subject = '', body = '' }, cfg = {}) {
  const nap = cfg.listings?.canonicalNap || {};
  const address = [nap.address || nap.street, nap.city, nap.state, nap.zip].filter(Boolean).join(', ');
  const brand = cfg.brand || cfg.name || '';
  const site = cfg.baseUrl || '';
  const footer = [
    '—',
    `${brand} · ${site}`,
    address || null,
    `You're receiving this one-time note because of your site's coverage in this space. Reply "no thanks" and we won't email again.`,
  ].filter(Boolean).join('\n');
  return { subject: String(subject).slice(0, 120), text: `${String(body).trim()}\n\n${footer}` };
}

/** PURE: compliance lint — a pitch that fails any of these NEVER sends. */
export function validatePitch(msg = {}, cfg = {}) {
  const v = [];
  const t = String(msg.text || '');
  if (!msg.subject || msg.subject.length < 8) v.push('subject too short');
  if (/re:|fwd:/i.test(msg.subject || '')) v.push('deceptive subject (fake reply/forward)');
  if (!new RegExp((cfg.brand || cfg.name || 'x').split(' ')[0], 'i').test(t)) v.push('pitch does not identify the sender brand');
  if (!/reply "?no thanks"?|unsubscribe|won'?t email again/i.test(t)) v.push('missing opt-out line (CAN-SPAM)');
  if (!/(\d{1,5} [^\n,]{3,40},? [A-Za-z .]{2,25}|,\s*[A-Z]{2}\b)/.test(t)) v.push('missing physical address (CAN-SPAM)');
  if (words(t) > 220) v.push(`pitch too long (${words(t)} words > 220 — nobody links from an essay)`);
  if (/guarantee|top ranking|#1 on google/i.test(t)) v.push('spam-register claims (guarantees)');
  return { ok: v.length === 0, violations: v };
}
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

const PITCH_SYSTEM = `You write 90-140 word outreach emails that earn links/mentions. Voice: direct, specific, zero flattery-spam. Structure: (1) one concrete observation about THEIR page (from the evidence), (2) the exact resource of ours that fits it and why their readers gain, (3) one low-friction ask. Never promise rankings, never bulk-flatter, never lie about how you found them. Output JSON: {"subject":"...","body":"..."} — subject is plain and truthful, no clickbait.`;

/** Draft one personalized pitch via the LLM. */
export async function draftPitch(target = {}, cfg = {}, { llm } = {}) {
  const prompt = [
    `Target site: ${target.domain} (${target.url}).`,
    target.evidence ? `Evidence / why they matter: ${target.evidence}` : '',
    `Us: ${cfg.brand || cfg.name} — ${cfg.baseUrl}. What we want them to see: ${cfg.outreach?.asset || cfg.baseUrl} (${cfg.outreach?.assetPitch || 'a data-backed resource their readers would use'}).`,
    'Write the email JSON now.',
  ].filter(Boolean).join('\n');
  const raw = await llm(prompt, { system: PITCH_SYSTEM, maxTokens: 500, tag: 'outreach-pitch' });
  if (!raw || typeof raw !== 'string') throw new Error('LLM returned nothing for the pitch');
  const j = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const s = j.indexOf('{'), e = j.lastIndexOf('}');
  return JSON.parse(s >= 0 && e > s ? j.slice(s, e + 1) : j);
}

/** Gmail API transport (send-only). Token per mailbox under the name `mailbox-<localpart>` —
 *  created once per account via `connect-mailbox <email>` run where that account's browser lives. */
export async function sendViaGmail(from, { to, subject, text }, { getToken, fetchImpl = fetch } = {}) {
  const tok = await getToken(`mailbox-${localPart(from)}`);
  if (!tok) throw new Error(`no Gmail token for ${from} — run: seo-bot connect-mailbox ${from} (on the Mini)`);
  const rfc822 = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', text].join('\r\n');
  const raw = Buffer.from(rfc822, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`gmail send ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { id: j.id, threadId: j.threadId };
}

/**
 * The agent run: targets → queue → draft → compliance lint → SEND (or outbox when autoSend is off)
 * → log. deps: { fs, dir, llm, send, log, nowIso }. `send(from, msg)` injected (tests: fake;
 * live: sendViaGmail). Fail-closed per item; one bad pitch never stops the run.
 */
export async function runOutreach(cfg = {}, { targets = [], deps = {}, dryRun = false, maxSends = null } = {}) {
  const { fs, dir, llm, send, log = () => {}, nowIso = new Date().toISOString() } = deps;
  if (!fs || !dir || !llm) throw new Error('runOutreach needs { fs, dir, llm }');
  fs.mkdirSync(dir, { recursive: true });
  const logFile = `${dir}/outreach-log.ndjson`;
  const supFile = `${dir}/outreach-suppression.json`;
  const sentLog = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const suppression = fs.existsSync(supFile) ? JSON.parse(fs.readFileSync(supFile, 'utf8')) : [];
  const accounts = cfg.outreach?.accounts || [];
  const { queue, skipped } = buildOutreachQueue(targets, { sentLog, suppression, accounts, nowIso, dailyCap: maxSends ?? cfg.outreach?.dailyCap ?? 8 });
  log(`  outreach: ${queue.length} queued · ${skipped.length} skipped (${[...new Set(skipped.map((s) => s.reason))].join(' · ') || '—'})`);
  const autoSend = cfg.outreach?.autoSend === true && !dryRun;
  const results = [];
  for (const q of queue) {
    try {
      const draft = await draftPitch(q, cfg, { llm });
      const msg = renderPitch(draft, cfg);
      const lint = validatePitch(msg, cfg);
      if (!lint.ok) { results.push({ ...q, status: 'lint-failed', violations: lint.violations }); log(`  ✗ ${q.domain}: ${lint.violations.join(' · ')}`); continue; }
      if (!autoSend) {
        fs.writeFileSync(`${dir}/outbox-${q.domain.replace(/[^a-z0-9.-]/g, '_')}.txt`, `From: ${q.from}\nTo: ${q.email}\nSubject: ${msg.subject}\n\n${msg.text}`);
        results.push({ ...q, status: dryRun ? 'dry-run' : 'outbox', subject: msg.subject });
        log(`  ▢ ${q.domain}: drafted → outbox (${dryRun ? 'dry-run' : 'autoSend off'})`);
      } else {
        if (!send) throw new Error('autoSend on but no send transport');
        const r = await send(q.from, { to: q.email, subject: msg.subject, text: msg.text });
        results.push({ ...q, status: 'sent', subject: msg.subject, messageId: r.id || null });
        fs.appendFileSync(logFile, JSON.stringify({ at: nowIso, sentAt: nowIso, domain: q.domain, to: q.email, from: q.from, subject: msg.subject, messageId: r.id || null }) + '\n');
        log(`  ✉ SENT ${q.domain} ← ${q.from}`);
      }
    } catch (e) {
      results.push({ ...q, status: 'error', error: String(e.message || e).slice(0, 160) });
      log(`  ! ${q.domain}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  return { queued: queue.length, sent: results.filter((r) => r.status === 'sent').length, outbox: results.filter((r) => r.status === 'outbox' || r.status === 'dry-run').length, skipped, results, autoSend };
}
