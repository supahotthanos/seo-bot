# BLOG KIT — the AI-citable blog section (spec for the web dev)

A blog architecture that is (a) dead-simple for us to add/edit posts, and (b) built from the
content shapes that actually get cited by AI engines. Every rule below is backed by the research
corpus (Peec AI / Metehan / Princeton GEO / Deep Research log forensics) and is what the bot's
own audit rules check — build it this way and `seo-bot audit` scores it green out of the box.

## The one law everything follows

**AI agents read a top→bottom linearization of the HTML SOURCE.** Head discarded, ~5–6k character
first-read window, no JS execution, no pixels. So: server-rendered HTML only, answer first in
source order, data as real text (tables), images always paired with text equivalents.

## Architecture (keep it boring)

- **MDX (or markdown + frontmatter) files in the repo** — one file per post, `content/blog/<slug>.mdx`.
  No CMS, no DB. Editing = edit a text file, PR, merge. The bot can propose edits as PRs to these
  files through its existing pipeline.
- **Frontmatter**: `title, description, date, dateModified, author (named person), reviewer
  (named medical reviewer for YMYL), city/service tags, sources[]`.
- **Everything server-rendered** (Next.js RSC / static generation). Zero client-side data fetching
  for content. A chart that needs JS to appear does not exist to an AI crawler.
- `dateModified` bumps ONLY with a real content change (the bot's fake-refresh guard enforces this
  — a date-only bump is detected by engines and backfires).

## The 8 components (this is the whole editing vocabulary)

Build these once; every post is just these blocks stacked. All server components, all real HTML.

1. **`<AnswerCapsule>`** — the 40–60 word self-contained answer, FIRST block after the H1.
   Renders a styled `<p>`. Rules the bot lints: 40–60 words, sentences ≤17 words, within the
   first ~5,000 chars of body source (keep nav/hero out of the source before it).
2. **`<QA>`** — a question-form H2 (`How much does Botox cost in Tampa?`) + its own 40–60 word
   capsule + optional detail. Each QA block targets one fan-out sub-query. 3–8 per post.
3. **`<ComparisonTable>`** — a REAL `<table>` (never an image): treatments, prices, downtime,
   sessions. Comparison sections lift citations ~25–38%. Takes a simple array/JSON.
4. **`<StatCallout>`** — one big number + source + link (`$12–18/unit · ASPS 2026`). Statistics
   lift citations ~+32–34% — but every number must be real and sourced (the bot's no-fabrication
   gate blocks made-up figures).
5. **`<PriceTable>`** — service × price-RANGE rows (ranges, never invented point prices) with a
   "last verified" date. This is the answer-box bait for cost queries.
6. **`<ChartSVG>`** — charts as inline SVG rendered server-side from a data array, ALWAYS followed
   by a collapsed `<details><table>` of the same data. The SVG is for humans; **the table is what
   the AI reads** (agents read text, not pixels). Never ship a chart as a PNG or a client-JS lib.
7. **`<Sources>`** — the citation list (named authorities: FDA, journals, .gov/.edu). Cited
   sources lift citations ~+28–29% and are required by the bot's content gates (≥2 primary).
8. **`<LocalBlock>`** — address/NAP as text, hours, service area, and the map as a STATIC image
   or SVG with the location repeated in text + alt. (An embedded JS map is invisible to agents.)

### Images (the actual rule set)
- Real photos > stock; every image gets **rich descriptive alt text** — Deep Research reads alt
  text AS content, so alt is a content field, not a checkbox ("Morpheus8 treatment on lower face,
  session 2 of 3, Tampa clinic" not "spa image").
- Width/height attributes, `next/image` or equivalent, lazy below the fold, LCP image preloaded.
- Never put information ONLY in an image (screenshots of tables/prices are invisible to AI —
  recreate as HTML tables).

### What NOT to build (dead tactics — don't spend a minute on these)
- FAQPage/HowTo schema for rich results (deprecated May 2026; QA blocks in HTML do the work).
- llms.txt machinery (97% of domains that publish it get zero AI-bot fetches).
- "Best med spa" self-ranking pages (backfires — AI recommends a competitor ~69% of the time).
- Client-side rendered anything for content. Keyword-stuffed variants (negative signal, ~−8%).
- Image-only infographics. Fake "Updated <today>" dates.

## Post template (what an editor actually types)

```mdx
---
title: "How Much Does Morpheus8 Cost in Tampa? (2026 Prices)"
description: "Real Tampa Morpheus8 pricing: $700–1,500/session, 3 sessions typical."
date: 2026-07-03
dateModified: 2026-07-03
author: "Jane Smith"
reviewer: "Dr. A. Patel, MD"
service: "morpheus8"
city: "tampa"
sources: ["https://www.fda.gov/...", "https://pubmed..."]
---

<AnswerCapsule>
Morpheus8 in Tampa costs $700–1,500 per session in 2026, with most patients needing
three sessions spaced 4–6 weeks apart. Total treatment cost typically runs $2,100–4,500
depending on treatment area and provider experience.
</AnswerCapsule>

<QA q="How many Morpheus8 sessions do I need?">…40–60 word answer…</QA>
<PriceTable data={...} verified="2026-07-01" />
<ComparisonTable data={...} />   {/* Morpheus8 vs microneedling vs laser */}
<StatCallout value="$700–1,500" label="per session, Tampa 2026" source="..." />
<ChartSVG data={...} caption="..." />   {/* auto-renders the <details> data table */}
<Sources />
<LocalBlock />
```

## Layout rules for the page shell (source order is destiny)

1. HTML source order: `H1 → AnswerCapsule → byline/reviewed-by → body blocks → nav/footer`.
   If the design wants nav visually on top, CSS-position it — keep it LATE in source.
2. The first ~5,000 characters of body source must contain: the H1, the capsule, the first QA,
   and the primary stat. (The bot now audits this: `aeo-read-window`.)
3. One post = one intent (a service × city × question cluster). No 4,000-word everything-pages —
   coverage across many focused posts beats one giant page (fan-out coverage beats peak rank).
4. Schema auto-emitted from frontmatter by the layout (Article + author Person + reviewer +
   LocalBusiness/MedicalBusiness org, `sameAs` links) — the editor never touches JSON-LD.
5. Auto-generated `dateModified` sitemap lastmod (real diffs only — wired to the bot's guard).

## How the bot plugs in (already built)

- `seo-bot audit` lints every rule above (capsule size/position, read window, sentence ceiling,
  question headings, stats/sources presence, promo tone, schema, image alt).
- `seo-bot fanout-plan` tells us which QA blocks/posts to add next (uncovered sub-queries).
- Content drafts flow through the existing gates (no-fabrication, named reviewer, originality)
  and land as PRs against `content/blog/*.mdx` — the web dev just reviews and merges.
