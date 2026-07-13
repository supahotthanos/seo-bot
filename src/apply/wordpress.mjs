// seo-bot · apply/wordpress — apply fixes to a WordPress site you control via the
// REST API (Application Passwords). Updates post title/excerpt/content; SEO meta
// (title/description/schema) is written through the active SEO plugin's REST
// fields (Rank Math / Yoast) when the proposal carries a wpPostId + metaKey.
//
// Auth: config cms.wpUser / cms.wpAppPassword may be "ENV:VAR" indirections.
// Create an Application Password under the WP user's profile (Users -> Profile).

function resolveSecret(v) {
  if (typeof v === 'string' && v.startsWith('ENV:')) return process.env[v.slice(4)] || '';
  return v || '';
}

async function wpPatch(base, auth, path, body) {
  const res = await fetch(`${base.replace(/\/$/, '')}/wp-json/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export async function applyWordpress(cfg, data, { log = () => {}, confirm = false } = {}) {
  const base = cfg.cms.wpBaseUrl || cfg.baseUrl;
  const user = resolveSecret(cfg.cms.wpUser);
  const pass = resolveSecret(cfg.cms.wpAppPassword);
  if (!user || !pass) { log('  ⚠ WP credentials missing (cms.wpUser / cms.wpAppPassword or their ENV: targets). Falling back to dry run.'); const { applyDryrun } = await import('./dryrun.mjs'); return applyDryrun(cfg, data, { log }); }
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  // Only proposals that carry an explicit WP target are auto-applicable here.
  const targeted = data.proposals.filter((p) => p.wpPostId);
  log(`  ${targeted.length}/${data.proposals.length} proposals carry a wpPostId and can be applied via REST.`);
  if (!confirm) {
    for (const p of targeted) log(`    would update post ${p.wpPostId}: ${p.type} -> ${String(p.proposed).slice(0, 80)}`);
    log('  Preview only. Re-run with --yes to write to WordPress.');
    return { applied: [], dryrun: true };
  }

  const applied = [];
  for (const p of targeted) {
    try {
      if (p.type === 'meta' || p.type === 'title') {
        // Rank Math stores meta in `meta` fields: rank_math_title / rank_math_description.
        const metaKey = p.type === 'title' ? 'rank_math_title' : 'rank_math_description';
        await wpPatch(base, auth, `wp/v2/posts/${p.wpPostId}`, { meta: { [metaKey]: p.proposed } });
      } else if (p.type === 'content' || p.type === 'answer-block') {
        await wpPatch(base, auth, `wp/v2/posts/${p.wpPostId}`, { content: p.proposed });
      } else {
        continue;
      }
      applied.push({ post: p.wpPostId, type: p.type });
      log(`    ✓ post ${p.wpPostId}: ${p.type}`);
    } catch (e) {
      log(`    ✗ post ${p.wpPostId}: ${String(e.message || e).slice(0, 140)}`);
    }
  }
  return { applied };
}
