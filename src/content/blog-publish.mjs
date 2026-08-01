// seo-bot · content/blog-publish — the missing link between blog-radar BRIEFS and the LIVE blog:
// draft (claude CLI) → quality gates → append to the site's typed posts.ts registry → branch →
// PR → AUTO-MERGE. This is what "blogs auto-post" means operationally: no human wait for clean
// posts, while the PR keeps the audit trail (the PR-only invariant stays intact — we auto-MERGE
// a PR, we never push to master directly).
//
// SAFETY / ANTI-SLOP (the June-2026 spam update killed templated AI content; these gates are the
// difference between "AI content" and "AI slop"):
//   - capsule lint: the lead block must be a 40–70-word self-contained answer (AEO first-read)
//   - near-dup gate: token-overlap vs EVERY existing post — copies and city-swaps never ship
//   - weekly plan cap: bounded output (scaled-content-abuse is a volume pattern)
//   - unsourced-price gate: "$" figures require a named source in the post
//   - YMYL routing: GLP-1 / before-after / health-claim posts are NEVER auto-merged — the PR is
//     opened and HELD for human review (flag-only, exactly like the site-change policy)
// Fail-closed: any gate violation = no write, no branch, nothing.

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+){1,11}$/;
// Local YMYL screen for editorial posts (policy.mjs's clinic-page regex is not exported; this is
// the same family of triggers for review-site content).
export const BLOG_YMYL_RE = /\bglp-?1\b|semaglutide|tirzepatide|ozempic|wegovy|mounjaro|zepbound|before[\s-]and[\s-]?after|before\/after|\bcure[sd]?\b|guarantee[sd]?\s+(results?|outcomes?)|risk[\s-]free|fda[\s-]approv|medical\s+advice|diagnos|prescri(be|ption)|contraindicat/i;

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const postText = (post) => [post.title, post.dek, post.excerpt, ...(post.sections || []).flatMap((s) => [s.heading || '', ...(s.body || []).map((b) => b.text || (b.items || []).join(' '))])].join(' ');
const tokens = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));

