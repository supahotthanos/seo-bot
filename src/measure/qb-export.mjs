// seo-bot · measure/qb-export — mirror a query-bank panel into the PRIVATE store (Shubh
// 2026-07-20, asking for panel data from a plane: the laptop reaches the Mini only on the
// home LAN, but BOTH machines always reach GitHub — so the store, not ssh, is the
// anywhere-readable data path). PRIVATE seenai-queue only; the public repo NEVER gets
// harvested data (CLAUDE.md).
//
// Runs on the 300s jobs tick, so it is CHANGE-GUARDED: a marker file remembers the last
// exported fingerprint and an unchanged panel writes nothing (a commit per tick would spam
// the store's git history). Caps keep the doc far under the contents-API ceiling; anything
// dropped is COUNTED in the doc — silent truncation reads as "everything", and it isn't.

import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const EXPORT_ROW_CAP = 400;               // newest rows win (the seenai panel is ~dozens)
export const EXPORT_BYTE_CAP = 2 * 1024 * 1024;  // JSON bytes pre-base64 — far under the API limit
const CLIENT_SEG_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/; // store CLIENT_RE shape; blocks traversal

/** PURE: ndjson → rows; malformed lines are skipped, never guessed at. */
export function parseNdjsonRows(text = '') {
  return String(text).split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** PURE: cheap panel fingerprint — row count + newest row identity. */
export function qbExportFingerprint(rows = []) {
  const last = rows.length ? rows[rows.length - 1] : null;
  return `${rows.length}:${(last && last.capturedAt) || ''}:${(last && last.answerHash) || ''}`;
}

/** PURE: the export doc — newest-first rows under a row cap AND a byte cap, drops counted. */
export function buildQbExport({ rows = [], pushTargetsMd = '', reportMd = '', client = 'seenai', nowIso = '' } = {}) {
  const kept = rows.slice(-EXPORT_ROW_CAP).reverse(); // newest first
  const doc = {
    v: 1, client, exportedAt: nowIso, totalRows: rows.length,
    dropped: rows.length - kept.length, rows: kept,
    pushTargetsMd: String(pushTargetsMd || ''), reportMd: String(reportMd || ''),
  };
  while (kept.length > 1 && JSON.stringify(doc).length > EXPORT_BYTE_CAP) { kept.pop(); doc.dropped += 1; }
  return doc;
}

/** Read panel → fingerprint gate → store put. `fsi`/`store` injectable (suite: no network).
 *  Marker is written ONLY after a confirmed store write — a failed put retries next tick. */
export function runQbExport({ client = 'seenai', root, store, fsi = { readFileSync, writeFileSync, existsSync },
  log = () => {}, nowIso = new Date().toISOString() } = {}) {
  if (!root || !store) return { status: 'bad-args' };
  if (!CLIENT_SEG_RE.test(client)) return { status: 'bad-client' };
  const dir = join(root, 'reports', 'query-bank', client);
  const nd = join(dir, 'observations.ndjson');
  if (!fsi.existsSync(nd)) return { status: 'no-data' };
  const rows = parseNdjsonRows(fsi.readFileSync(nd, 'utf8'));
  if (!rows.length) return { status: 'no-data' };
  const fp = qbExportFingerprint(rows);
  const mark = join(dir, '.export-mark');
  if (fsi.existsSync(mark) && String(fsi.readFileSync(mark, 'utf8')).trim() === fp) return { status: 'unchanged', rows: rows.length };
  const mdFile = join(dir, 'push-targets.md');
  const repFile = join(dir, 'report.md');
  const doc = buildQbExport({
    rows, client, nowIso,
    pushTargetsMd: fsi.existsSync(mdFile) ? fsi.readFileSync(mdFile, 'utf8') : '',
    reportMd: fsi.existsSync(repFile) ? fsi.readFileSync(repFile, 'utf8') : '',
  });
  // `via` tags WHICH lane exported (mini-run sets it per mode) — the store history doubles as a
  // remote lane-liveness probe when the laptop can't ssh in.
  const via = process.env.SEO_BOT_EXPORT_VIA || '';
  const res = store.putJson(`exports/_default/${client}-qb.json`, doc, `qb export ${client} (${doc.rows.length}/${doc.totalRows} rows)${via ? ` via ${via}` : ''}`);
  if (!res || !res.ok) { log(`  qb-export: store write FAILED — ${(res && res.error) || 'unknown'}`); return { status: 'store-failed', error: (res && res.error) || 'unknown' }; }
  fsi.writeFileSync(mark, fp);
  log(`  qb-export: ${client} → ${res.path} (${doc.rows.length} rows${doc.dropped ? `, ${doc.dropped} oldest dropped` : ''})`);
  return { status: 'ok', rows: doc.rows.length, path: res.path };
}
