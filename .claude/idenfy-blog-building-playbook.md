# Blog-Building Playbook (iDenfy)

The consolidated logic for producing blog posts that rank in Google, get cited by AI engines (GEO), read as human-written, and convert. Built from: iDenfy's live WordPress blog structure, a Google-guidelines/Databricks SEO audit, **Ahrefs keyword + SERP validation**, and an AI-detection QA gate (ZeroGPT).

Publishing target: **iDenfy** → WordPress Gutenberg blocks (Section 6).

Use this as the checklist for every new post.

---

## 0. Pipeline at a glance

1. **Validate demand first** — run the target keyword + variants through Ahrefs (Section 4) *before* writing. Lead with the keyword that actually has volume at reachable difficulty. Pull real queries from Google Search Console where connected (Section 4a).
2. **Draft** the article in Markdown (fast to write/edit, easy to review).
3. **Structure** it to the pattern (Section 2) and apply the GEO upgrades (Section 3).
4. **QA gate** — run the authored prose through ZeroGPT; rewrite only if the AI score is high (Section 5).
5. **Ship**: convert to Gutenberg blocks (Section 6), with JSON-LD schema + SEO title/meta (Section 7).

---

## 1. Audience & voice principles (the "why")

- **Two readers at once.** Write for the practitioner (compliance/onboarding/eng who execute) *and* the economic buyer (the person who signs off on ROI). Cover both the business problem and the execution.
- **People-first, not keyword-first.** Lead with the answer; earn the ranking by being genuinely useful.
- **Relentless specificity.** Replace vague claims with concrete numbers, named sources, real workflows. This is what wins E-E-A-T and what AI models can't synthesize on their own.
- **"Glass box," not "fluff."** Show the actual mechanism — a table, a code/JSON payload, a step-by-step, a real data point — rather than hand-waving.
- **YMYL scrutiny.** AML/KYC/compliance is "Your Money or Your Life" content. Google applies the highest trust bar, so primary sources, accuracy, and clear authorship matter more here than in a generic blog.

---

## 2. The iDenfy blog structure (match this)

Derived from iDenfy's live posts (e.g. the "Top 5 Identity Verification Software" listicle). Standard top-to-bottom flow:

1. **H1 = post title** — set in the WP title field, **not** in the body. Frame it as the buyer's search query; keep ≤ ~60 chars.
2. **Author byline + job title + reading time** — rendered by the theme (handled separately, not hand-coded in the body). Establishes the author entity Google/AI engines look for.
3. **`Last updated: [Month Year]`** — small-text line near the top; proves freshness.
4. **Intro (TL;DR-style)** — answer/why-it-matters up top, ideally with a primary-source stat. Don't bury the lead.
5. **Optional "Who this is for / methodology" callout** — a `blockquote` box that scopes the article (and discloses methodology on comparison pieces, since iDenfy is the publisher).
6. **H2 body sections** with deep **H3** sub-points. On feature/criteria sections, H3s use the `is-style-subheading` style.
7. **Tables** for any comparison — real HTML/Gutenberg tables, never screenshots of tables (AI engines parse text tables, not images).
8. **Contextual proof** — distribute testimonials/quotes *next to the point they validate*, not dumped in one block at the bottom.
9. **Images/figures** — dashboard screenshots with captions on relevant sections (`wp:image`). iDenfy posts lean visual.
10. **FAQ** — 3–7 real questions as H3s, each answered in ≤ ~60 words (long-tail + AI-snippet capture).
11. **"Read more articles"** internal-link list.
12. **Closing CTA** — separator + a final line linking to the relevant product page.
13. **Disclaimer** (on comparison/ratings posts).

**Internal linking:** link generously to related idenfy.com/blog and product pages in-content (in-tab). Add `target="_blank" rel="noreferrer noopener"` only to **external** sources.

---

## 3. GEO / AI-Overview upgrades (apply to every post)

These make the content "extractable" by Perplexity/Gemini/ChatGPT/Google AI Overviews. From the Google-guidelines + Databricks audit:

- **Author entity + micro-UX** (byline, job title, reading time, last-updated) at the top — trust + structural markers AI looks for. *(iDenfy theme handles byline/reading time.)*
- **Answer blocks.** The first 1–2 sentences under each `H2/H3` question must be a self-contained, ~40–60-word definition/answer an LLM can lift verbatim. Tie the entity to context (e.g. "In AML compliance, adverse media surfaces high-risk profiles *before* they appear on sanctions or PEP lists").
- **Extraction-friendly tables.** Convert any "X vs. Y" prose into a comparison table.
- **Glass-box technical proof.** Where a product mechanism is described, show it concretely — e.g. a conceptual JSON webhook payload for "ongoing monitoring," a config example, or a precise step list.
- **Anchor IDs on headings** (`id="step-1"`, `#faq`, etc.) so the JSON-LD step URLs and any TOC actually resolve.
- **Short paragraphs** (2–3 sentences), white space, scannable lists.
- **Mid-page CTA** after you solve the primary pain point — don't wait for the end.

---

## 4. Keyword + SERP validation (Ahrefs)

Validate demand **before** writing. This replaces guess-driven topics with evidence and stops you from writing a great post for a keyword nobody searches.

