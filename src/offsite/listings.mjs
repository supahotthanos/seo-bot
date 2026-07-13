// seo-bot · offsite/listings — MECHANICAL listings sync. Generates exact per-directory
// payloads from cfg.listings.canonicalNap and executes the (very few) targets that have a
// real free API when creds exist (GBP via the OAuth business.manage scope). Everything
// else — Bing Places, Apple Business Connect, Data Axle, Foursquare, Yelp, RealSelf,
// Healthgrades, Zocdoc — has NO free write API, so we emit a complete pre-filled payload
// file + step-by-step submit instructions with status 'SKIPPED-NO-CREDS' (visible, never
// silent). Missing canonicalNap refuses the WHOLE step (fail closed — a wrong NAP
// syndicated to aggregators is the most expensive local-SEO mistake to undo).
//
// Evidence/source: research/medspa-seo-framework.md (citations tiers),
// research/medspa-directory-gap-backlog.md, src/listings/targets.mjs (verified registry).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';
import { nowIso } from '../util.mjs';
import { normalizeNap } from '../listings/index.mjs';
import { CITATION_TARGETS } from '../listings/targets.mjs';

// Directory targets we generate submission payloads for (subset of the registry that is a
// real third-party listing — on-site rows like booking-embed/schema are the apply layer's job).
export const PAYLOAD_TARGETS = ['gbp', 'bing-places', 'apple-business', 'data-axle', 'foursquare', 'yelp', 'realself', 'healthgrades', 'zocdoc'];

/** Per-directory step-by-step submit instructions (for the no-creds human path). */
const SUBMIT_STEPS = {
  'gbp': ['Sign in at https://business.google.com', 'Create/claim the profile with the EXACT payload NAP', 'Pick primary category "Medical Spa" + service categories', 'Complete mail/phone/video verification', 'Paste the description + hours from the payload'],
  'bing-places': ['Go to https://www.bing.com/business', 'Use "Import from Google" if GBP exists (fastest), else create with the payload NAP', 'Verify by phone/email/postcard'],
  'apple-business': ['Sign in at https://business.apple.com with a company Apple ID', 'Add the location with the EXACT payload NAP', 'Verify the business (phone or documentation)', 'Add categories + photos from the payload'],
  'data-axle': ['Go to https://www.data-axle.com/our-data/business-data/ and use the free claim/update portal', 'Search for the business, claim it, correct every field to the payload NAP'],
  'foursquare': ['Claim at https://business.foursquare.com', 'Match every field to the payload NAP', 'Verify ownership'],
  'yelp': ['Claim at https://biz.yelp.com', 'Match NAP exactly; add photos + categories from the payload', 'NEVER solicit reviews from the dashboard (FTC 16 CFR 465 / Yelp filter)'],
  'realself': ['Create the practice profile at https://www.realself.com/dashboard', 'Match NAP; list providers with real credentials'],
  'healthgrades': ['Claim via https://www.healthgrades.com/provider-resources', 'Match NAP; verify the supervising provider license details'],
  'zocdoc': ['PAID listing — get owner approval first (worksheet action=pay)', 'Then join at https://www.zocdoc.com/join with the payload NAP'],
};

/**
 * Build exact per-directory payloads from the canonical NAP. Pure.
 * Fail closed: no cfg.listings.canonicalNap → { refused:true } for the WHOLE listings step.
 */
