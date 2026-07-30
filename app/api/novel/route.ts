// app/api/novel/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const CHAPTERS_PER_PAGE = 100;
const NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE = 2;

// ─── Supabase (service role — no RLS restrictions for cache table) ────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Cache TTL logic ──────────────────────────────────────────────────────────
// Page 1       → 1 hour  (metadata + totalPages changes with new releases)
// Last page    → 1 hour  (new chapters always append here)
// Middle pages → 24 hours (chapters here never change)
function getTTLMinutes(page: number, totalPages: number): number {
  if (page === 1 || page === totalPages) return 60;
  return 24 * 60;
}

function isStale(cachedAt: string, ttlMinutes: number): boolean {
  const age = (Date.now() - new Date(cachedAt).getTime()) / 60000;
  return age > ttlMinutes;
}

// ─── Cache read ───────────────────────────────────────────────────────────────
async function getCached(sourceUrl: string, page: number): Promise<{
  payload: Record<string, unknown>;
  total_pages: number;
  cached_at: string;
} | null> {
  try {
    const { data } = await supabase
      .from("novel_page_cache")
      .select("payload, total_pages, cached_at")
      .eq("source_url", sourceUrl)
      .eq("page", page)
      .single();
    return data ?? null;
  } catch {
    return null;
  }
}

// ─── Cache write (non-blocking, fire-and-forget) ──────────────────────────────
async function setCache(
  sourceUrl: string,
  page: number,
  totalPages: number,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("novel_page_cache").upsert(
      { source_url: sourceUrl, page, total_pages: totalPages, payload, cached_at: new Date().toISOString() },
      { onConflict: "source_url,page" }
    );
  } catch { /* silent — cache write failure is non-fatal */ }
}

// ─── Fetch with Cloudflare bypass ─────────────────────────────────────────────
// Try direct first. Only burn ScraperAPI credits when Cloudflare actually blocks.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function isCloudflareBlock(html: string): boolean {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("cf_chl_") ||
    html.includes("challenge-platform") ||
    html.includes("Enable JavaScript and cookies to continue") ||
    html.includes("DDoS protection by Cloudflare")
  );
}

