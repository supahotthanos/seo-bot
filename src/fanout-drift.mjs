// seo-bot · fanout-drift — lint money pages against query fan-out DRIFT.
//
// Ground truth (Edward Show E1091 "manual fan-out" recipe + fanout-planner evidence):
// 2026 answer engines rewrite one prompt into ~8-15 sub-queries whose drift is mostly
// APPENDED TOKENS — the current year (2026) and commercial modifiers (best / top /
// comparison / review(s) / vs / alternatives / pricing / cost / near me). A page whose
// title/meta/H1/lead copy lacks those tokens simply misses the retrieval set for the
// drifted sub-queries, no matter how well it answers the head query.
//
// This module LINTS, it never rewrites: findings → (a) a small set of HIGH-confidence,
// deterministic proposals that ride the EXISTING proposal pipeline shape (decide.mjs
// {id,type,page,severity,current,proposed,rationale}, EV-ranked by priority.mjs), and
// (b) an advisory report for everything else. Safety invariants honored:
//   • proposals only — nothing here applies anything (autoApplicable:false on ALL);
//   • fan-outs are NEVER fabricated — only fanout-planner output (enumerateSubqueries /
//     saved fanout-coverage.json) is consumed, and captured vs synthetic labels ride
//     through into evidence;
//   • a SYNTHETIC fan-out can never mint a proposal (advisory only) — only a CAPTURED
//     sub-query (recorded off a real engine) is strong enough evidence to propose;
//   • fail-closed: no pages → status 'no-pages', never an empty-but-green report.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { ROOT } from './config.mjs';
import { nowIso } from './util.mjs';
import { enumerateSubqueries, scoreCell } from './fanout-planner.mjs';

/** How much lead body copy we lint (the retrieval-relevant "first screen"). */
export const BODY_LINT_CHARS = 1500;
/** Years this far behind the current year read as stale drift tokens (2024/2025 in 2026). */
export const STALE_YEAR_WINDOW = 2;

/** Modifier families: a fan-out sub-query "carries" a family when any variant appears;
 *  a page "covers" it when any variant appears in title/meta/H1/lead body. */
export const MODIFIER_FAMILIES = {
  best: ['best'],
  top: ['top'],
  comparison: ['comparison', 'compare', 'compared', 'comparing'],
  review: ['review', 'reviews'],
  vs: ['vs', 'vs.', 'versus'],
  alternatives: ['alternative', 'alternatives'],
  pricing: ['pricing'],
  price: ['price', 'prices'],
  cost: ['cost', 'costs'],
  'near me': ['near me'],
};

/** Same money-page convention as links.mjs / sculpt.mjs (service/treatment/location/cost). */
export const MONEY_RE = /\/(treatment|service|services|treatments|med-spa|cost|best|locations?|[a-z-]+-[a-z]{2})\b/i;

const YEAR_RE = /\b(20\d{2})\b/g;
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (t) => new RegExp(`(?<![a-z0-9])${escRe(String(t).toLowerCase()).replace(/\s+/g, '\\s+')}(?![a-z0-9])`);

export const currentYear = (now = new Date()) => now.getFullYear();

/** Normalize a page row (audit parsePage output, planner doc, or raw fields) into the
 *  four lint surfaces. Missing surfaces degrade to '' — lint what the audit stored. */
export function normalizePage(p = {}) {
  return {
    url: String(p.url || p.page || ''),
    title: String(p.title || ''),
    meta: String(p.meta ?? p.metaDesc ?? ''),
    h1: String(p.h1 ?? (Array.isArray(p.h1s) ? p.h1s[0] || '' : '') ?? ''),
    body: String(p.body ?? p.text ?? '').replace(/\s+/g, ' ').trim().slice(0, BODY_LINT_CHARS),
  };
}

/** Accept fan-outs as: the saved fanout-coverage.json plan object, an array of
 *  {query, fanoutSource, page?, subqueries:[{query,source}|string]} rows, or nothing.
 *  NEVER synthesizes anything here — labels ride through untouched. */
