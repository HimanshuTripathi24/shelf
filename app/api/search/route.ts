// app/api/search/route.ts
//
// FIX: this file previously contained a verbatim copy of app/api/image/route.ts
// (the image proxy), so /api/search never actually searched anything — it's why
// the search page always came back empty. This is the real implementation.
//
// LightNovelPub (our primary/focus source) doesn't expose a server-rendered
// search endpoint — its /search page is a client-side (JS) app, so a plain
// fetch gets back an unrendered template with no results. Rather than silently
// dropping it, we approximate "search" for it by pulling its public listing
// pages (latest / most popular / completed) and filtering by title match.
// That's not a full-text search of its entire catalog, but it covers the
// active/popular novels people are actually looking for. The NovelFull-family
// sites below DO have a real server-rendered search (`?keyword=`), so those
// results are exhaustive.

import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

interface SearchResult {
  title: string;
  source_url: string;
  cover_url: string;
  source: string;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
      next: { revalidate: 60 },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// ─── LightNovelPub (primary/focus source) ──────────────────────────────────
async function searchLightNovelPub(query: string): Promise<SearchResult[]> {
  const listUrls = [
    "https://lightnovelpub.me/list/latest-novels/",
    "https://lightnovelpub.me/list/most-popular-novels/",
    "https://lightnovelpub.me/list/completed-novels/",
  ];

  const htmls = await Promise.all(listUrls.map(fetchHtml));
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const html of htmls) {
    if (!html) continue;
    const $ = cheerio.load(html);

    // Match by href pattern rather than guessing CSS class names — LightNovelPub's
    // markup uses /book/<slug> links consistently for novel titles.
    $('a[href*="/book/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr("href") || "";
      if (!href.includes("/book/") || href.includes("/chapter")) return;

      const title = ($a.attr("title") || $a.text()).trim();
      if (!title || !title.toLowerCase().includes(q)) return;

      const url = href.startsWith("http") ? href : `https://lightnovelpub.me${href}`;
      if (seen.has(url)) return;
      seen.add(url);

      const container = $a.closest("li, article, div").length
        ? $a.closest("li, article, div")
        : $a.parent();
      const img = container.find("img").first();
      const cover = img.attr("src") || img.attr("data-src") || "";

      results.push({
        title,
        source_url: url,
        cover_url: cover,
        source: "LightNovelPub",
      });
    });
  }

  return results;
}

// ─── NovelFull-family (share the same CMS, have real server-side search) ──
const NOVELFULL_FAMILY: { name: string; base: string }[] = [
  { name: "NovelFull", base: "https://novelfull.net" },
  { name: "AllNovelFull", base: "https://allnovelfull.com" },
  { name: "NovelBin", base: "https://novelbin.com" },
  { name: "NovLove", base: "https://novlove.com" },
];

async function searchNovelFullFamily(
  name: string,
  base: string,
  query: string
): Promise<SearchResult[]> {
  const html = await fetchHtml(`${base}/search?keyword=${encodeURIComponent(query)}`);
  if (!html) return [];

  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $(".list-truyen .row").each((_, el) => {
    const titleEl = $(el).find("h3.truyen-title a");
    const title = titleEl.text().trim();
    const href = titleEl.attr("href") || "";
    if (!title || !href) return;

    const imgEl = $(el).find("img");
    const cover = imgEl.attr("data-src") || imgEl.attr("src") || "";

    results.push({
      title,
      source_url: href.startsWith("http") ? href : `${base}${href}`,
      cover_url: cover.startsWith("http") ? cover : `${base}${cover}`,
      source: name,
    });
  });

  return results;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [], query: "", total: 0 });
  }

  try {
    const [lnpResults, ...familyResults] = await Promise.all([
      searchLightNovelPub(q),
      ...NOVELFULL_FAMILY.map((s) => searchNovelFullFamily(s.name, s.base, q)),
    ]);

    // LightNovelPub first — it's the site's primary/focus source.
    const results = [...lnpResults, ...familyResults.flat()];

    return NextResponse.json({ results, query: q, total: results.length });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed", results: [], query: q, total: 0 },
      { status: 500 }
    );
  }
}