async function fetchHtml(url: string): Promise<string> {
  // 1. Try direct
  const directRes = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await directRes.text();
  if (!isCloudflareBlock(html)) return html;

  // 2. Blocked — try ScraperAPI if key is set
  const scraperKey = process.env.SCRAPER_API_KEY;
  if (scraperKey) {
    const apiUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}`;
    const scraperRes = await fetch(apiUrl, { headers: { "User-Agent": UA } });
    const scraperHtml = await scraperRes.text();
    if (!isCloudflareBlock(scraperHtml)) return scraperHtml;
  }

  throw new Error("CLOUDFLARE_BLOCK");
}

// ─── Image proxy helper ────────────────────────────────────────────────────────
function proxyImg(rawUrl: string, sourceBase: string, req: NextRequest): string {
  if (!rawUrl) return "";
  const absolute = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, sourceBase).href;
  const base = new URL(req.url).origin;
  return `${base}/api/image?url=${encodeURIComponent(absolute)}`;
}

// ─── NovelFull / AllNovelFull / NovLove / NovelBin ────────────────────────────

async function fetchNovelFullSourcePage(
  url: string,
  sourcePage: number
): Promise<{ html: string; sourceTotal: number }> {
  const pageUrl = sourcePage === 1 ? url : `${url}?page=${sourcePage}`;
  const html = await fetchHtml(pageUrl);

  const $ = cheerio.load(html);
  let sourceTotal = 1;
  $("ul.pagination a, .pagination a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/[?&]page=(\d+)/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > sourceTotal) sourceTotal = n;
    }
  });

  return { html, sourceTotal };
}

async function parseNovelFullStyle(url: string, page: number, req: NextRequest) {
  const sourceBase = new URL(url).origin;

  const firstSourcePage = (page - 1) * NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE + 1;
  const secondSourcePage = firstSourcePage + 1;

  const { html: html1, sourceTotal } = await fetchNovelFullSourcePage(url, firstSourcePage);
  const $1 = cheerio.load(html1);

  const cleanTitle = (t: string) =>
    t.replace(/\s*[\|\-–]\s*.*/g, "")
     .replace(/\s*(novel\s*)?(online\s*)?(free\s*)?$/i, "")
     .trim();
  const titleFromOg = $1('meta[property="og:title"]').attr("content")?.trim() || "";
  const titleFromH3 = $1(".col-info-desc h3.title, .info h3.title").first().text().trim();
  const title = cleanTitle(titleFromOg) || cleanTitle(titleFromH3) || cleanTitle($1("title").text());
  const author = $1(".info-meta li:contains('Author') a, [itemprop='author'], .author a").first().text().trim();
  const coverRaw = $1(".col-book img, .book img, .info-cover img, img[itemprop='image']").first().attr("src") || "";
  const cover_url = proxyImg(coverRaw, sourceBase, req);
  const synopsis = $1(".desc-text, .synopsis p, .description, .book-intro").first().text().trim();
  const totalPages = Math.ceil(sourceTotal / NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE);

  function isPaginationNoise(text: string): boolean {
    const t = text.trim();
    if (/^\d+$/.test(t)) return true;
    if (/[»«><]/.test(t)) return true;
    if (/^(last|first|next|prev(ious)?|select\s*page)$/i.test(t)) return true;
    if (t.length <= 2) return true;
    return false;
  }

  function extractChapters($: cheerio.CheerioAPI, offset: number, baseUrl: string) {
    const result: { number: number; title: string; url: string }[] = [];
    $("ul.list-chapter li a, .list-chapter li a, #list-chapter li a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const chTitle = $(el).text().trim();
      if (!href || !chTitle || isPaginationNoise(chTitle)) return;
      result.push({ number: offset + result.length + 1, title: chTitle, url: new URL(href, baseUrl).href });
    });
    return result;
  }

  const offset1 = (page - 1) * CHAPTERS_PER_PAGE;
  const chaptersFromPage1 = extractChapters($1, offset1, url);

  let chaptersFromPage2: { number: number; title: string; url: string }[] = [];
  if (secondSourcePage <= sourceTotal) {
    const { html: html2 } = await fetchNovelFullSourcePage(url, secondSourcePage);
    const $2 = cheerio.load(html2);
    chaptersFromPage2 = extractChapters($2, offset1 + chaptersFromPage1.length, url);
  }

  return { title, author, cover_url, synopsis, totalPages, currentPage: page, chapters: [...chaptersFromPage1, ...chaptersFromPage2] };
}

// ─── NovelCool ────────────────────────────────────────────────────────────────

async function parseNovelCool(url: string, page: number, req: NextRequest) {
  const sourceBase = new URL(url).origin;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const titleRaw = $('meta[property="og:title"]').attr("content") || $("h1.book-name, .bookinfo h1, h1").first().text();
  const title = titleRaw?.split(/[|\-–]/)[0].trim() || "";
  const author = $(".author a, [itemprop='author']").first().text().trim();
  const coverRaw = $(".book-img img, .cover img").first().attr("src") || "";
  const cover_url = proxyImg(coverRaw, sourceBase, req);
  const synopsis = $(".book-desc, .description, .synopsis").first().text().trim();

  const allChapters: { number: number; title: string; url: string }[] = [];
  $(".chapter-item a, .chp-item a").each((i, el) => {
    const href = $(el).attr("href");
    const chTitle = $(el).text().trim();
    if (href && chTitle && chTitle.length > 2)
      allChapters.push({ number: i + 1, title: chTitle, url: new URL(href, url).href });
  });

  const totalPages = Math.max(1, Math.ceil(allChapters.length / CHAPTERS_PER_PAGE));
  const start = (page - 1) * CHAPTERS_PER_PAGE;
  return { title, author, cover_url, synopsis, totalPages, currentPage: page, chapters: allChapters.slice(start, start + CHAPTERS_PER_PAGE) };
}

// ─── NovelHall ────────────────────────────────────────────────────────────────

async function parseNovelHall(url: string, page: number, req: NextRequest) {
  const sourceBase = new URL(url).origin;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const titleRaw = $('meta[property="og:title"]').attr("content") || $("h1.section-title, h1").first().text();
  const title = titleRaw?.split(/[|\-–]/)[0].trim() || "";
  const author = $(".author a, [itemprop='author'], .book-meta a").first().text().trim();
  const coverRaw = $(".book-img img, .cover img, img.lazy").first().attr("data-src")
    || $(".book-img img, .cover img").first().attr("src") || "";
  const cover_url = proxyImg(coverRaw, sourceBase, req);
  const synopsis = $(".book-intro, .description, .syn").first().text().trim();

  const allChapters: { number: number; title: string; url: string }[] = [];
  $(".chapter-list li a, #chapterList li a, .volume-item li a").each((i, el) => {
    const href = $(el).attr("href");
    const chTitle = $(el).text().trim();
    if (href && chTitle && chTitle.length > 2)
      allChapters.push({ number: i + 1, title: chTitle, url: new URL(href, url).href });
  });

  const totalPages = Math.max(1, Math.ceil(allChapters.length / CHAPTERS_PER_PAGE));
  const start = (page - 1) * CHAPTERS_PER_PAGE;
  return { title, author, cover_url, synopsis, totalPages, currentPage: page, chapters: allChapters.slice(start, start + CHAPTERS_PER_PAGE) };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const novelUrl = searchParams.get("url");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const nocache = searchParams.get("nocache") === "1";

  if (!novelUrl) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    // ── 1. Check cache ──────────────────────────────────────────────────────
    if (!nocache) {
      const cached = await getCached(novelUrl, page);
      if (cached) {
        const ttl = getTTLMinutes(page, cached.total_pages);
        if (!isStale(cached.cached_at, ttl)) {
          return NextResponse.json({ ...cached.payload, cached: true });
        }
      }
    }

    // ── 2. Cache miss / stale — scrape ─────────────────────────────────────
    const hostname = new URL(novelUrl).hostname;
    let result;

    if (hostname.includes("novelcool.com")) {
      result = await parseNovelCool(novelUrl, page, request);
    } else if (hostname.includes("novelhall.com")) {
      result = await parseNovelHall(novelUrl, page, request);
    } else {
      result = await parseNovelFullStyle(novelUrl, page, request);
    }

    let source = "Unknown";
    if (hostname.includes("novelfull")) source = "NovelFull";
    else if (hostname.includes("allnovelfull")) source = "AllNovelFull";
    else if (hostname.includes("novelbin")) source = "NovelBin";
    else if (hostname.includes("novelcool")) source = "NovelCool";
    else if (hostname.includes("novelhall")) source = "NovelHall";
    else if (hostname.includes("novlove")) source = "NovLove";

    const payload = { ...result, source };

    // ── 3. Write to cache (fire-and-forget) ─────────────────────────────────
    setCache(novelUrl, page, result.totalPages, payload);

    return NextResponse.json(payload);

  } catch (error) {
    console.error("Novel fetch error:", error);
    const msg = error instanceof Error ? error.message : "";

    if (msg === "CLOUDFLARE_BLOCK") {
      // Serve stale cache if available — better than an error
      const stale = await getCached(novelUrl, page);
      if (stale) {
        return NextResponse.json({ ...stale.payload, cached: true, stale: true });
      }
      return NextResponse.json({
        error: "CLOUDFLARE_BLOCK",
        message: "This source is temporarily blocked. Please try again in a few minutes.",
      }, { status: 503 });
    }

    return NextResponse.json({ error: "Failed to fetch novel data" }, { status: 500 });
  }
}