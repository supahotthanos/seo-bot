// seo-bot · content/terms — TF / TF-IDF n-gram extractor (Surfer/Frase-style).
//
// Given a competitor corpus (the body text of the top-N organic results), tokenize
// each doc to 1–3-grams, drop English + med-spa stopwords, compute per-doc TF and
// corpus TF-IDF, and emit a ranked "terms to use" list with each term's competitor
// mean / min / max count + a recommended range (Surfer's [low, high] band).
//
// Pure IR, zero deps, deterministic. Operates ONLY on text already in the corpus —
// it never fetches, never invents. The recommended range is derived from where the
// competitors who actually USE the term land (we don't punish a draft for missing a
// term that only one outlier used once).

/** Words that carry no topical signal — generic English + med-spa boilerplate/nav chrome. */
export const STOPWORDS = new Set([
  // articles / conjunctions / prepositions / pronouns
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'about', 'as', 'into', 'like', 'through', 'after', 'over', 'between', 'out', 'against',
  'during', 'without', 'before', 'under', 'around', 'among', 'from', 'up', 'down', 'off', 'above', 'below',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing', 'have', 'has',
  'had', 'having', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs', 'who', 'whom',
  'whose', 'which', 'what', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  's', 't', 'just', 'don', 'now', 'also', 'get', 'got', 'one', 'two', 'use', 'used', 'using', 'make',
  'made', 'see', 'way', 'well', 'even', 'much', 'many', 'every', 'here', 'there', 'their', 'theirs',
  // web/nav chrome that survives body-text stripping
  'home', 'menu', 'login', 'sign', 'cookie', 'cookies', 'privacy', 'policy', 'terms', 'copyright',
  'rights', 'reserved', 'click', 'read', 'learn', 'contact', 'page', 'website', 'site', 'search',
  'skip', 'toggle', 'navigation', 'footer', 'header', 'subscribe', 'newsletter', 'share', 'follow',
  // med-spa boilerplate that's everywhere and thus non-discriminating
  'spa', 'med', 'medspa', 'medspas', 'call', 'today', 'book', 'booking', 'appointment', 'schedule',
  'consultation', 'consult', 'us', 'our', 'we', 'your', 'you',
]);

