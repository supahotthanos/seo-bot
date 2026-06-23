# AEO pioneer tactics → med-spa directory playbook (June 2026)

> From a 26-agent operator hunt + 13-operator tactic deep-dive (Floate, Chou, Metehan, Sturm,
> Vickers, Ward, Nuttall, Goldie, Reiner, Rush, Schneider, Dooley, Boring Local SEO).
> Verified tactics are encoded in `seo-bot/src/tactics/registry.mjs` (risk-labeled). Operators
> + handles in `research/seo-pioneers/manifest.json`. **Anchor handles corrected:** Edward
> **Sturm = @edwardeachday**, Jacky Chou **= @indexsy** (parent of @boringlocalseo).

## The one unifying thesis (everyone converges here)
**"AI doesn't rank pages — it cites a small, predictable set of SOURCES. Your site isn't the
battlefield."** (Floate). For *local* med-spa intent those sources are aggregators + "Best X in
[City]" listicles (Yelp, RealSelf, local news, a few directories) — **not** individual spa sites.
Chou: *"2026 is the year of the listicle"* (claims 43.8% of ChatGPT citations are Best-X lists —
his borrowed stat, treat as marketing). **So a med-spa DIRECTORY's entire AEO game is to become
one of the cited cluster sources — i.e. to BE the listicle the LLM lifts.**

## The white/grey playbook (do these — encoded as actionable tactics)
1. **Source-cluster recon** (`aeo-source-cluster-map`, auto) — run N med-spa intent prompts per city across ChatGPT/Perplexity/AIO, log every cited domain, cluster to the ~10-50 sources in 80%+ of answers. That finite list = the per-city placement + content backlog. *The highest-leverage play; the bot can build this on its existing measure/serp stack.*
2. **Be the city listicle** (`aeo-city-listicle`, opt-in) — each city page = a genuine "Best Med Spas in [City] 2026" ranked list: real criteria, real reviews, one-line reason + **price** each, **ItemList schema**, frequent re-touch, submit to Bing. **NEVER self-rank #1** — Chou's self-#1 network was demoted Jan-2026 (−49%); AI recommends a rival ~69% of the time anyway.
3. **Answer capsules** (already in `answer-first`) — front-load the direct answer in sentence 1, pack a stat/price, keep sentences self-contained so they quote cleanly out of context.
4. **Entity co-occurrence** (`aeo-entity-cooccurrence`, manual) — consistent "<Directory> + <treatment> + <city>" mentions across local press, niche blogs, Wikidata, schema. **Unlinked mentions count.** Consistent NAP everywhere.
5. **Schema** (already in `schema-entity`) — LocalBusiness/MedicalBusiness + FAQPage content + Offer/price + ItemList; aggregateRating **only** where reviews are genuine.
6. **Bing-first** (`aeo-bing-first`, auto) — ChatGPT Search rides Bing (~87% overlap); seed the easier Bing/Copilot surface first (SubmitUrlbatch + IndexNow already built).
7. **Earn into the cluster** (`third-party-listicles`, manual) — get the directory featured on the third-party "best med spas in [city]" pages that already get cited (outreach, data partnerships, "powered by <Directory> data" widgets).
8. **Authentic UGC** (`reddit-ugc-seeding`, manual) — real staff give genuinely helpful, **disclosed** answers naming the directory on Reddit/Quora med-spa threads. This is where local LLM citations actually originate — but it must stay human (no farming).
9. **Video + transcripts** (`aeo-video-transcript`, opt-in) — per-city explainer videos with clean transcripts mirroring the capsules.

## Record-for-defense — DO NOT automate (encoded as black, threat models)
- **Hidden text / prompt injection** into LLM-ingested pages (Floate's "Black Hat AI") — `aeo-prompt-injection`. Deceptive, against OpenAI/Google policy, burns trust with the engines you want citing you.
- **Buy self-#1 listicle / PBN placements** (Chou sells $99 100-PBN packs) — `aeo-buy-listicle-pbn`. Already penalized Jan-2026. Competitors may spam these *at* you.
- **Reddit account-farming + bought upvotes** (Chou's ~100-aged-account SOP) — `reddit-account-farming` (legalBlock). CIB + fake endorsements (Reddit TOS + FTC).
- **AI-generated/fake reviews** — already `fake-reviews` (legalBlock, FTC 16 CFR 465). For a YMYL med-spa directory these are existential — fabricated patient testimony torches trust instantly.

## Operator trust tiers (for source-trust.json)
- **Charles Floate (@Charles_SEO)** — methodology-trusted / claims-quarantined. His recon + capsule + entity framework is sound; his numbers ("300%+", "0→#1") are course marketing; his self-labeled black-hat modules are record-not-run.
- **Jacky Chou (@indexsy)** — ADVERSARIAL_SIGNAL (already quarantined). The listicle thesis is real and currently sold; the "43.8%"/"2.3M citations" figures are borrowed/unverifiable; his parasite + Reddit-farm tactics are TOS-violating and have *already proven fragile* (his own $550k/mo parasite empire collapsed end-2024; his listicle network got hit Jan-2026). Facts-but-fragile on tactics; claims-not-facts on stats.
- **Edward Sturm (@edwardeachday)**, **Metehan (@metehan777)** — NAMED_PRACTITIONER, AEO-frontier; Metehan leans grey (manufacture-citations experiments). The rest (Vickers/Ward/Nuttall/Goldie/Reiner/Rush/Schneider/Dooley) — practitioner-tier, grey-leaning, study-don't-worship.

## The honest bottom line for the directory
The **recon → city-listicle → answer-capsule → entity → schema → earn-into-cluster** stack captures ~80% of the AEO upside with **zero penalty risk**. Everything past that line (injection, PBN listicles, Reddit farming, fake reviews) is fragile, TOS-violating, and — for a health-adjacent directory — a trust/FTC landmine. The bot is set up to *do* the white/grey set and *recognize* the black set, never emit it.