- **Tooling:** `claude.ai Ahrefs` MCP connector (`mcp__claude_ai_Ahrefs__*`). Call the `doc` tool for a tool's input schema **before first use**. Load schemas via ToolSearch `select:` first. Monetary values are USD cents (÷100). Requests consume API units — batch keywords into one call.
- **Keyword overview:** `keywords-explorer-overview` — pass a comma-separated `keywords` list, `country` (e.g. `us`), and `select: keyword,volume,difficulty,cpc,intents,parent_topic`. Read **volume** (real monthly demand), **difficulty/KD** (0–100; KD < ~15 is reachable for a low-DR domain), and **intents** (commercial/transactional = closer to conversion).
- **Pick the head term by `parent_topic`.** Multiple variants often roll up to one parent — target the parent in the title, the variants as long-tail.
- **SERP check:** `serp-overview` for the target keyword + country shows who ranks (DR, backlinks, traffic) and which **SERP features** fire (AI overview, snippet, FAQ, video). If the top results are all high-DR, retarget a lower-KD long-tail; if a `snippet`/`question`/`ai_overview` feature is present, structure an answer block + FAQ to capture it.
- **Record the evidence in the draft.** Carry a short SEO-strategy table with the Ahrefs volume/KD/intent numbers — so the keyword choice is auditable, not vibes.

### 4a. Google Search Console (first-party demand)

When a property is connected, GSC beats third-party estimates for *what already ranks* and *near-ranking ("striking distance", pos. 5–15) queries* worth a dedicated post.

- **Via Ahrefs:** `gsc-keywords` / `gsc-pages` (needs a `project_id` from `management-projects` with GSC connected).
- Verify domain ownership in Search Console (HTML-tag meta or DNS TXT), then add the site as an Ahrefs project and connect GSC OAuth.

> **Proof quotes:** real customer quotes remain the E-E-A-T ideal for YMYL posts. Source them only from real published case studies or with explicit permission — never invent. If none fit, ship without rather than fabricate.

---

## 5. AI-detection QA gate (ZeroGPT)

Before shipping, sanity-check that the authored prose reads as human-written.

- **What to test:** the authored narrative only — exclude verbatim quotes, code/JSON blocks, and JSON-LD (they skew the result).
- **How:** paste into ZeroGPT (zerogpt.com) → "Detect Text" → read the AI % and the "Human written" verdict. (Note: the site throws a cookie-consent + ad-block modal that must be dismissed first.)
- **Threshold:** a low score with a "Human written" verdict passes. **Rewrite only if findings are "huge"** (high AI %, flagged as AI-generated) — then humanize the flagged sentences (vary rhythm, cut generic connective tissue, add specificity) and re-test.
- **Benchmark on file:** the adverse-media article scored **10.7% AI — "Human written"** (June 2026). No rewrite needed. Treat that band as the pass bar.

---

## 6. WordPress conversion (Gutenberg blocks)

Deliver the final post as native Gutenberg block markup to paste into the WP **code editor**. Conventions (mirror iDenfy's existing posts):

- Wrap every block in `<!-- wp:* -->` / `<!-- /wp:* -->` comments.
- Headings: `<h2 class="wp-block-heading" id="...">`; sub-headings `<h3 class="wp-block-heading is-style-subheading">`.
- Lists: `<ul class="wp-block-list">`.
- Tables: `<!-- wp:table --> <figure class="wp-block-table">…`.
- Pull-quotes: `<!-- wp:quote --> <blockquote class="wp-block-quote"><p>…</p><cite>— …</cite></blockquote>`.
- Code/JSON: `<!-- wp:code --> <pre class="wp-block-code"><code>…</code></pre>`.
- Raw HTML (e.g. JSON-LD): `<!-- wp:html -->`.
- Images: `<!-- wp:image --> <figure class="wp-block-image …"><img …/><figcaption>…</figcaption></figure>`.
- `&` → `&amp;` inside text; H1 and author byline stay **out** of the body.

---

## 7. Schema & metadata

- **JSON-LD** appropriate to the post type (e.g. `HowTo` for step playbooks, `FAQPage`/`Article` otherwise). Ship it in a `wp:html` block; `HowToStep` URLs must match the on-page anchor IDs.
- **SEO title tag + meta description** — buyer-query framed, title ≤ ~60 chars, description ~150–160.
- **Slug** — short and keyword-clean (e.g. `adverse-media-checks`).

> For a multi-article batch, write a shared spec file and fan out one subagent per article — keeps format and facts identical across the set.

---

## Quick pre-publish checklist

- [ ] Keyword validated in Ahrefs (volume + reachable KD); evidence recorded in the draft.
- [ ] Title is a buyer/searcher query, ≤ 60 chars; slug is clean.
- [ ] Intro answers "why" up top (with a stat where one exists).
- [ ] Every question/section has a 40–60-word answer block (GEO-extractable).
- [ ] One concrete "glass box" element (table/JSON/step list) where it fits.
- [ ] FAQ (3–7 Qs, ≤60-word answers) + internal links + closing CTA.
- [ ] JSON-LD + SEO title/meta included; ZeroGPT "Human written," low AI %.
- [ ] Delivered as Gutenberg blocks; heading anchor IDs matched to JSON-LD.
- [ ] Real, verbatim, role-only-anonymized quote(s) placed contextually (or omitted, never faked).
- [ ] Author byline/reading time handled by theme (not in body).
