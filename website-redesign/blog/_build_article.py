#!/usr/bin/env python3
"""
Build a blog article from a spec: cover SVG, head + JSON-LD, index card,
sitemap entry, and inbound internal links.

The mechanical parts of an article — meta tags, FAQ schema, the nav and footer,
the card on /blog/, the sitemap row — are identical across every post and are
exactly where hand-writing drifts. This generates them from one spec so a new
article cannot ship with a stale canonical, a missing schema entry, or an
orphaned URL (which has happened here before: best-compliance-platforms sat live
for weeks with no sitemap row and no card, so Google never found it).

Prose is NOT generated. `body` is written by hand per article.

Usage: import build(spec) from a sibling script.
"""

import html
import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "assets", "blog")
SITEMAP = os.path.join(HERE, "..", "sitemap.xml")
INDEX = os.path.join(HERE, "index.html")
TEMPLATE = os.path.join(HERE, "best-compliance-platforms.html")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SITE = "https://whalehub.io"


def _template_parts():
    t = open(TEMPLATE).read()
    nav = t[t.index('<header class="topbar">'):t.index('</header>') + len('</header>')]
    foot = t[t.index('<footer>'):]
    return nav, foot


def make_cover(slug, line1, line2, sub, tag, tag_w=180, size1=66, size2=66):
    """Clone the house cover template, swapping only text and the pill width."""
    src = open(os.path.join(ASSETS, "best-compliance-platforms.svg")).read()
    out = (src
           .replace(">COMPLIANCE<", f">{tag}<")
           .replace('width="180" height="40" rx="20"', f'width="{tag_w}" height="40" rx="20"')
           .replace('font-size="66" font-weight="800" fill="#ffffff" letter-spacing="-1.5">Best Compliance<',
                    f'font-size="{size1}" font-weight="800" fill="#ffffff" letter-spacing="-1.5">{line1}<')
           .replace('font-size="66" font-weight="800" fill="#ffffff" letter-spacing="-1.5">Platforms<',
                    f'font-size="{size2}" font-weight="800" fill="#ffffff" letter-spacing="-1.5">{line2}<')
           .replace(">Top KYC &amp; KYB providers · 2026<", f">{sub}<"))
    svg_path = os.path.join(ASSETS, f"{slug}.svg")
    png_path = os.path.join(ASSETS, f"{slug}.png")
    open(svg_path, "w").write(out)
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-sandbox",
                    "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--window-size=1200,630", f"--screenshot={png_path}",
                    f"file://{svg_path}"],
                   capture_output=True, timeout=120)
    return os.path.exists(png_path)


def build(spec):
    slug = spec["slug"]
    url = f"{SITE}/blog/{slug}"
    img = f"{SITE}/assets/blog/{slug}.png"
    title, desc, date = spec["title"], spec["description"], spec["date"]

    nav, foot = _template_parts()

    faq_items = [{
        "@type": "Question",
        "name": html.unescape(q),
        "acceptedAnswer": {"@type": "Answer",
                           "text": html.unescape(re.sub(r"<[^>]+>", "", a))},
    } for q, a in spec["faqs"]]

    ld = json.dumps({"@context": "https://schema.org", "@graph": [
        {"@type": "Article", "@id": url + "#article", "headline": title,
         "description": desc,
         "image": {"@type": "ImageObject", "url": img, "width": 1200, "height": 630},
         "datePublished": date, "dateModified": date,
         "author": {"@type": "Organization", "@id": f"{SITE}/#organization",
                    "name": "WhaleHub Research", "url": f"{SITE}/",
                    "sameAs": ["https://x.com/whalehubdefi",
                               "https://github.com/WhaleHubDev"]},
         "publisher": {"@id": f"{SITE}/#organization"},
         "mainEntityOfPage": {"@type": "WebPage", "@id": url}},
        {"@type": "FAQPage", "@id": url + "#faq", "mainEntity": faq_items},
        {"@type": "BreadcrumbList", "@id": url + "#breadcrumb", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{SITE}/"},
            {"@type": "ListItem", "position": 2, "name": "Blog", "item": f"{SITE}/blog/"},
            {"@type": "ListItem", "position": 3, "name": title, "item": url}]},
    ]}, indent=2)

    faq_html = "\n      ".join(
        f"<details><summary>{q}</summary><p>{a}</p></details>"
        for q, a in spec["faqs"])

    related_html = "\n        ".join(
        f'<a href="{s}"><img src="../assets/blog/{s}.png" alt="" /><span>{lbl}</span></a>'
        for s, lbl in spec["related"])

    head = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{title} | WhaleHub</title>
<meta name="description" content="{desc}" />
<link rel="canonical" href="{url}" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<meta name="author" content="WhaleHub Research" />
<meta name="keywords" content="{spec['keywords']}" />