export function normalizeFanouts(fanouts) {
  const rows = Array.isArray(fanouts) ? fanouts
    : Array.isArray(fanouts?.queries) ? fanouts.queries : [];
  return rows.map((r) => ({
    query: String(r?.query || '').trim(),
    fanoutSource: r?.fanoutSource === 'captured' ? 'captured' : 'synthetic',
    page: r?.page || r?.bestPage || null,
    subqueries: (Array.isArray(r?.subqueries) ? r.subqueries : []).map((s) =>
      typeof s === 'string'
        ? { query: s, source: r?.fanoutSource === 'captured' ? 'captured' : 'synthetic' }
        : { query: String(s?.query || ''), type: s?.type, source: s?.source === 'captured' ? 'captured' : 'synthetic' })
      .filter((s) => s.query),
  })).filter((r) => r.query && r.subqueries.length);
}

/** Modifier families a sub-query carries. */
export function modifierFamiliesIn(subquery) {
  const q = String(subquery || '').toLowerCase();
  return Object.keys(MODIFIER_FAMILIES).filter((fam) => MODIFIER_FAMILIES[fam].some((v) => phraseRe(v).test(q)));
}

const SURFACES = ['title', 'meta', 'h1', 'body'];
const surfaceHas = (page, re) => SURFACES.filter((s) => re.test(String(page[s] || '').toLowerCase()));

function snippetAround(text, token) {
  const i = text.indexOf(token);
  if (i === -1) return text.slice(0, 120);
  return text.slice(Math.max(0, i - 60), i + token.length + 60).trim();
}

/**
 * Lint pages for fan-out drift. PURE given inputs — never fetches, never invents fan-outs.
 *
 * Findings: {page, kind:'stale-year'|'missing-year'|'missing-modifier', token,
 *            where:'title'|'meta'|'h1'|'body', fanout?, evidence:{...}}
 *   stale-year       — a year token STALE_YEAR_WINDOW years behind now on any surface
 *                      (page-level; needs no fan-out).
 *   missing-year     — the page's mapped fan-out carries a current-year sub-query but the
 *                      page has the current year on NO surface (where:'title' = fix target).
 *   missing-modifier — a modifier family carried by the mapped fan-out's sub-queries that
 *                      appears on NO surface (where:'body' = advisory fix target).
 *
 * @param {object} cfg client config (name used for the report header only)
 * @param {{pages?: Array<object>, fanouts?: object|Array}} input
 */
export function lintDrift(cfg = {}, { pages = [], fanouts = null } = {}) {
  const YR = currentYear();
  const docs = (Array.isArray(pages) ? pages : []).map(normalizePage).filter((p) => p.url && (p.title || p.meta || p.h1 || p.body));
  const base = { generatedAt: nowIso(), client: cfg.name || '', currentYear: YR, findings: [] };
  if (!docs.length) {
    return { ...base, status: 'no-pages', note: 'fail-closed: no lintable pages (no crawl/audit page data) — an empty lint is NOT a clean bill' };
  }
  const fanRows = normalizeFanouts(fanouts);
  const findings = [];
  const seen = new Set();
  const add = (f) => { const k = `${f.page}|${f.kind}|${f.token}|${f.where}`; if (!seen.has(k)) { seen.add(k); findings.push(f); } };

  // (a) stale year tokens — page-level, every provided page, every surface.
  for (const p of docs) {
    for (const s of SURFACES) {
      const txt = String(p[s] || '');
      for (const m of txt.matchAll(YEAR_RE)) {
        const y = Number(m[1]);
        if (y < YR && y >= YR - STALE_YEAR_WINDOW) {
          add({ page: p.url, kind: 'stale-year', token: m[1], where: s,
            evidence: { text: s === 'body' ? snippetAround(txt, m[1]) : txt, currentYear: YR } });
        }
      }
    }
  }

  // (b)+(c) need a fan-out ↔ page mapping. Explicit row.page wins; otherwise the page
  // with the best term overlap for the head query (fanout-planner scoreCell — reused,
  // not forked). No overlap at all → the fan-out is skipped (never force-mapped).
  const yrRe = phraseRe(String(YR));
  for (const row of fanRows) {
    let page = row.page ? docs.find((d) => d.url === row.page || d.url.replace(/\/$/, '') === String(row.page).replace(/\/$/, '')) : null;
    if (!page) {
      let bestScore = 0;
      for (const d of docs) {
        const sc = scoreCell(row.query, { title: d.title, headings: [d.h1], text: d.body }).termCoverage;
        if (sc > bestScore) { bestScore = sc; page = d; }
      }
      if (!page || bestScore <= 0) continue; // fail-closed: unmappable fan-out lints nothing
    }

    // (b) missing current-year token vs year-carrying sub-queries
    const yearSubs = row.subqueries.filter((s) => phraseRe(String(YR)).test(s.query.toLowerCase()));
    if (yearSubs.length && surfaceHas(page, yrRe).length === 0) {
      const sq = yearSubs[0];
      add({ page: page.url, kind: 'missing-year', token: String(YR), where: 'title', fanout: sq.query,
        evidence: { text: page.title, fanoutSource: row.fanoutSource, subquerySource: sq.source, headQuery: row.query, checked: SURFACES } });
    }

    // (c) missing modifier families carried by the mapped fan-out
    const famExemplar = new Map(); // family -> first sub-query carrying it
    for (const sq of row.subqueries) for (const fam of modifierFamiliesIn(sq.query)) if (!famExemplar.has(fam)) famExemplar.set(fam, sq);
    for (const [fam, sq] of famExemplar) {
      const covered = MODIFIER_FAMILIES[fam].some((v) => surfaceHas(page, phraseRe(v)).length > 0);
      if (!covered) {
        add({ page: page.url, kind: 'missing-modifier', token: fam, where: 'body', fanout: sq.query,
          evidence: { fanoutSource: row.fanoutSource, subquerySource: sq.source, headQuery: row.query, variants: MODIFIER_FAMILIES[fam], checked: SURFACES } });
      }
    }
  }

  return { ...base, status: 'ok', pagesLinted: docs.length, fanoutsUsed: fanRows.length,
    ...(fanRows.length ? {} : { note: 'no fan-outs supplied — stale-year lint only (fan-outs are never fabricated here; run `fanout-plan` first)' }),
    findings };
}

