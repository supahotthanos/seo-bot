// seo-bot · content/voice — distill HOW the winning clinics write into a QUANT profile +
// exemplar passages, kept as training data the drafting pipeline refers back to.
//
// Treat voice as measurable signals, not vibes: sentence-cadence distribution, question
// density, person (we/you) rates, price/number concreteness, reading grade, title patterns,
// heading structure. The profile is per-site then corpus-aggregated (post-weighted medians +
// IQR so one 100-post site doesn't drown ten 5-post sites' register). Exemplars are short
// passages chosen by the SAME quant filters (concrete numbers, varied cadence, no slop tells)
// and are labeled register-reference-only — the near-dup gate in blog-publish makes reusing
// their words structurally impossible. Everything here is PURE (no fs/network) except
// buildVoiceArtifacts, which only writes the two artifact files.

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);

/** crude but stable syllable estimate (vowel groups, silent-e discounted) — for FK grade. */
const syllables = (w) => {
  const m = String(w).toLowerCase().replace(/[^a-z]/g, '').replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, m ? m.length : 1);
};

/** PURE: the per-text signal bundle. All rates are denominated (per-100w / per-1000w). */
export function textStats(text = '') {
  const t = String(text || '').trim();
  const ws = words(t);
  const w = ws.length;
  if (w < 20) return null;
  // 3–80 word sentences only: unpunctuated runs (leftover page chrome, list walls) are not
  // prose cadence and must never enter the distribution.
  const sents = t.split(/(?<=[.!?])\s+/).map((s) => words(s).length).filter((n) => n > 2 && n <= 80);
  const mean = sents.length ? sents.reduce((a, b) => a + b, 0) / sents.length : 0;
  const sd = sents.length > 1 ? Math.sqrt(sents.reduce((a, b) => a + (b - mean) ** 2, 0) / sents.length) : 0;
  const count = (re) => (t.match(re) || []).length;
  const syl = ws.reduce((a, b) => a + syllables(b), 0);
  return {
    words: w,
    sentences: sents.length,
    sentLenMean: +mean.toFixed(1),
    sentLenSd: +sd.toFixed(1),
    questionPer100w: +((count(/\?/g) / w) * 100).toFixed(2),
    firstPersonPer100w: +((count(/\b(we|our|us|i|my)\b/gi) / w) * 100).toFixed(2),
    secondPersonPer100w: +((count(/\b(you|your|yours)\b/gi) / w) * 100).toFixed(2),
    pricePer1000w: +((count(/\$\s?\d/g) / w) * 1000).toFixed(2),
    numberPer100w: +((count(/\b\d[\d,.]*\b/g) / w) * 100).toFixed(2),
    emDashPer1000w: +((count(/—/g) / w) * 1000).toFixed(2),
    exclaimPer1000w: +((count(/!/g) / w) * 1000).toFixed(2),
    contractionPer100w: +((count(/\b\w+['’](s|t|re|ll|ve|d|m)\b/gi) / w) * 100).toFixed(2),
    fkGrade: sents.length ? +(0.39 * (w / sents.length) + 11.8 * (syl / w) - 15.59).toFixed(1) : null,
  };
}

/** PURE: what the winners' TITLES look like (numbers, year, colon, question, how/what/why). */
export function titlePatterns(titles = [], { cities = [] } = {}) {
  const ts = titles.map((t) => String(t || '').trim()).filter((t) => t.length > 4);
  if (!ts.length) return null;
  const cityRe = cities.length ? new RegExp(`\\b(${cities.map((c) => String(c).split(/[ ,]/)[0]).filter(Boolean).join('|')})\\b`, 'i') : null;
  const pct = (f) => +(ts.filter(f).length / ts.length).toFixed(2);
  return {
    n: ts.length,
    avgWords: +(ts.reduce((a, t) => a + words(t).length, 0) / ts.length).toFixed(1),
    withNumber: pct((t) => /\d/.test(t)),
    withYear: pct((t) => /20\d\d/.test(t)),
    withColon: pct((t) => /:/.test(t)),
    question: pct((t) => /\?/.test(t)),
    howWhatWhy: pct((t) => /^(how|what|why|when|which|is|are|do|does|can|should)\b/i.test(t)),
    withCity: cityRe ? pct((t) => cityRe.test(t)) : null,
  };
}

/** PURE: one harvested site → its voice row (text signals + structure + title patterns). */
export function siteVoice(site = {}, { cities = [] } = {}) {
  // Usable = real prose extraction (≥120 words). JS-rendered sites whose articles extract to a
  // stub are EXCLUDED, never averaged in — thin extraction is missing data, not a writing style.
  const posts = (site.posts || []).filter((p) => p && p.text && words(p.text).length >= 120);
  if (!posts.length) return null;
  const stats = posts.map((p) => textStats(p.text)).filter(Boolean);
  if (!stats.length) return null;
  const avg = (k) => +(stats.reduce((a, s) => a + (s[k] ?? 0), 0) / stats.length).toFixed(2);
  return {
    domain: site.domain,
    name: site.name || site.domain,
    posts: posts.length,
    rankWeight: rankWeightForSite(site),
    avgWordsPerPost: Math.round(stats.reduce((a, s) => a + s.words, 0) / stats.length),
    headingsPerPost: +(posts.reduce((a, p) => a + (p.headings || []).length, 0) / posts.length).toFixed(1),
    questionHeadingRate: +(posts.reduce((a, p) => { const h = (p.headings || []); return a + (h.length ? h.filter((x) => /\?/.test(x.text || x)).length / h.length : 0); }, 0) / posts.length).toFixed(2),
    sentLenMean: avg('sentLenMean'), sentLenSd: avg('sentLenSd'),
    questionPer100w: avg('questionPer100w'),
    firstPersonPer100w: avg('firstPersonPer100w'), secondPersonPer100w: avg('secondPersonPer100w'),
    pricePer1000w: avg('pricePer1000w'), numberPer100w: avg('numberPer100w'),
    emDashPer1000w: avg('emDashPer1000w'), exclaimPer1000w: avg('exclaimPer1000w'),
    contractionPer100w: avg('contractionPer100w'),
    fkGrade: avg('fkGrade'),
    titles: titlePatterns(posts.map((p) => p.h1 || p.title), { cities }),
  };
}

/** PURE: how much a site's writing should weigh in the corpus voice — the clinics that ACTUALLY
 *  RANK count more than harvested-but-not-ranking sites (operator directive: "the ones ranking
 *  should be weighted higher"). Derived from SERP/panel rank: #1 ≈ 3.2×, #2 ≈ 2.2×, #4 ≈ 1.2×,
 *  deeper → ~1×; a raw score is a fallback; unknown/non-ranking = 1×. */
export function rankWeightForSite(site = {}) {
  const r = Number(site.bestRank);
  if (Number.isFinite(r) && r >= 1) return +Math.min(3.2, Math.max(1, 3.2 - Math.log2(r))).toFixed(2);
  const s = Number(site.serpScore ?? site.score);
  if (Number.isFinite(s) && s > 0) return +Math.min(3, 1 + s).toFixed(2);
  return 1; // non-ranking / unknown provenance → baseline weight
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2).toFixed(2) : null; };
const quart = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(2) : null; };

/** PURE: corpus-level profile — post-weighted per-site rows → median + IQR per metric. */
export function corpusVoiceProfile(corpus = [], { cities = [] } = {}) {
  const sites = corpus.map((s) => siteVoice(s, { cities })).filter(Boolean);
  if (!sites.length) return null;
  const METRICS = ['avgWordsPerPost', 'headingsPerPost', 'questionHeadingRate', 'sentLenMean', 'sentLenSd', 'questionPer100w', 'firstPersonPer100w', 'secondPersonPer100w', 'pricePer1000w', 'numberPer100w', 'emDashPer1000w', 'exclaimPer1000w', 'contractionPer100w', 'fkGrade'];
  const agg = {};
  for (const k of METRICS) {
    // post-weighted AND rank-weighted: each site contributes samples ∝ (posts capped at 20) × its
    // rankWeight, so the clinics that actually RANK dominate the median while a huge non-ranking
    // site still can't own it outright.
    const vals = sites.flatMap((s) => {
      const reps = Math.max(1, Math.round(Math.min(20, s.posts) * (s.rankWeight || 1)));
      return (s[k] != null && Number.isFinite(s[k])) ? Array(reps).fill(s[k]) : [];
    });
    if (vals.length) agg[k] = { median: median(vals), p25: quart(vals, 0.25), p75: quart(vals, 0.75) };
  }
  const titleRows = sites.map((s) => s.titles).filter(Boolean);
  const titleAgg = {};
  if (titleRows.length) {
    for (const k of ['avgWords', 'withNumber', 'withYear', 'withColon', 'question', 'howWhatWhy', 'withCity']) {
      const vals = titleRows.map((t) => t[k]).filter((v) => v != null);
      if (vals.length) titleAgg[k] = median(vals);
    }
  }
  return { sites: sites.length, postsTotal: sites.reduce((a, s) => a + s.posts, 0), metrics: agg, titles: titleAgg, perSite: sites };
}

const SLOP_LITE_RE = /in today'?s|delve|dive into|game.?chang|look no further|unlock your|elevate your|in conclusion|nestled|boasts|seamless|cutting.edge/i;

/** PURE: pick register-reference passages — concrete (has a number/$), varied cadence, no slop
 *  tells. Pulled from just after the post's H1 so nav/footer boilerplate never qualifies. */
export function pickExemplars(corpus = [], { max = 8 } = {}) {
  const out = [];
  for (const site of corpus) {
    for (const p of (site.posts || [])) {
      if (out.filter((e) => e.domain === site.domain).length >= 2) break;
      const text = String(p.text || '');
      const h1 = String(p.h1 || p.title || '').trim();
      let start = h1 ? text.indexOf(h1) : -1;
      start = start >= 0 ? start + h1.length : Math.floor(text.length / 3);
      const ws = words(text.slice(start, start + 2000));
      if (ws.length < 60) continue;
      const passage = ws.slice(0, 90).join(' ');
      const st = textStats(passage);
      if (!st) continue;
      if (!/\d/.test(passage)) continue;                    // concreteness required
      if (SLOP_LITE_RE.test(passage)) continue;             // no slop register
      if (st.sentLenSd < 3) continue;                       // cadence must vary
      if ((passage.match(/[.!?]/g) || []).length < 2) continue;  // real sentences, not a list wall
      // Title-Case walls (nav dumps, page indexes) have almost no lowercase-initial words.
      const pws = passage.split(/\s+/);
      if (pws.filter((x) => /^[a-z]/.test(x)).length / pws.length < 0.45) continue;
      out.push({ domain: site.domain, name: site.name || site.domain, url: p.url, title: h1, passage });
      if (out.length >= max * 2) break;
    }
  }
  // Prefer passages with prices, then higher cadence variance.
  return out
    .sort((a, b) => (/\$\s?\d/.test(b.passage) ? 1 : 0) - (/\$\s?\d/.test(a.passage) ? 1 : 0) || (textStats(b.passage)?.sentLenSd || 0) - (textStats(a.passage)?.sentLenSd || 0))
    .slice(0, max);
}

/** PURE: the compact block injected into the drafting system prompt. Numbers, not adjectives. */
export function voicePromptBlock(profile, exemplars = []) {
  if (!profile || !profile.metrics) return '';
  const m = profile.metrics;
  const g = (k) => m[k]?.median;
  const L = [
    `VOICE CALIBRATION — learned from ${profile.sites} med spas that actually RANK in their cities (${profile.postsTotal} posts measured, weighted toward the top-ranked). Match the register, never the words:`,
    g('sentLenMean') != null ? `- Sentence cadence: mean ~${g('sentLenMean')} words but sd ~${g('sentLenSd')} — mix short punches with long ones; uniform cadence reads as bot.` : null,
    g('avgWordsPerPost') != null ? `- Depth: winners average ~${Math.round(g('avgWordsPerPost'))} words/post with ~${g('headingsPerPost')} headings; ~${Math.round((g('questionHeadingRate') || 0) * 100)}% of headings are reader questions.` : null,
    g('secondPersonPer100w') != null ? `- Person: "you/your" ~${g('secondPersonPer100w')}/100w vs "we/our" ~${g('firstPersonPer100w')}/100w — talk TO the reader more than about yourself.` : null,
    g('numberPer100w') != null ? `- Concreteness: ~${g('numberPer100w')} numbers per 100w${g('pricePer1000w') ? ` and ~${g('pricePer1000w')} price figures per 1000w` : ''} — specifics over adjectives.` : null,
    g('fkGrade') != null ? `- Reading level: ~grade ${Math.round(g('fkGrade'))}. Plain words, expert content.` : null,
    g('contractionPer100w') != null ? `- Contractions ~${g('contractionPer100w')}/100w (it's/you'll) — write like a person talking.` : null,
    profile.titles?.withNumber != null ? `- Titles: ~${Math.round(profile.titles.withNumber * 100)}% contain a number, ~${Math.round((profile.titles.howWhatWhy || 0) * 100)}% open with how/what/why, avg ~${profile.titles.avgWords} words.` : null,
  ].filter(Boolean);
  if (exemplars.length) {
    L.push('', 'REGISTER REFERENCES (from the winners — match the FEEL; copying any phrasing is blocked by a dup gate and will fail your draft):');
    for (const e of exemplars.slice(0, 3)) L.push(`<<${e.name}>> ${e.passage.slice(0, 420)}`);
  }
  return L.join('\n');
}

export function renderVoiceMd(profile, exemplars = [], { nowIso = '' } = {}) {
  if (!profile) return '# Winner voice profile\n\n_No clinic posts harvested yet._';
  const m = profile.metrics;
  const row = (label, k, unit = '') => m[k] ? `| ${label} | ${m[k].median}${unit} | ${m[k].p25}–${m[k].p75} |` : null;
  return [
    '# Winner voice profile — how the #1-ranked med spas actually write', '',
    `Measured ${String(nowIso).slice(0, 10)} · ${profile.sites} clinic sites · ${profile.postsTotal} posts. Post-weighted medians with IQR (p25–p75).`, '',
    '| metric | median | IQR |', '|--------|--------|-----|',
    row('words / post', 'avgWordsPerPost'), row('headings / post', 'headingsPerPost'),
    row('question-heading rate', 'questionHeadingRate'), row('sentence length (mean w)', 'sentLenMean'),
    row('sentence length (sd)', 'sentLenSd'), row('"you/your" per 100w', 'secondPersonPer100w'),
    row('"we/our/I" per 100w', 'firstPersonPer100w'), row('numbers per 100w', 'numberPer100w'),
    row('price figures per 1000w', 'pricePer1000w'), row('contractions per 100w', 'contractionPer100w'),
    row('em-dashes per 1000w', 'emDashPer1000w'), row('exclamations per 1000w', 'exclaimPer1000w'),
    row('Flesch-Kincaid grade', 'fkGrade'),
    '',
    profile.titles ? `**Titles:** ${Math.round((profile.titles.withNumber || 0) * 100)}% carry a number · ${Math.round((profile.titles.howWhatWhy || 0) * 100)}% open how/what/why · ${Math.round((profile.titles.question || 0) * 100)}% are questions · avg ${profile.titles.avgWords} words.` : '',
    '', '## Per-site register (rank-weight = how much each site drives the profile; rankers weighted up)',
    '| clinic | rank-wt | posts | w/post | sent μ/σ | you/100w | nums/100w | $/1000w | grade |',
    '|--------|---------|-------|--------|----------|----------|-----------|---------|-------|',
    ...(profile.perSite || []).slice().sort((a, b) => (b.rankWeight || 1) - (a.rankWeight || 1)).map((s) => `| ${s.name} | ${s.rankWeight ?? 1}× | ${s.posts} | ${s.avgWordsPerPost} | ${s.sentLenMean}/${s.sentLenSd} | ${s.secondPersonPer100w} | ${s.numberPer100w} | ${s.pricePer1000w} | ${s.fkGrade} |`),
    '', '## Exemplar passages (register reference ONLY — the near-dup gate blocks reuse)',
    ...exemplars.map((e) => `- **${e.name}** — [${e.title || e.url}](${e.url})\n  > ${e.passage.slice(0, 300)}…`),
  ].filter((x) => x != null).join('\n');
}

/** Distill + persist the training data: voice-profile.json (machine) + voice.md (human). */
export function buildVoiceArtifacts(corpus = [], { fs, dir, cities = [], nowIso = new Date().toISOString() } = {}) {
  if (!fs || !dir) throw new Error('buildVoiceArtifacts needs { fs, dir }');
  const profile = corpusVoiceProfile(corpus, { cities });
  if (!profile) return null;
  const exemplars = pickExemplars(corpus);
  const promptBlock = voicePromptBlock(profile, exemplars);
  fs.writeFileSync(`${dir}/voice-profile.json`, JSON.stringify({ builtAt: nowIso, cities, profile: { ...profile, perSite: profile.perSite }, exemplars, promptBlock }, null, 2));
  fs.writeFileSync(`${dir}/voice.md`, renderVoiceMd(profile, exemplars, { nowIso }));
  const topWeighted = [...profile.perSite].sort((a, b) => (b.rankWeight || 1) - (a.rankWeight || 1))[0];
  return { profile, exemplars, promptBlock, summary: `${profile.sites} sites · ${profile.postsTotal} posts · rank-weighted (top: ${topWeighted?.name} ${topWeighted?.rankWeight}×) · sent ~${profile.metrics.sentLenMean?.median}w (sd ${profile.metrics.sentLenSd?.median}) · grade ~${profile.metrics.fkGrade?.median} · ${exemplars.length} exemplars` };
}