export function buildListingPayloads(cfg) {
  const rawNap = cfg?.listings?.canonicalNap;
  const canonical = rawNap ? normalizeNap(rawNap) : null;
  if (!canonical || !canonical.name || !canonical.phone || !canonical.address) {
    return {
      refused: true,
      reason: 'listings.canonicalNap is missing or incomplete (need name + phone + address) — refusing the ENTIRE listings step: syndicating a wrong/partial NAP is worse than doing nothing.',
      fix: `Run \`node seo-bot/bin/seo-bot.mjs onboard ${cfg?.domain || '<domain>'}\`, confirm the NAP with the owner, then set listings.canonicalNap { name, phone, address, url } in config/${cfg?.name || '<client>'}.json. \`doctor ${cfg?.name || '<client>'}\` re-checks.`,
      payloads: [],
    };
  }
  const website = rawNap.url || cfg.baseUrl;
  const byId = new Map(CITATION_TARGETS.map((t) => [t.id, t]));
  const payloads = PAYLOAD_TARGETS.filter((id) => byId.has(id)).map((id) => {
    const t = byId.get(id);
    return {
      targetId: id,
      targetName: t.name,
      tier: t.tier,
      free: t.free,
      submitUrl: t.url || null,
      napRule: t.napRule,
      payload: {
        businessName: rawNap.name,
        phone: rawNap.phone,
        address: rawNap.address,
        website,
        categories: cfg.vertical === 'medspa' ? ['Medical Spa', ...(cfg.services || []).slice(0, 8)] : (cfg.services || []).slice(0, 8),
        description: `${cfg.brand} — ${(cfg.services || []).slice(0, 5).join(', ') || 'services'} in ${rawNap.address}. ${website}`,
        // normalized copy so downstream drift-diffs compare like-for-like
        normalized: canonical,
      },
      instructions: SUBMIT_STEPS[id] || [`Claim/update the listing at ${t.url} using the payload NAP exactly.`],
    };
  });
  return { refused: false, canonical, payloads };
}

/** Does this target have executable creds? Only GBP has a free write API (OAuth business.manage). */
export function credsFor(targetId, cfg, { tokenProbe = null } = {}) {
  if (targetId === 'gbp') {
    const configured = !!(cfg?.gbp?.account && cfg?.gbp?.location);
    return { executable: configured && tokenProbe !== false, kind: configured ? 'oauth-gbp' : null, missing: configured ? [] : ['cfg.gbp.account', 'cfg.gbp.location', 'connect ' + (cfg?.name || '<client>')] };
  }
  return { executable: false, kind: null, missing: ['no free write API — human submit'] };
}

const GBP_LOCATION_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';

