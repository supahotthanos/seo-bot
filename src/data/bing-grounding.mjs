// seo-bot · data/bing-grounding — Bing Webmaster Tools grounding-queries ingestion (GOAL C4).
//
// Bing WMT exposes which queries Copilot/Bing AI used to GROUND answers that drew on your
// site — the one first-party window into fan-out visibility (Seer's recommended tracking
// surface; research/fanout-extraction-2026.md §5). There is no free API for it, so the flow
// is human-in-the-loop by design: you download the export (CSV) from Bing Webmaster Tools →
// Search Performance, and this module ingests it into the client's reports.
//
// FAIL-CLOSED: no file → refuse with the exact download instructions (never fabricate);
// unrecognizable header → refuse naming what was found; malformed rows skipped AND counted.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.mjs';

/** PURE: minimal CSV parse (quoted fields, commas, CRLF). */
export function parseCsv(text = '') {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((f) => f !== '')) rows.push(row); row = []; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

/** PURE: tolerant header detection — Bing has renamed export columns before. */
export function detectColumns(header = []) {
  const idx = (res) => header.findIndex((h) => res.some((re) => re.test(String(h).trim())));
  const query = idx([/^quer/i, /grounding.?quer/i, /^prompt/i, /^keyword/i]);
  const count = idx([/impress/i, /count/i, /appearances?/i, /frequen/i]);
  const page = idx([/^page/i, /^url/i, /landing/i]);
  return { query, count, page, ok: query >= 0 };
}

/** PURE: rows → normalized records. Malformed rows skipped AND counted. */
export function parseGroundingCsv(text = '') {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, reason: 'empty or headerless export (need a header row + data rows)' };
  const cols = detectColumns(rows[0]);
  if (!cols.ok) return { ok: false, reason: `no query column recognized in header: ${rows[0].slice(0, 6).join(' | ')}` };
  const records = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const query = String(r[cols.query] || '').trim();
    if (!query) { skipped++; continue; }
    records.push({
      query,
      count: cols.count >= 0 ? (Number(String(r[cols.count]).replace(/[,\s]/g, '')) || 0) : null,
      page: cols.page >= 0 ? String(r[cols.page] || '').trim() || null : null,
    });
  }
  return { ok: true, records, skipped, columns: cols };
}

/** Ingest one export file for a client → reports/<client>/bing-grounding.json (+ md). */
export function ingestGrounding(cfg, { file = null, nowIso = new Date().toISOString(), log = () => {} } = {}) {
  if (!file || !existsSync(file)) {
    const msg = 'no export file — download it first: Bing Webmaster Tools → Search Performance → filter to Copilot/AI grounding → Export (CSV), then run: seo-bot bing-grounding <client> --file <path>';
    log(`  bing-grounding: REFUSED — ${msg}`);
    return { ok: false, reason: msg };
  }
  const parsed = parseGroundingCsv(readFileSync(file, 'utf8'));
  if (!parsed.ok) { log(`  bing-grounding: REFUSED — ${parsed.reason}`); return parsed; }
  const dir = join(ROOT, 'reports', cfg.name);
  mkdirSync(dir, { recursive: true });
  const top = [...parsed.records].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 200);
  const out = { ingestedAt: nowIso, sourceFile: file, n: parsed.records.length, skipped: parsed.skipped, records: top };
  writeFileSync(join(dir, 'bing-grounding.json'), JSON.stringify(out, null, 2));
  writeFileSync(join(dir, 'bing-grounding.md'), [
    '# Bing grounding queries (Copilot fan-out visibility — first-party)', '',
    `Ingested ${parsed.records.length} queries (${parsed.skipped} malformed rows skipped) from ${file}.`, '',
    '| grounding query | count | page |', '|---|---|---|',
    ...top.slice(0, 40).map((r) => `| ${r.query} | ${r.count ?? '—'} | ${r.page ?? '—'} |`),
    '', '_Feed these into fanout-plan targets: a grounding query is a PROVEN retrieval path into our site._',
  ].join('\n'));
  log(`  bing-grounding: ${parsed.records.length} queries ingested (${parsed.skipped} skipped) → reports/${cfg.name}/bing-grounding.md`);
  return { ok: true, n: parsed.records.length, skipped: parsed.skipped };
}