const TOKEN_RE = /[a-z][a-z'-]*[a-z]|[a-z]/g;

/** Lowercase + tokenize to alpha words (keeps internal hyphens/apostrophes). */
export function tokenize(text = '') {
  return (String(text).toLowerCase().match(TOKEN_RE) || []).filter((w) => w.length >= 2 && w.length <= 30);
}

/** True if an n-gram is worth keeping: at least one non-stopword, no all-stopword glue. */
function keepGram(words) {
  if (words.some((w) => /\d/.test(w))) return false;
  // unigram: must not be a stopword. multigram: edges must not be stopwords (avoids "of the X").
  if (words.length === 1) return !STOPWORDS.has(words[0]);
  if (STOPWORDS.has(words[0]) || STOPWORDS.has(words[words.length - 1])) return false;
  // require at least one fully content word
  return words.some((w) => !STOPWORDS.has(w));
}

/** Count 1–3-gram term frequencies in one doc. Returns Map<term, count>. */
export function ngramCounts(text, maxN = 3) {
  const toks = tokenize(text);
  const counts = new Map();
  for (let n = 1; n <= maxN; n++) {
    for (let i = 0; i + n <= toks.length; i++) {
      const slice = toks.slice(i, i + n);
      if (!keepGram(slice)) continue;
      const term = slice.join(' ');
      counts.set(term, (counts.get(term) || 0) + 1);
    }
  }
  return counts;
}

/** Quantile of a sorted-ascending numeric array (linear interpolation). */
function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/**
 * Extract ranked terms from a corpus.
 * @param {{docs:[{url,text,words?}], query?:string}} corpus  output of buildCorpus()
 * @param {{maxN?:number, top?:number, minDocFreq?:number}} [opts]
 * @returns {{ query, docCount, terms:[{term,n,df,tfidf,corpusCount,docMean,docMin,docMax,
 *            usersMean,recommended:{min,max,target},weight}] }}
 *
 * Range semantics (anti-overfit): mean/min/max are over the documents that USE the term;
 * `recommended` band = [round(p25_users), round(p75_users)] with target = round(usersMean),
 * floored at 1. A draft is "in range" inside [min,max].
 */
export function extractTerms(corpus, { maxN = 3, top = 120, minDocFreq = 2 } = {}) {
  const docs = (corpus?.docs || []).filter((d) => d && d.text);
  const N = docs.length;
  if (!N) return { query: corpus?.query || '', docCount: 0, terms: [] };

  // Per-doc counts + total terms per doc (for TF normalization).
  const perDoc = docs.map((d) => {
    const counts = ngramCounts(d.text, maxN);
    let total = 0;
    for (const v of counts.values()) total += v;
    return { counts, total: total || 1 };
  });

  // Document frequency + per-doc count list per term.
  const df = new Map();          // term -> # docs containing it
  const countsByTerm = new Map(); // term -> [count in each doc that has it]
  for (const { counts } of perDoc) {
    for (const [term, c] of counts) {
      df.set(term, (df.get(term) || 0) + 1);
      if (!countsByTerm.has(term)) countsByTerm.set(term, []);
      countsByTerm.get(term).push(c);
    }
  }

  // TF-IDF: sum across docs of tf(doc) × idf(term). idf = ln(N / df) (smoothed).
  const rows = [];
  for (const [term, docFreq] of df) {
    if (docFreq < Math.min(minDocFreq, N)) continue; // require it in 2+ docs (or all, if tiny corpus)
    const idf = Math.log(1 + N / docFreq);
    let tfidf = 0;
    for (const { counts, total } of perDoc) {
      const c = counts.get(term);
      if (c) tfidf += (c / total) * idf;
    }
    const used = countsByTerm.get(term).slice().sort((a, b) => a - b);
    const usersMean = used.reduce((s, x) => s + x, 0) / used.length;
    // corpus-wide per-doc stats (counting zeros for docs that don't use it)
    const allCounts = perDoc.map((d) => d.counts.get(term) || 0).sort((a, b) => a - b);
    const corpusCount = allCounts.reduce((s, x) => s + x, 0);
    const docMean = corpusCount / N;
    const recMin = Math.max(1, Math.round(quantile(used, 0.25)));
    const recMax = Math.max(recMin, Math.round(quantile(used, 0.75)));
    rows.push({
      term, n: term.split(' ').length, df: docFreq,
      tfidf: Math.round(tfidf * 1e5) / 1e5,
      corpusCount, docMean: Math.round(docMean * 100) / 100,
      docMin: allCounts[0], docMax: allCounts[allCounts.length - 1],
      usersMean: Math.round(usersMean * 100) / 100,
      recommended: { min: recMin, max: recMax, target: Math.max(1, Math.round(usersMean)) },
    });
  }

  // Rank by TF-IDF × a mild n-gram bonus (phrases are higher-intent than single words),
  // weighted toward terms more competitors agree on (df). This is the "terms to use" order.
  rows.sort((a, b) => {
    const wa = a.tfidf * (1 + 0.15 * (a.n - 1)) * (a.df / N);
    const wb = b.tfidf * (1 + 0.15 * (b.n - 1)) * (b.df / N);
    return wb - wa;
  });
  const terms = rows.slice(0, top);
  // attach a normalized 0..1 weight (for the score's coverage weighting)
  const maxTfidf = terms.reduce((m, t) => Math.max(m, t.tfidf), 0) || 1;
  for (const t of terms) t.weight = Math.round((t.tfidf / maxTfidf) * 1000) / 1000;

  return { query: corpus?.query || '', docCount: N, terms };
}