/**
 * Split findings into proposals (HIGH confidence only) + advisories (everything else).
 *
 * HIGH confidence = deterministic, low-blast-radius, evidence-backed:
 *   • stale-year in title or meta → swap the year token (deterministic string edit);
 *   • missing-year in title WHERE the fan-out is CAPTURED (a real engine ran a
 *     current-year sub-query) → append the year to the title.
 * A synthetic fan-out NEVER produces a proposal. All proposals are severity 'low' and
 * autoApplicable:false — they queue for human review in the existing pipeline; nothing
 * here (or downstream, by these flags) auto-applies.
 */
export function driftProposals(cfg = {}, findings = []) {
  const YR = currentYear();
  const proposals = [];
  const advisories = [];
  let pid = 0;
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || typeof f !== 'object') continue;
    const staleHigh = f.kind === 'stale-year' && (f.where === 'title' || f.where === 'meta');
    const missYearHigh = f.kind === 'missing-year' && f.where === 'title' && f.evidence?.fanoutSource === 'captured';
    if (staleHigh) {
      const cur = String(f.evidence?.text ?? '');
      proposals.push({
        id: ++pid, type: 'fanout-drift-year', page: f.page, severity: 'low', autoApplicable: false,
        current: cur || '(none)',
        proposed: cur.replace(new RegExp(`\\b${escRe(f.token)}\\b`, 'g'), String(YR)),
        rationale: `Stale year token "${f.token}" in the ${f.where} — 2026 engine fan-outs append the CURRENT year ("<query> ${YR}"); a ${f.token} token reads as out-of-date to both retrieval and users. Deterministic swap ${f.token} → ${YR}.`,
        finding: { kind: f.kind, token: f.token, where: f.where },
      });
    } else if (missYearHigh) {
      const title = String(f.evidence?.text ?? '');
      proposals.push({
        id: ++pid, type: 'fanout-drift-year', page: f.page, severity: 'low', autoApplicable: false,
        current: title || '(none)',
        proposed: title ? `${title} (${YR})` : `(add a ${YR} token to the title)`,
        rationale: `CAPTURED fan-out sub-query "${f.fanout}" (recorded off the engine for "${f.evidence?.headQuery || ''}") carries ${YR}, but no surface of this page does — the page misses the year-drifted retrieval set. Append ${YR} to the title (human review; respect titleMax ${cfg.audit?.titleMax ?? 70}).`,
        finding: { kind: f.kind, token: f.token, where: f.where, fanout: f.fanout },
      });
    } else {
      advisories.push(f);
    }
  }
  return { proposals, advisories };
}

