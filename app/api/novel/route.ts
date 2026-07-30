// app/api/novel/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const CHAPTERS_PER_PAGE = 100;
const LNP_CHAPTERS_PER_PAGE = 40; // LightNovelPub shows 40 chapters per their page

// ─── Supabase cache ───────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getTTLMinutes(page: number, totalPages: number) {
  return page === 1 || page === totalPages ? 60 : 24 * 60;
}
function isStale(cachedAt: string, ttl: number) {
  return (Date.now() - new Date(cachedAt).getTime()) / 60000 > ttl;
}
async function getCached(sourceUrl: string, page: number) {
  try {
    const { data } = await supabase
      .from("novel_page_cache")
      .select("payload, total_pages, cached_at")
      .eq("source_url", sourceUrl).eq("page", page).single();
    return data ?? null;
  } catch { return null; }
}
async function setCache(sourceUrl: string, page: number, totalPages: number, payload: Record<string, unknown>) {
  try {
    await supabase.from("novel_page_cache").upsert(
      { source_url: sourceUrl, page, total_pages: totalPages, payload, cached_at: new Date().toISOString() },
      { onConflict: "source_url,page" }
    );
  } catch { /* silent */ }
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function isCloudflareBlock(html: string) {
  return html.includes("Just a moment") || html.includes("cf-browser-verification") ||
    html.includes("challenge-platform") || html.includes("Enable JavaScript and cookies to continue");
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();
  if (!isCloudflareBlock(html)) return html;
  const scraperKey = process.env.SCRAPER_API_KEY;
  if (scraperKey) {
    const r = await fetch(`http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA } });
    const h = await r.text();
    if (!isCloudflareBlock(h)) return h;
  }
  throw new Error("CLOUDFLARE_BLOCK");
}

function proxyImg(rawUrl: string, sourceBase: string, req: NextRequest): string {
  if (!rawUrl) return "";
  const absolute = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, sourceBase).href;
  return `${new URL(req.url).origin}/api/image?url=${encodeURIComponent(absolute)}`;
}

// ─── LightNovelPub ────────────────────────────────────────────────────────────

async function parseLightNovelPub(url: string, page: number) {
  const base = "https://lightnovelpub.me";

  // ── Fetch page 1 to get metadata + total pages ──────────────────────────────
  const html1 = await fetchHtml(url);
  const $1 = cheerio.load(html1);

  // Metadata from og:novel tags (very clean)
  const title = ($1('meta[property="og:novel:novel_name"]').attr("content") ||
    $1('meta[property="og:title"]').attr("content") || $1("h1").first().text())
    .split(/[|\-–]/)[0].trim();
  const author = $1('meta[property="og:novel:author"]').attr("content")?.trim() || "";
  const status = $1('meta[property="og:novel:status"]').attr("content")?.trim() || "";
  const genres = ($1('meta[property="og:novel:genre"]').attr("content") || "")
    .split(",").map(g => g.trim()).filter(Boolean);

  // Cover image — absolute URL from media.lightnovelpub.me, no proxy needed
  const cover_url = $1('meta[property="og:image"]').attr("content") ||
    $1(".novel-cover img, .book-img img, .thumb img").first().attr("src") || "";

  // Synopsis
  const synopsis = $1(".summary, .description, .novel-summary, .book-desc")
    .first().text().trim() ||
    $1('meta[property="og:description"]').attr("content")?.trim() || "";

  // Total LNP pages from "Last" pagination link
  let totalLNPPages = 1;
  $1("a").each((_, el) => {
    const href = $1(el).attr("href") || "";
    const text = $1(el).text().trim().toLowerCase();
    if (text === "last") {
      const match = href.match(/\/(\d+)$/);
      if (match) totalLNPPages = Math.max(totalLNPPages, parseInt(match[1], 10));
    }
  });
  // Also check numbered pagination links
  $1(".pagination a, ul.pagination a").each((_, el) => {
    const href = $1(el).attr("href") || "";
    const match = href.match(/\/(\d+)$/);
    if (match) totalLNPPages = Math.max(totalLNPPages, parseInt(match[1], 10));
  });

  const ourTotalPages = Math.max(1, Math.ceil((totalLNPPages * LNP_CHAPTERS_PER_PAGE) / CHAPTERS_PER_PAGE));

  // ── Determine which LNP pages to fetch for our page N ───────────────────────
  // Our page N = chapters (N-1)*100+1 to N*100
  // LNP page for chapter C = ceil(C / 40)
  const startCh = (page - 1) * CHAPTERS_PER_PAGE + 1;
  const endCh = page * CHAPTERS_PER_PAGE;
  const startLNP = Math.ceil(startCh / LNP_CHAPTERS_PER_PAGE);
  const endLNP = Math.min(Math.ceil(endCh / LNP_CHAPTERS_PER_PAGE), totalLNPPages);

  // Collect all chapters from the needed LNP pages
  function extractChapters($: cheerio.CheerioAPI, lnpPageNum: number): { number: number; title: string; url: string }[] {
    const result: { number: number; title: string; url: string }[] = [];
    const offset = (lnpPageNum - 1) * LNP_CHAPTERS_PER_PAGE;
    $(".chapter-list li a, #chapter-list li a, .chapters li a, ul.list-chapter li a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const chTitle = $(el).text().trim();
      if (!href || !chTitle || chTitle.length <= 1) return;
      const fullUrl = href.startsWith("http") ? href : new URL(href, base).href;
      result.push({
        number: offset + result.length + 1,
        title: chTitle,
        url: fullUrl,
      });
    });
    return result;
  }

  let allChapters: { number: number; title: string; url: string }[] = [];

  if (startLNP === 1) {
    // Already fetched page 1
    allChapters = extractChapters($1, 1);
    // Fetch remaining pages in parallel
    if (endLNP > 1) {
      const pageNums = Array.from({ length: endLNP - 1 }, (_, i) => i + 2);
      const htmls = await Promise.all(pageNums.map(p => fetchHtml(`${url}/${p}`)));
      for (let i = 0; i < htmls.length; i++) {
        const $p = cheerio.load(htmls[i]);
        allChapters = [...allChapters, ...extractChapters($p, pageNums[i])];
      }
    }
  } else {
    // Fetch all needed pages in parallel (startLNP to endLNP)
    const pageNums = Array.from({ length: endLNP - startLNP + 1 }, (_, i) => startLNP + i);
    const htmls = await Promise.all(pageNums.map(p =>
      p === 1 ? Promise.resolve(html1) : fetchHtml(`${url}/${p}`)
    ));
    for (let i = 0; i < htmls.length; i++) {
      const $p = cheerio.load(htmls[i]);
      allChapters = [...allChapters, ...extractChapters($p, pageNums[i])];
    }
  }

  // Slice to our 100-chapter window
  const sliceStart = startCh - (startLNP - 1) * LNP_CHAPTERS_PER_PAGE - 1;
  const chapters = allChapters.slice(sliceStart, sliceStart + CHAPTERS_PER_PAGE);

  return {
    title,
    author,
    cover_url,
    synopsis,
    status,
    genres,
    totalPages: ourTotalPages,
    currentPage: page,
    chapters,
  };
}

// ─── NovelFull / AllNovelFull / NovLove / NovelBin ───────────────────────────
const NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE = 2;

async function fetchNovelFullSourcePage(url: string, sourcePage: number) {
  const pageUrl = sourcePage === 1 ? url : `${url}?page=${sourcePage}`;
  const html = await fetchHtml(pageUrl);
  const $ = cheerio.load(html);
  let sourceTotal = 1;
  $("ul.pagination a, .pagination a").each((_, el) => {
    const match = ($(el).attr("href") || "").match(/[?&]page=(\d+)/);
    if (match) sourceTotal = Math.max(sourceTotal, parseInt(match[1], 10));
  });
  return { html, sourceTotal };
}

async function parseNovelFullStyle(url: string, page: number, req: NextRequest) {
  const sourceBase = new URL(url).origin;
  const firstSP = (page - 1) * NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE + 1;
  const secondSP = firstSP + 1;

  const { html: html1, sourceTotal } = await fetchNovelFullSourcePage(url, firstSP);
  const $1 = cheerio.load(html1);

  const cleanTitle = (t: string) => t.replace(/\s*[\|\-–]\s*.*/g, "").replace(/\s*(novel\s*)?(online\s*)?(free\s*)?$/i, "").trim();
  const title = cleanTitle($1('meta[property="og:title"]').attr("content")?.trim() || "") ||
    cleanTitle($1(".col-info-desc h3.title, .info h3.title").first().text().trim()) ||
    cleanTitle($1("title").text());
  const author = $1(".info-meta li:contains('Author') a, [itemprop='author'], .author a").first().text().trim();
  const coverRaw = $1(".col-book img, .book img, .info-cover img, img[itemprop='image']").first().attr("src") || "";
  const cover_url = proxyImg(coverRaw, sourceBase, req);
  const synopsis = $1(".desc-text, .synopsis p, .description, .book-intro").first().text().trim();
  const totalPages = Math.ceil(sourceTotal / NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE);

  function isPaginationNoise(text: string) {
    const t = text.trim();
    return /^\d+$/.test(t) || /[»«><]/.test(t) || /^(last|first|next|prev(ious)?|select\s*page)$/i.test(t) || t.length <= 2;
  }
  function extractChapters($: cheerio.CheerioAPI, offset: number) {
    const result: { number: number; title: string; url: string }[] = [];
    $("ul.list-chapter li a, .list-chapter li a, #list-chapter li a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const chTitle = $(el).text().trim();
      if (!href || !chTitle || isPaginationNoise(chTitle)) return;
      result.push({ number: offset + result.length + 1, title: chTitle, url: new URL(href, url).href });
    });
    return result;
  }

  const offset1 = (page - 1) * CHAPTERS_PER_PAGE;
  const ch1 = extractChapters($1, offset1);
  let ch2: typeof ch1 = [];
  if (secondSP <= sourceTotal) {
    const { html: html2 } = await fetchNovelFullSourcePage(url, secondSP);
    ch2 = extractChapters(cheerio.load(html2), offset1 + ch1.length);
  }
  return { title, author, cover_url, synopsis, totalPages, currentPage: page, chapters: [...ch1, ...ch2] };
}

async function parseNovelCool(url: string, page: number, req: NextRequest) {
  const sourceBase = new URL(url).origin;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr("content") || $("h1.book-name, h1").first().text()).split(/[|\-–]/)[0].trim();
  const author = $(".author a, [itemprop='author']").first().text().trim();
  const cover_url = proxyImg($(".book-img img, .cover img").first().attr("src") || "", sourceBase, req);
  const synopsis = $(".book-desc, .description, .synopsis").first().text().trim();
  const allChapters: { number: number; title: string; url: string }[] = [];
  $(".chapter-item a, .chp-item a").each((i, el) => {
    const href = $(el).attr("href"); const t = $(el).text().trim();
    if (href && t && t.length > 2) allChapters.push({ number: i + 1, title: t, url: new URL(href, url).href });
  });
  const totalPages = Math.max(1, Math.ceil(allChapters.length / CHAPTERS_PER_PAGE));
  const start = (page - 1) * CHAPTERS_PER_PAGE;
  return { title, author, cover_url, synopsis, totalPages, currentPage: page, chapters: allChapters.slice(start, start + CHAPTERS_PER_PAGE) };
}

async function parseNovelHall(url: string, page: number, req: NextRequest) {
  const sourceBase = new URL(url).origin;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr("content") || $("h1.section-title, h1").first().text()).split(/[|\-–]/)[0].trim();
  const author = $(".author a, [itemprop='author'], .book-meta a").first().text().trim();
  const coverRaw = $(".book-img img, .cover img, img.lazy").first().attr("data-src") || $(".book-img img").first().attr("src") || "";
  const cover_url = proxyImg(coverRaw, sourceBase, req);
  const synopsis = $(".book-intro, .description, .syn").first().text().trim();
  const allChapters: { number: number; title: string; url: string }[] = [];
  $(".chapter-list li a, #chapterList li a, .volume-item li a").each((i, el) => {
    const href = $(el).attr("href"); const t = $(el).text().trim();
    if (href && t && t.length > 2) allChapters.push({ number: i + 1, title: t, url: new URL(href, url).href });
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

  if (!novelUrl) return NextResponse.json({ error: "URL is required" }, { status: 400 });

  try {
    // ── Cache check ────────────────────────────────────────────────────────────
    if (!nocache) {
      const cached = await getCached(novelUrl, page);
      if (cached && !isStale(cached.cached_at, getTTLMinutes(page, cached.total_pages))) {
        return NextResponse.json({ ...cached.payload, cached: true });
      }
    }

    // ── Scrape ────────────────────────────────────────────────────────────────
    const hostname = new URL(novelUrl).hostname;
    let result;

    if (hostname.includes("lightnovelpub")) {
      result = await parseLightNovelPub(novelUrl, page);
    } else if (hostname.includes("novelcool.com")) {
      result = await parseNovelCool(novelUrl, page, request);
    } else if (hostname.includes("novelhall.com")) {
      result = await parseNovelHall(novelUrl, page, request);
    } else {
      result = await parseNovelFullStyle(novelUrl, page, request);
    }

    let source = "Unknown";
    if (hostname.includes("lightnovelpub")) source = "LightNovelPub";
    else if (hostname.includes("novelfull")) source = "NovelFull";
    else if (hostname.includes("allnovelfull")) source = "AllNovelFull";
    else if (hostname.includes("novelbin")) source = "NovelBin";
    else if (hostname.includes("novelcool")) source = "NovelCool";
    else if (hostname.includes("novelhall")) source = "NovelHall";
    else if (hostname.includes("novlove")) source = "NovLove";

    const payload = { ...result, source };
    setCache(novelUrl, page, result.totalPages, payload); // fire-and-forget
    return NextResponse.json(payload);

  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg === "CLOUDFLARE_BLOCK") {
      const stale = await getCached(novelUrl, page);
      if (stale) return NextResponse.json({ ...stale.payload, cached: true, stale: true });
      return NextResponse.json({ error: "CLOUDFLARE_BLOCK", message: "Source temporarily blocked. Try again in a few minutes." }, { status: 503 });
    }
    console.error("Novel fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch novel data" }, { status: 500 });
  }
}