/** Loose GBP resource-name match ('locations/2' vs 'accounts/1/locations/2'). Pure. */
function gbpNameMatches(name, expected) {
  const a = String(name ?? '').trim();
  const b = String(expected ?? '').trim();
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * Is this read-back body a REAL GBP location for the configured resource? Pure, fail closed.
 * "Non-empty object" is NOT enough: Google-style {error:{...}} bodies served with HTTP 200,
 * bare {name} responses (the shape GBP returns when field-level OAuth scope is partial),
 * and proxy/gateway JSON all pass that bar — and writing after any of them journals
 * before:null for every field, which defeats rollback of a bad NAP push. So we require
 * (a) no {error} envelope, (b) any `name` present to match the configured location, and
 * (c) at least one of the actually-requested readMask fields (title/phoneNumbers/websiteUri)
 * to carry a real value — every real GBP location has a title, so a legitimate read-back
 * always clears this.
 * @returns {{ok:boolean, why?:string}}
 */
export function isGbpLocationShape(loc, expectedName) {
  if (!loc || typeof loc !== 'object' || Array.isArray(loc)) return { ok: false, why: 'not a JSON object' };
  if (!Object.keys(loc).length) return { ok: false, why: 'empty object' };
  if (loc.error != null) return { ok: false, why: 'Google-style {error:{...}} body served with HTTP 200' };
  if (loc.name != null && !gbpNameMatches(loc.name, expectedName)) {
    return { ok: false, why: `names a DIFFERENT resource ("${String(loc.name)}", expected "${String(expectedName ?? '')}")` };
  }
  const hasReadField = (typeof loc.title === 'string' && loc.title.trim() !== '')
    || (loc.phoneNumbers != null && typeof loc.phoneNumbers === 'object' && !Array.isArray(loc.phoneNumbers))
    || (typeof loc.websiteUri === 'string' && loc.websiteUri.trim() !== '');
  if (!hasReadField) {
    return { ok: false, why: 'carries NONE of the requested location fields (title/phoneNumbers/websiteUri) — error body, partial field-level OAuth scope, or a proxy/gateway response' };
  }
  return { ok: true };
}

/**
 * Per-field diff of the LIVE GBP location vs the canonical payload. Pure. The confirm
 * output, the updateMask, AND the change-ledger before/after are all built from this, so
 * we PATCH only fields that actually differ and every write journals its real before-state.
 * A field with no canonical value (after empty) is never touched — the sync must not
 * blank live fields it doesn't manage.
 * @param {object} current  live location from the read-back GET ({title, phoneNumbers, websiteUri})
 * @param {object} payload  buildListingPayloads() payload ({businessName, phone, website})
 * @returns {{changed:Array<{field,mask,before,after}>, unchanged:Array}}
 */
export function diffGbpLocation(current, payload) {
  const S = (v) => (v == null ? '' : String(v).trim());
  const fields = [
    { field: 'businessName', mask: 'title', before: S(current?.title) || null, after: S(payload?.businessName) || null },
    { field: 'phone', mask: 'phoneNumbers.primaryPhone', before: S(current?.phoneNumbers?.primaryPhone) || null, after: S(payload?.phone) || null },
    { field: 'website', mask: 'websiteUri', before: S(current?.websiteUri) || null, after: S(payload?.website) || null },
  ];
  const changed = fields.filter((f) => f.after !== null && f.before !== f.after);
  const unchanged = fields.filter((f) => !changed.includes(f));
  return { changed, unchanged };
}

/**
 * READ BACK the live GBP location before any write. Throws (→ FAILED row, nothing written)
 * when the GET fails or returns anything that is not a real location body for the
 * configured resource (isGbpLocationShape) — a PATCH without a real before-state journals
 * before:null, which makes rollback of a bad NAP push impossible.
 */
async function readGbpLocation(cfg, fetchFn, token) {
  let res;
  try {
    res = await fetchFn(`${GBP_LOCATION_API}/${cfg.gbp.location}?readMask=title,phoneNumbers,websiteUri`, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new Error(`GBP read-back failed (${String(e?.message || e)}) — REFUSING to write blind (fail closed: no before-state means no rollback)`);
  }
  if (!res || !res.ok) throw new Error(`GBP read-back GET ${res?.status ?? '?'} — REFUSING to write blind (fail closed)`);
  let loc = null;
  try { loc = await res.json(); } catch { loc = null; }
  const shape = isGbpLocationShape(loc, cfg.gbp.location);
  if (!shape.ok) {
    throw new Error(`GBP read-back returned an unparseable/empty/non-location body (${shape.why}) — REFUSING to write blind (fail closed: an all-null before-state defeats rollback)`);
  }
  return loc;
}

/**
 * Sync all listing targets. DRY-RUN BY DEFAULT: network writes happen ONLY when
 * execute && confirm && creds exist. No creds → payload file + instructions,
 * status 'SKIPPED-NO-CREDS'. Refusal (no canonicalNap) passes through untouched.
 * @param fetchFn injected for tests (spy asserts ZERO calls in dry-run)
 * @param tokenFn injected async () => accessToken|null (defaults to the real OAuth store)
 */
export async function syncListings(cfg, { execute = false, confirm = false, fetchFn = globalThis.fetch, tokenFn = null, writeFiles = true, log = () => {} } = {}) {
  const built = buildListingPayloads(cfg);
  if (built.refused) {
    log(`  ⛔ listings step REFUSED: ${built.reason}`);
    log(`     fix: ${built.fix}`);
    return { ...built, rows: [], executed: 0 };
  }

  const live = execute && confirm;
  const dir = join(ROOT, 'reports', cfg.name, 'offsite', 'payloads');
  if (writeFiles) mkdirSync(dir, { recursive: true });

  const rows = [];
  let executed = 0;
  for (const p of built.payloads) {
    const creds = credsFor(p.targetId, cfg);
    if (creds.executable && p.targetId === 'gbp') {
      if (!live) {
        rows.push({ targetId: p.targetId, target: p.targetName, status: 'DRY-RUN', would: `GET ${GBP_LOCATION_API}/${cfg.gbp.location} (read-back), diff per-field vs the canonical NAP, then PATCH ONLY the fields that differ (before-values journaled to the change-ledger)`, payload: p.payload });
        continue;
      }
      // live GBP write — READ-BACK FIRST, per-field diff, PATCH only what differs.
      // Fail closed on any error; NEVER write blind (a blind PATCH would journal
      // before:null and make rollback of a bad NAP push impossible).
      try {
        const token = tokenFn ? await tokenFn() : await (await import('../connect/google.mjs')).getAccessToken(cfg.name);
        if (!token) throw new Error('no OAuth token — run `connect ' + cfg.name + '`');
        const current = await readGbpLocation(cfg, fetchFn, token); // throws → FAILED row, nothing written
        const diff = diffGbpLocation(current, p.payload);
        if (!diff.changed.length) {
          log(`  GBP: live listing already matches the canonical NAP — NO-OP (nothing written)`);
          rows.push({ targetId: p.targetId, target: p.targetName, status: 'NO-OP', note: 'live GBP listing already matches the canonical NAP — nothing to write', live: Object.fromEntries(diff.unchanged.map((d) => [d.field, d.before])) });
          continue;
        }
        for (const d of diff.changed) log(`  GBP diff · ${d.field}: "${d.before ?? '(unset)'}" → "${d.after}"`);
        const body = {};
        for (const d of diff.changed) {
          if (d.mask === 'title') body.title = d.after;
          else if (d.mask === 'phoneNumbers.primaryPhone') body.phoneNumbers = { primaryPhone: d.after };
          else if (d.mask === 'websiteUri') body.websiteUri = d.after;
        }
        const mask = diff.changed.map((d) => d.mask).join(',');
        const res = await fetchFn(`${GBP_LOCATION_API}/${cfg.gbp.location}?updateMask=${mask}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`GBP PATCH ${res.status}`);
        executed++;
        rows.push({
          targetId: p.targetId, target: p.targetName, status: 'EXECUTED',
          diff: diff.changed.map(({ field, before, after }) => ({ field, before, after })),
          ledger: {
            url: p.payload.website, field: 'gbp-nap',
            before: Object.fromEntries(diff.changed.map((d) => [d.field, d.before])),
            after: Object.fromEntries(diff.changed.map((d) => [d.field, d.after])),
            ref: cfg.gbp.location,
          },
        });
      } catch (e) {
        rows.push({ targetId: p.targetId, target: p.targetName, status: 'FAILED', error: String(e.message || e), note: 'fail closed — nothing partially written; payload file still emitted below' });
        if (writeFiles) writePayloadFiles(dir, p);
      }
      continue;
    }
    // No creds / no API → complete payload + instructions, LOUD skip.
    if (writeFiles) writePayloadFiles(dir, p);
    rows.push({ targetId: p.targetId, target: p.targetName, status: 'SKIPPED-NO-CREDS', payload: p.payload, instructions: p.instructions, payloadFile: writeFiles ? join(dir, `${p.targetId}.json`) : null, missing: creds.missing });
  }

  const skipped = rows.filter((r) => r.status === 'SKIPPED-NO-CREDS').length;
  log(`  Listings sync: ${rows.length} targets · ${executed} executed · ${skipped} SKIPPED-NO-CREDS (payload files ready) · mode: ${live ? 'LIVE' : 'dry-run'}`);
  return { refused: false, canonical: built.canonical, rows, executed, generatedAt: nowIso() };
}

function writePayloadFiles(dir, p) {
  writeFileSync(join(dir, `${p.targetId}.json`), JSON.stringify({ target: p.targetName, submitUrl: p.submitUrl, napRule: p.napRule, payload: p.payload, instructions: p.instructions }, null, 2));
  writeFileSync(join(dir, `${p.targetId}.md`), [`# ${p.targetName} — pre-filled submission`, '', `Submit at: ${p.submitUrl || '(see registry)'}`, `NAP rule: ${p.napRule}`, '', '## Exact values to paste', ...Object.entries(p.payload).filter(([k]) => k !== 'normalized').map(([k, v]) => `- **${k}**: ${Array.isArray(v) ? v.join(', ') : v}`), '', '## Steps', ...p.instructions.map((s, i) => `${i + 1}. ${s}`)].join('\n'));
}