/** PURE: token-set Jaccard between two texts — the near-dup screen. */
export function textOverlap(a = '', b = '') {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** PURE: extract what dedup/caps need from the site's posts.ts source (regex-level, no TS parse). */
export function readRegistry(source = '') {
  const slugs = [...source.matchAll(/slug:\s*'([^']+)'/g)].map((m) => m[1]);
  const dates = [...source.matchAll(/date:\s*'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1]);
  const texts = [...source.matchAll(/(?:text|title|excerpt|dek):\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
  return { slugs, dates, corpus: texts.join(' ') , postCount: slugs.length };
}

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ').trim();

/** PURE: serialize a BlogPost object as a TS literal matching the site's registry style. */
export function serializePost(post) {
  const block = (b) => {
    if (b.type === 'p') return `        { type: 'p', text: '${esc(b.text)}' }`;
    if (b.type === 'ul' || b.type === 'ol') return `        { type: '${b.type}', items: [${(b.items || []).map((i) => `'${esc(i)}'`).join(', ')}] }`;
    if (b.type === 'callout') return `        { type: 'callout', label: '${esc(b.label)}', text: '${esc(b.text)}' }`;
    return null;
  };
  const section = (s) => [
    '    {',
    s.heading ? `      heading: '${esc(s.heading)}',` : null,
    '      body: [',
    (s.body || []).map(block).filter(Boolean).join(',\n'),
    '      ],',
    '    }',
  ].filter(Boolean).join('\n');
  return [
    '  {',
    `    slug: '${esc(post.slug)}',`,
    `    title: '${esc(post.title)}',`,
    `    excerpt: '${esc(post.excerpt)}',`,
    `    date: '${esc(post.date)}',`,
    `    updated: '${esc(post.updated)}',`,
    `    readingTime: '${esc(post.readingTime)}',`,
    `    category: '${esc(post.category)}',`,
    `    dek: '${esc(post.dek)}',`,
    '    sections: [',
    (post.sections || []).map(section).join(',\n'),
    '    ],',
    '  },',
  ].join('\n');
}

/** PURE: insert a serialized post at the TOP of the BLOG_POSTS array (right after `= [`) — no
 *  closing-bracket hunting, so body text containing brackets can never break the injection. */
export function appendPostToRegistry(source, post) {
  const m = source.match(/export const BLOG_POSTS[^=]*=\s*\[/);
  if (!m) return { ok: false, error: 'BLOG_POSTS array marker not found in posts.ts' };
  const at = m.index + m[0].length;
  return { ok: true, source: source.slice(0, at) + '\n' + serializePost(post) + source.slice(at) };
}

/** PURE: the gate suite. Returns { ok, violations[], ymyl } — ymyl flags (held PR), never blocks. */
export function validateBlogPost(post = {}, registry = { slugs: [], dates: [], corpus: '' }, { nowIso = '', maxPerWeek = 7 } = {}) {
  const v = [];
  const today = String(nowIso).slice(0, 10);
  if (!SLUG_RE.test(post.slug || '')) v.push(`slug "${post.slug}" must be kebab-case, 2–12 words`);
  if (registry.slugs.includes(post.slug)) v.push(`slug "${post.slug}" already exists`);
  if (!post.title || post.title.length < 20 || post.title.length > 90) v.push('title must be 20–90 chars');
  if (!post.excerpt || post.excerpt.length > 160) v.push('excerpt required, ≤160 chars (it is the meta description)');
  if (!post.dek || !post.category || !post.readingTime) v.push('dek, category, readingTime are required');
  if (post.date !== today || post.updated !== today) v.push(`date/updated must be the fixed publish date ${today} (never computed at runtime)`);
  const sections = post.sections || [];
  if (sections.length < 4) v.push('at least 4 sections (lead + 3 substantive)');
  // Capsule lint: lead section = no heading, first block a 40–70-word self-contained answer.
  const lead = sections[0];
  const leadP = lead && !lead.heading && (lead.body || [])[0];
  const leadWords = leadP && leadP.type === 'p' ? words(leadP.text).length : 0;
  if (!(leadWords >= 40 && leadWords <= 70)) v.push(`lead capsule must be a 40–70-word answer paragraph (got ${leadWords})`);
  const full = postText(post);
  if (words(full).length < 600) v.push(`post too thin (${words(full).length} words < 600)`);
  // Near-dup: against the whole existing corpus (city-swaps and rewrites die here).
  const overlap = textOverlap(full, registry.corpus);
  if (registry.corpus && overlap > 0.5) v.push(`near-duplicate of existing content (token overlap ${(overlap * 100).toFixed(0)}% > 50%)`);
  // Unsourced-price gate: dollar figures require a named source somewhere in the post.
  if (/\$\s?\d/.test(full) && !/(source|according to|per\s+(the\s+)?(asps|amspa|realself|fda|cdc)|\.gov|\.edu|20\d\d (survey|report|data))/i.test(full)) {
    v.push('post quotes $ figures with no named source (no-fabrication gate)');
  }
  // Weekly plan cap: count posts dated within 7 days of publish (including this one).
  const t = Date.parse(today);
  const recent = registry.dates.filter((d) => { const x = Date.parse(d); return Number.isFinite(x) && t - x < 7 * 864e5 && t - x >= 0; }).length;
  if (recent + 1 > maxPerWeek) v.push(`weekly plan cap: ${recent} posts in the last 7 days, cap ${maxPerWeek} (scaled-content-abuse guard)`);
  return { ok: v.length === 0, violations: v, ymyl: BLOG_YMYL_RE.test(full), overlap: +overlap.toFixed(3), wordCount: words(full).length };
}

// ---- HUMANIZER (June-2026 spam-update defense) ----------------------------------------------
// The update didn't punish "AI content"; it punished the recognizable AI-SLOP REGISTER. This is a
// deterministic lint for that register + one LLM rewrite pass when a draft trips it. Fail-closed:
// a draft that still reads like slop after the rewrite never ships.
const SLOP_PATTERNS = [
  [/in today'?s (fast-paced |digital |modern )?(world|landscape|age)/i, 'in-todays-world'],
  [/it'?s (important|worth|essential) (to note|noting|to remember|to understand)/i, 'its-important-to-note'],
  [/whether you'?re [^.]{3,60} or [^.]{3,60},/i, 'whether-youre-x-or-y'],
  [/\b(dive|diving|delve|delving) (in|into|deeper)\b/i, 'delve-dive'],
  [/\b(unlock|unleash|elevate|supercharge|transform) your\b/i, 'unlock-your'],
  [/\bgame.?changer\b/i, 'game-changer'],
  [/look no further/i, 'look-no-further'],
  [/in (conclusion|summary),/i, 'in-conclusion'],
  [/\b(seamless(ly)?|holistic(ally)?|cutting.edge|state.of.the.art|revolutioniz)/i, 'buzzword'],
  [/\bnot only [^.]{3,80} but also\b/i, 'not-only-but-also'],
  [/embark on|journey (to|of|toward)/i, 'journey-embark'],
  [/\bnestled\b|\bboasts?\b/i, 'nestled-boasts'],
];
/** PURE: score 0–1 of how strongly the text reads as the AI-slop register (+ which tells hit). */
export function aiPatternScore(text = '') {
  const t = String(text || '');
  const hits = [];
  for (const [re, name] of SLOP_PATTERNS) if (re.test(t)) hits.push(name);
  const w = words(t).length || 1;
  const emDashes = (t.match(/—/g) || []).length;
  if (emDashes / w > 0.012) hits.push('em-dash-overuse');
  const exclaims = (t.match(/!/g) || []).length;
  if (exclaims / w > 0.008) hits.push('exclamation-overuse');
  // Sentence-length uniformity: humans vary cadence; slop metronomes. (Needs a real sample.)
  const lens = t.split(/[.!?]+\s/).map((s) => words(s).length).filter((n) => n > 3);
  if (lens.length >= 12) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    if (sd < 3.5) hits.push('metronome-sentences');
  }
  return { score: Math.min(1, hits.length / 6), hits };
}

const HUMANIZE_SYSTEM = `You are a sharp human copy editor. Rewrite the given blog-post JSON so it reads like a person wrote it: vary sentence length hard (mix 5-word punches with longer ones), cut every stock idiom ("in today's world", "dive into", "it's important to note", "whether you're X or Y", "game-changer", "unlock/elevate", "in conclusion", "nestled", "boasts"), prefer concrete nouns and numbers over adjectives, allow an occasional fragment. DO NOT change facts, structure, slugs, headings, or the JSON shape. Output ONLY the JSON.`;

const DRAFT_SYSTEM = `You write for "No BS Med Spa Reviews" — blunt, skimmable, pro-patient, openly hostile to pay-to-rank directory games. No fluff, no "in today's world". Every claim concrete. Never invent statistics or prices; if you cite a number, name its source in the text. Output ONLY valid JSON.`;

/** Draft one post from a brief via the LLM (claude CLI — zero API cost). Returns a BlogPost-shaped
 *  object. voiceBlock (from voice.mjs — the register learned from the #1-ranked clinics' corpus)
 *  calibrates HOW it writes; the near-dup gate downstream still makes copying them impossible. */
export async function draftBlogPost(brief = {}, cfg = {}, { llm, nowIso = new Date().toISOString(), voiceBlock = '' } = {}) {
  const today = nowIso.slice(0, 10);
  const prompt = [
    `Write one blog post for ${cfg.brand || 'the site'} on: "${brief.topic}".`,
    brief.outline?.length ? `Cover (beat the ranking pages, don't copy them): ${brief.outline.slice(0, 10).map((h) => h.text || h).join(' · ')}` : '',
    brief.questions?.length ? `Answer these reader questions as their own sections: ${brief.questions.slice(0, 6).join(' · ')}` : '',
    '',
    'Return JSON exactly: { "slug": "kebab-case", "title": "", "excerpt": "<=155 chars", "category": "Guides",',
    '"dek": "one line", "readingTime": "N min read", "sections": [ { "body": [ { "type": "p", "text": "40-70 word self-contained answer to the topic — this renders first and is what AI engines quote" } ] },',
    '{ "heading": "H2", "body": [ {"type":"p","text":"..."}, {"type":"ul","items":["..."]} ] }, ... ] }',
    'Rules: >=5 sections after the lead; >=700 words total; one section must be a reader-question H2;',
    'end with a section headed "Sources" whose body names the real authorities you drew on (no fake citations).',
  ].filter(Boolean).join('\n');
  const system = voiceBlock ? `${DRAFT_SYSTEM}\n\n${voiceBlock}` : DRAFT_SYSTEM;
  const raw = await llm(prompt, { system, maxTokens: 4000, tag: 'blog-post' });
  if (raw == null || typeof raw !== 'string' || !raw.trim()) throw new Error('LLM returned nothing — claude CLI unauthenticated/failed (run `claude login` once, or run on the Mini where the CLI is verified)');
  const json = String(raw).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = json.indexOf('{'); const end = json.lastIndexOf('}');
  const post = JSON.parse(start >= 0 && end > start ? json.slice(start, end + 1) : json);
  if (!post || typeof post !== 'object' || Array.isArray(post)) throw new Error('LLM draft was not a post object');
  post.date = today; post.updated = today; // fixed ISO — never runtime-computed (site rule)
  if (!post.readingTime) post.readingTime = `${Math.max(3, Math.round(words(postText(post)).length / 200))} min read`;
  return post;
}

/**
 * End-to-end publish: registry read → draft → gates → inject → commit → PR (auto-merge unless YMYL).
 * deps: { fs, exec, llm, log, nowIso, notify? } — exec(cmd, cwd) runs git/gh (injected so tests never
 * shell out); notify overrides the held-PR Slack mirror (injected so tests never touch a webhook).
 * dryRun: full pipeline, no write/exec. Fail-closed: violations → nothing touched.
 */
export async function publishBlogPost(cfg = {}, { brief, deps = {}, dryRun = false, maxPerWeek = null } = {}) {
  const { fs, exec, llm, log = () => {}, nowIso = new Date().toISOString(), pauseFlagPath = null, voiceBlock = '', notify = null } = deps;
  if (!fs) throw new Error('publishBlogPost needs { fs } dep');
  // Cohort guardrail: when the published-post cohort is statistically DECAYING in GSC, the
  // guardrail stamps this flag and publishing refuses until the data recovers (auto-clears).
  // This runs BEFORE the llm/exec check so a paused site never asks for those deps.
  if (pauseFlagPath && fs.existsSync(pauseFlagPath)) {
    return { status: 'paused-by-guardrail', note: 'content-pause.flag present — the post cohort is decaying in GSC; posting resumes automatically when the guardrail clears' };
  }
  if (!llm || (!dryRun && !exec)) throw new Error('publishBlogPost needs { llm, exec } deps');
  const repo = cfg.cms?.repoPath;
  if (!repo) return { status: 'no-repo', note: 'cfg.cms.repoPath not set — nowhere to publish' };
  const registryPath = `${repo.replace(/\/$/, '')}/app/blog/posts.ts`;
  if (!fs.existsSync(registryPath)) return { status: 'no-registry', note: `${registryPath} not found` };
  const source = fs.readFileSync(registryPath, 'utf8');
  const registry = readRegistry(source);

  let post = await draftBlogPost(brief, cfg, { llm, nowIso, voiceBlock });
  // HUMANIZE: if the draft trips the slop lint, one rewrite pass; still sloppy after → fail closed.
  if (cfg.content?.humanize !== false) {
    let ai = aiPatternScore(postText(post));
    if (ai.score > 0.15) {
      log(`  ~ humanizer: draft trips the slop lint (${ai.hits.join(', ')}) — rewriting once`);
      const raw = await llm(JSON.stringify(post), { system: HUMANIZE_SYSTEM, maxTokens: 4000, tag: 'blog-humanize' });
      try {
        const j = String(raw || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const s = j.indexOf('{'), e = j.lastIndexOf('}');
        const re = JSON.parse(s >= 0 && e > s ? j.slice(s, e + 1) : j);
        if (re && typeof re === 'object' && Array.isArray(re.sections)) { re.date = post.date; re.updated = post.updated; re.slug = post.slug; post = re; }
      } catch { /* keep the original draft — the re-lint below decides its fate */ }
      ai = aiPatternScore(postText(post));
      if (ai.score > 0.15) return { status: 'gated', violations: [`reads like AI slop even after humanize pass (${ai.hits.join(', ')})`], post: { slug: post.slug, title: post.title } };
    }
  }
  // Weekly cap = the SMALLER of the configured ceiling and the per-week jittered 3-5 target
  // (June-2026 rec #4: randomized cadence, not a metronome). Explicit maxPerWeek overrides both.
  const { jitteredWeeklyCap } = await import('./index.mjs');
  const cap = maxPerWeek ?? Math.min(cfg.content?.maxPostsPerWeek ?? 7, jitteredWeeklyCap({ client: cfg.name, now: Date.parse(nowIso) || Date.now() }));
  const gate = validateBlogPost(post, registry, { nowIso, maxPerWeek: cap });
  if (!gate.ok) { log(`  ✗ blog gates: ${gate.violations.join(' · ')}`); return { status: 'gated', violations: gate.violations, post: { slug: post.slug, title: post.title } }; }

  const injected = appendPostToRegistry(source, post);
  if (!injected.ok) return { status: 'error', note: injected.error };
  if (dryRun) return { status: 'dry-run', post: { slug: post.slug, title: post.title }, ymyl: gate.ymyl, wordCount: gate.wordCount };

  fs.writeFileSync(registryPath, injected.source);
  const branch = `seo-bot/blog-${post.slug}`.slice(0, 60);
  await exec(`git checkout -b ${branch}`, repo);
  await exec('git add app/blog/posts.ts', repo);
  await exec(`git commit -m "blog: ${post.title.replace(/"/g, "'")} (auto-post, gates green)"`, repo);
  await exec(`git push -u origin ${branch}`, repo);
  const prBody = `Automated post via seo-bot blog-publish. Gates: capsule ${gate.wordCount}w total, dup-overlap ${gate.overlap}, YMYL ${gate.ymyl ? 'FLAGGED — human review required' : 'clear'}.`;
  const prOut = await exec(`gh pr create --title "blog: ${post.title.replace(/"/g, "'")}" --body "${prBody}" --head ${branch}`, repo);
  const prUrl = (String(prOut || '').match(/https:\/\/github\.com\/\S+\/pull\/\d+/) || [null])[0];
  // Clean posts auto-merge (auto-posting); YMYL posts stay open for a human — flag-only, never blocked silently.
  if (!gate.ymyl) await exec('gh pr merge --squash --auto', repo);
  await exec('git checkout -', repo);
  log(`  ✓ blog post ${gate.ymyl ? 'PR OPENED (YMYL — held for review)' : 'PUBLISHED (PR auto-merged)'}: ${post.slug}`);
  // Held YMYL PR = a decision waiting on a human → mirror it to Slack (best-effort, never blocks).
  if (gate.ymyl) {
    try {
      const send = notify || (await import('../notify.mjs')).notifyHeldPr;
      await send(cfg, { title: post.title, prUrl, reason: 'YMYL blog post — held PR, human review required before it ships' }, { log });
    } catch { /* notify is a mirror, not a gate */ }
  }
  return { status: gate.ymyl ? 'pr-held-ymyl' : 'published', post: { slug: post.slug, title: post.title }, branch, prUrl, ymyl: gate.ymyl, wordCount: gate.wordCount };
}