<meta property="og:type" content="article" />
<meta property="og:site_name" content="WhaleHub" />
<meta property="og:url" content="{url}" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{desc}" />
<meta property="og:image" content="{img}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="article:published_time" content="{date}" />
<meta property="article:modified_time" content="{date}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@whalehubdefi" />
<meta name="twitter:title" content="{title}" />
<meta name="twitter:description" content="{desc}" />
<meta name="twitter:image" content="{img}" />

<link rel="icon" type="image/webp" href="../assets/logo-icon.webp" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="../styles.css" />
<link rel="stylesheet" href="blog.css" />

<script type="application/ld+json">
{ld}
</script>
</head>
<body>

'''

    article = f'''<article class="article">
  <div class="article-head">
    <div class="content">
      <div class="breadcrumb"><a href="./">Blog</a> &nbsp;/&nbsp; {spec["category"]}</div>
      <span class="tag{spec.get("tag_class", "")}">{spec["category"]}</span>
      <h1>{title}</h1>
      <div class="article-meta">
        <span class="author"><img src="../assets/logo-icon.webp" alt="WhaleHub Research" /> WhaleHub Research</span>
        <span class="dot-sep"></span>
        <span>Last updated: September 2026</span>
        <span class="dot-sep"></span>
        <span>{spec["read"]} min read</span>
      </div>
    </div>
  </div>

  <div class="content">
    <figure class="cover-fig">
      <img src="../assets/blog/{slug}.png" alt="{spec['alt']}" width="1200" height="630" />
    </figure>

{spec["body"]}

    <section class="faq" id="faq">
      <h2>Frequently asked questions</h2>
      {faq_html}
    </section>

    <div class="author-box">
      <img src="../assets/logo-icon.webp" alt="WhaleHub Research" />
      <div>
        <div class="n">WhaleHub Research</div>
        <div class="r">Protocol research &amp; education · WhaleHub</div>
        <p>WhaleHub is a yield-optimization protocol on Stellar. We stake AQUA, aggregate ICE voting power, and auto-compound Aquarius rewards for stakers. This series explains the Stellar DeFi stack — and the wider market around it — in plain English.</p>
      </div>
    </div>

    <section class="related">
      <h2>Read more</h2>
      <div class="related-grid">
        {related_html}
      </div>
    </section>

    <div class="end-cta">
      <h2>{spec["cta_h"]}</h2>
      <p>{spec["cta_p"]}</p>
      <a href="https://app.whalehub.io/" class="btn btn-primary">Launch the app</a>
    </div>

    <p class="disclaimer">{spec["disclaimer"]}</p>
  </div>
</article>
'''

    open(os.path.join(HERE, f"{slug}.html"), "w").write(head + nav + "\n\n" + article + "\n\n" + foot)

    # --- blog index card, newest first ---
    s = open(INDEX).read()
    if f'href="{slug}"' not in s:
        anchor = '    <a class="card" href='
        i = s.index(anchor)
        card = f'''    <a class="card" href="{slug}">
      <img src="../assets/blog/{slug}.png" alt="{title}" width="1200" height="630" loading="lazy" />
      <div class="card-body">
        <span class="tag{spec.get("tag_class", "")}">{spec["category"]}</span>
        <h2>{spec["card_title"]}</h2>
        <p>{spec["card_blurb"]}</p>
        <span class="meta">{spec["read"]} min read · September 2026</span>
        <span class="readmore">Read article →</span>
      </div>
    </a>

'''
        open(INDEX, "w").write(s[:i] + card + s[i:])

    # --- sitemap ---
    sm = open(SITEMAP).read()
    if slug not in sm:
        a = "  <url><loc>https://whalehub.io/blog/"
        i = sm.index(a)
        entry = (f'  <url><loc>{url}</loc><lastmod>{date}</lastmod>'
                 f'<changefreq>monthly</changefreq><priority>0.8</priority></url>\n')
        open(SITEMAP, "w").write(sm[:i] + entry + sm[i:])

    # --- inbound internal links from existing posts ---
    added = 0
    for target in spec.get("inbound", []):
        p = os.path.join(HERE, f"{target}.html")
        if not os.path.exists(p):
            continue
        t = open(p).read()
        if f'href="{slug}"' in t:
            continue
        marker = '<div class="related-grid">'
        if marker not in t:
            continue
        j = t.index(marker) + len(marker)
        link = (f'\n        <a href="{slug}"><img src="../assets/blog/{slug}.png" '
                f'alt="" /><span>{spec["card_title"]}</span></a>')
        open(p, "w").write(t[:j] + link + t[j:])
        added += 1

    return added