/** Persist the drift report next to the client's other run artifacts
 *  (reports/<client>/ is this repo's per-client state-path convention). */
export function saveDriftReport(cfg, report) {
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, 'fanout-drift.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  return { jsonPath };
}

function readJsonSafe(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } // unparseable → ignored, fail-closed
}

/** Parse one fetched page into the four lint surfaces (raw HTML — what AI crawlers see). */
export function pageFromHtml(pg = {}) {
  const $ = cheerio.load(pg.html || '');
  $('script,style,noscript,svg,template').remove();
  return normalizePage({
    url: pg.finalUrl || pg.url,
    title: ($('title').first().text() || '').trim(),
    metaDesc: ($('meta[name="description"]').attr('content') || '').trim(),
    h1: ($('h1').first().text() || '').replace(/\s+/g, ' ').trim(),
    body: $('body').text(),
  });
}

/**
 * CLI shell: gather fan-outs (saved planner output, else planner enumeration over the
 * config's target queries — captured capture file honored, synthetic clearly labeled),
 * crawl the money pages, lint, split proposals/advisories, persist the report.
 * `drift <client> [--max N]`
 */
export async function runDrift(cfg, { log = () => {}, maxPages = 0 } = {}) {
  const dir = join(ROOT, 'reports', cfg.name);

  // Fan-outs: ONLY planner output. Saved coverage plan first (may carry captured labels
  // + bestPage mappings); else enumerate via the planner (captured file honored).
  let fanouts = readJsonSafe(join(dir, 'fanout-coverage.json'));
  let fanoutNote;
  if (fanouts?.queries?.length) {
    fanoutNote = 'fanout-coverage.json (saved planner output)';
  } else {
    fanouts = null;
    const targetQueries = (cfg.promptPanel?.length ? cfg.promptPanel : cfg.tracking?.keywords || [])
      .map((s) => String(s || '').replaceAll('{brand}', cfg.brand || '').trim()).filter((s) => s && !/\{.*\}/.test(s)).slice(0, 12);
    if (targetQueries.length) {
      const captured = readJsonSafe(join(dir, 'fanout-capture.json'));
      fanouts = targetQueries.map((q) => ({ query: q, ...enumerateSubqueries(q, { cfg, captured }) }));
      fanoutNote = `enumerated via fanout-planner for ${targetQueries.length} target queries (${captured ? 'capture file honored' : 'no capture file — synthetic-labeled'})`;
    } else {
      fanoutNote = 'no fan-outs available (no fanout-coverage.json and no promptPanel/tracking.keywords) — stale-year lint only';
    }
  }
  log(`  drift: fan-outs — ${fanoutNote}`);

  // Pages: crawl raw HTML like audit/fanout-plan do; lint money pages (+ homepage).
  const { discoverUrls, fetchPages } = await import('./crawl.mjs');
  const { urls } = await discoverUrls(cfg);
  const money = urls.filter((u) => MONEY_RE.test(u) || u.replace(/\/$/, '') === cfg.baseUrl);
  const take = (money.length ? money : urls).slice(0, Math.max(1, maxPages || Math.min(cfg.audit?.maxPages || 25, 25)));
  log(`  drift: fetching ${take.length} money/target pages (raw HTML) …`);
  const fetched = await fetchPages(take, cfg);
  const pages = fetched.filter((p) => p.ok && p.status === 200).map((p) => pageFromHtml(p));

  const report = lintDrift(cfg, { pages, fanouts });
  const { proposals, advisories } = driftProposals(cfg, report.findings);
  const full = { ...report, fanoutNote, proposals, advisories };
  const { jsonPath } = saveDriftReport(cfg, full);

  if (report.status !== 'ok') log(`  ⛔ ${report.status}: ${report.note}`);
  else {
    const k = (kind) => report.findings.filter((f) => f.kind === kind).length;
    log(`  drift: ${report.findings.length} finding(s) over ${report.pagesLinted} page(s) — ${k('stale-year')} stale-year · ${k('missing-year')} missing-year · ${k('missing-modifier')} missing-modifier`);
    log(`  drift: ${proposals.length} HIGH-confidence proposal(s) (captured-evidence/deterministic only, human-review queue) · ${advisories.length} advisory`);
  }
  log(`  Report → ${jsonPath}`);
  return full;
}
