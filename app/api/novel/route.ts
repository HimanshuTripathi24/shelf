// app/api/novel/route.ts
//
// Novel chapter-list scraper with Supabase caching + layered Cloudflare bypass.
//
// ── Cloudflare bypass strategy (cheapest / fastest first) ─────────────────────
//   1. Direct fetch with a full, realistic browser header set, reusing any
//      saved clearance cookie for the domain (persisted in Supabase, since a
//      serverless function has no memory between invocations).
//   2. One retry after a short jittered delay — covers transient rate-limit
//      style challenges that don't need a full JS solve.
//   3. FlareSolverr (free, self-hosted) — a small local/Docker service that
//      drives a real headless Chrome to solve the JS challenge and hands
//      back solved cookies + the exact User-Agent it used.
//   4. ScraperAPI (paid) with JS rendering enabled — last resort.
//
// IMPORTANT: a Cloudflare clearance cookie is only valid when replayed with
// the *same* User-Agent that obtained it. Every earlier version of this kind
// of scraper that stored the cookie but kept using its own hardcoded UA will
// get challenged again on the very next request. This version stores the
// cookie and UA together and replays both.
//
// No combination of headers alone can defeat a real Cloudflare "Managed
// Challenge" / Turnstile — that fundamentally requires a JS-capable browser.
// Steps 1–2 handle the softer, much more common cases (IP/rate-limit
// challenges); steps 3–4 exist for when the site throws a real JS challenge.

import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

// Force the Node runtime — we need full control over fetch/headers/timeouts
// and AbortController behavior that the Edge runtime doesn't guarantee.
export const runtime = "nodejs";

const CHAPTERS_PER_PAGE = 100;
const NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE = 2;
const FETCH_TIMEOUT_MS = 20_000;
const FLARESOLVERR_TIMEOUT_MS = 65_000;
const SCRAPERAPI_TIMEOUT_MS = 45_000;
const SAVED_SESSION_MAX_AGE_MINUTES = 360; // conservative reuse window for a stored clearance cookie

// ─── Supabase (service role — no RLS restrictions for cache tables) ───────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ════════════════════════════════════════════════════════════════════════════
// Cache TTL logic (unchanged)
// ════════════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════════════
// Page cache read / write (unchanged — table: novel_page_cache)
// ════════════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════════════
// NEW: Session jar — persists a (cookie, User-Agent) pair per domain, so once
// a challenge is solved (FlareSolverr / ScraperAPI below), plain direct
// fetches can reuse it instead of paying the bypass cost on every request.
// Requires a `novel_site_cookies` table — see SQL provided alongside this file.
// ════════════════════════════════════════════════════════════════════════════
type SavedSession = { cookie: string; userAgent: string };

async function getSavedSession(domain: string): Promise<SavedSession | null> {
  try {
    const { data } = await supabase
      .from("novel_site_cookies")
      .select("cookie, user_agent, updated_at")
      .eq("domain", domain)
      .single();
    if (!data?.cookie) return null;
    const ageMinutes = (Date.now() - new Date(data.updated_at).getTime()) / 60000;
    if (ageMinutes > SAVED_SESSION_MAX_AGE_MINUTES) return null;
    return { cookie: data.cookie, userAgent: data.user_agent || UA };
  } catch {
    return null;
  }
}

async function saveSession(domain: string, cookie: string, userAgent?: string): Promise<void> {
  if (!cookie) return;
  try {
    await supabase.from("novel_site_cookies").upsert(
      { domain, cookie, user_agent: userAgent || UA, updated_at: new Date().toISOString() },
      { onConflict: "domain" }
    );
  } catch { /* silent */ }
}

// Merge Set-Cookie response header(s) into a single "name=value; ..." string.
// Newer Node/undici exposes headers.getSetCookie() for multiple cookies;
// older runtimes only expose a single (possibly joined) string via .get().
function extractSetCookies(res: Response): string | null {
  const headersAny = res.headers as unknown as { getSetCookie?: () => string[] };
  const raw: string[] =
    typeof headersAny.getSetCookie === "function"
      ? headersAny.getSetCookie()
      : (() => {
          const single = res.headers.get("set-cookie");
          return single ? [single] : [];
        })();
  if (!raw.length) return null;
  const pairs = raw.map((c) => c.split(";")[0].trim()).filter(Boolean);
  return pairs.length ? pairs.join("; ") : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Fetch with layered Cloudflare bypass
// ════════════════════════════════════════════════════════════════════════════
const CHROME_VERSION = "151"; // current stable Chrome as of this writing — keep roughly current
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

function browserHeaders(opts: { cookie?: string | null; referer?: string; userAgent?: string }): Record<string, string> {
  const usingDefaultUA = !opts.userAgent || opts.userAgent === UA;
  const headers: Record<string, string> = {
    "User-Agent": opts.userAgent || UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": opts.referer ? "same-origin" : "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
  // Only send sec-ch-ua hints when we know they match the UA we're sending —
  // a mismatched UA/sec-ch-ua pair (e.g. our default hints next to a
  // FlareSolverr-provided UA of a different Chrome build) is itself a
  // fingerprinting red flag, so we omit them rather than guess.
  if (usingDefaultUA) {
    headers["Sec-Ch-Ua"] = `"Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}", "Not.A/Brand";v="24"`;
    headers["Sec-Ch-Ua-Mobile"] = "?0";
    headers["Sec-Ch-Ua-Platform"] = `"Windows"`;
  }
  if (opts.referer) headers["Referer"] = opts.referer;
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isCloudflareBlockBody(html: string): boolean {
  return (
    html.includes("Just a moment") ||
    html.includes("cf-browser-verification") ||
    html.includes("cf_chl_") ||
    html.includes("challenge-platform") ||
    html.includes("Enable JavaScript and cookies to continue") ||
    html.includes("DDoS protection by Cloudflare") ||
    html.includes("Attention Required! | Cloudflare") ||
    html.includes("cf-error-details") ||
    html.includes("__cf_chl_rt_tk")
  );
}

function isBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) {
    // Confirm via body signature when we can, so a genuine origin error
    // (some sites do legitimately return 503) isn't mistaken for a block.
    if (isCloudflareBlockBody(html)) return true;
    if (html.trim().length < 200) return true; // near-empty error body from a proxy layer
    return false;
  }
  return isCloudflareBlockBody(html);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Layer 1: direct fetch, reusing any saved (cookie, UA) pair for the domain.
async function tryDirect(url: string, domain: string, referer?: string): Promise<string | null> {
  try {
    const session = await getSavedSession(domain);
    const res = await fetchWithTimeout(
      url,
      { headers: browserHeaders({ cookie: session?.cookie, referer, userAgent: session?.userAgent }) },
      FETCH_TIMEOUT_MS
    );
    const html = await res.text();

    const setCookie = extractSetCookies(res);
    if (setCookie) await saveSession(domain, setCookie, session?.userAgent);

    if (!isBlocked(res.status, html)) return html;
    return null;
  } catch {
    return null;
  }
}

// Layer 2: FlareSolverr — free, self-hosted headless-Chrome solver.
// Set FLARESOLVERR_URL (e.g. http://your-host:8191/v1) to enable.
async function tryFlareSolverr(url: string, domain: string): Promise<string | null> {
  const flareUrl = process.env.FLARESOLVERR_URL;
  if (!flareUrl) return null;
  try {
    const res = await fetchWithTimeout(
      flareUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60_000 }),
      },
      FLARESOLVERR_TIMEOUT_MS
    );
    const data = await res.json();
    if (data?.status !== "ok" || !data.solution) return null;

    const html: string | undefined = data.solution.response;
    const cookies: Array<{ name: string; value: string }> | undefined = data.solution.cookies;
    const solvedUA: string | undefined = data.solution.userAgent;

    if (cookies?.length) {
      const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      // Must be paired with FlareSolverr's own UA on future requests, or
      // Cloudflare will re-challenge the very next direct fetch.
      await saveSession(domain, cookieStr, solvedUA);
    }
    if (html && !isCloudflareBlockBody(html)) return html;
    return null;
  } catch {
    return null;
  }
}

// Layer 3: ScraperAPI (paid) — last resort, with JS rendering enabled so it
// can clear a real challenge page rather than just proxying the block page.
// render=true is on by default (needed to solve JS challenges); premium
// (residential proxies) is off by default since it costs far more credits —
// opt in with SCRAPER_API_PREMIUM=true if render alone isn't enough.
async function tryScraperApi(url: string): Promise<string | null> {
  const key = process.env.SCRAPER_API_KEY;
  if (!key) return null;
  try {
    const render = process.env.SCRAPER_API_RENDER !== "false";
    const premium = process.env.SCRAPER_API_PREMIUM === "true";
    const params = new URLSearchParams({ api_key: key, url });
    if (render) params.set("render", "true");
    if (premium) params.set("premium", "true");
    const apiUrl = `http://api.scraperapi.com/?${params.toString()}`;

    const res = await fetchWithTimeout(apiUrl, {}, SCRAPERAPI_TIMEOUT_MS);
    const html = await res.text();
    if (!isBlocked(res.status, html)) return html;
    return null;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string, referer?: string): Promise<string> {
  const domain = new URL(url).hostname;

  // 1. Direct, with any session we've saved for this domain.
  let html = await tryDirect(url, domain, referer);
  if (html) return html;

  // 2. One retry after a short jittered delay — covers transient
  //    rate-limit style challenges that don't need a full JS solve.
  await sleep(700 + Math.random() * 500);
  html = await tryDirect(url, domain, referer);
  if (html) return html;

  // 3. FlareSolverr (free, self-hosted) — solves a real JS challenge.
  html = await tryFlareSolverr(url, domain);
  if (html) return html;

  // 4. ScraperAPI (paid) — only reached if neither of the above worked.
  html = await tryScraperApi(url);
  if (html) return html;

  throw new Error("CLOUDFLARE_BLOCK");
}

// ─── Image proxy helper (unchanged) ───────────────────────────────────────────
function proxyImg(rawUrl: string, sourceBase: string, req: NextRequest): string {
  if (!rawUrl) return "";
  const absolute = rawUrl.startsWith("http") ? rawUrl : new URL(rawUrl, sourceBase).href;
  const base = new URL(req.url).origin;
  return `${base}/api/image?url=${encodeURIComponent(absolute)}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Title cleanup
// ════════════════════════════════════════════════════════════════════════════
// NovelFull's <title> / og:title are formatted like:
//   "Read Martial Peak novel online free - NovelFull"
// Stripping "everything after the first dash" (the previous version's
// approach) leaves "Read Martial Peak" — wrong on every single book, since
// the boilerplate prefix ("Read ") is never removed. This strips both the
// leading and trailing boilerplate instead.
function cleanBoilerplateTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(/^read\s+/i, "");
  t = t.replace(/\s*[|\-–]\s*[^|\-–]*$/, ""); // trailing " - SiteName" / " | SiteName"
  t = t.replace(/\s*novel\s*online\s*free\s*$/i, "");
  t = t.replace(/\s*online\s*free\s*$/i, "");
  t = t.replace(/\s*(free\s*)?read(ing)?\s*online\s*$/i, "");
  return t.trim();
}

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

// ─── NovelFull / AllNovelFull / NovLove / NovelBin ────────────────────────────

async function fetchNovelFullSourcePage(
  url: string,
  sourcePage: number,
  referer?: string
): Promise<{ html: string; sourceTotal: number }> {
  const pageUrl = sourcePage === 1 ? url : `${url}?page=${sourcePage}`;
  const html = await fetchHtml(pageUrl, referer);

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

  // Title: prefer the on-page heading (no boilerplate to strip at all), fall
  // back to a *properly* cleaned meta/og title only if that's missing.
  const titleFromH3 = $1(".col-info-desc h3.title, .info h3.title, h3.title").first().text().trim();
  const titleFromOg = $1('meta[property="og:title"]').attr("content")?.trim() || "";
  const titleFromTag = $1("title").text();
  const title = titleFromH3 || cleanBoilerplateTitle(titleFromOg) || cleanBoilerplateTitle(titleFromTag);

  // Author: this site family exposes a custom og:novel:author meta tag,
  // more reliable than scraping the info-list markup.
  const authorFromMeta = $1('meta[property="og:novel:author"]').attr("content")?.trim() || "";
  const authorFromDom = $1(".info-meta li:contains('Author') a, [itemprop='author'], .author a").first().text().trim();
  const author = authorFromMeta || authorFromDom;

  // Cover: og:image is already a direct, reliable absolute URL on these sites.
  const coverFromMeta = $1('meta[property="og:image"]').attr("content")?.trim() || "";
  const coverFromDom = $1(".col-book img, .book img, .info-cover img, img[itemprop='image']").first().attr("src") || "";
  const cover_url = proxyImg(coverFromMeta || coverFromDom, sourceBase, req);

  const synopsis = $1(".desc-text, .synopsis p, .description, .book-intro").first().text().trim();

  // Bonus fields — cheap to grab alongside everything else above.
  const status = $1("a[href*='/status/']").first().text().trim() || undefined;
  const genres = $1(".info-meta a[href*='/genre/'], .info a[href*='/genre/']")
    .map((_, el) => $1(el).text().trim())
    .get()
    .filter(Boolean);

  const totalPages = Math.ceil(sourceTotal / NOVELFULL_SOURCE_PAGES_PER_OUR_PAGE);

  const offset1 = (page - 1) * CHAPTERS_PER_PAGE;
  const chaptersFromPage1 = extractChapters($1, offset1, url);

  let chaptersFromPage2: { number: number; title: string; url: string }[] = [];
  if (secondSourcePage <= sourceTotal) {
    const firstPageUrl = firstSourcePage === 1 ? url : `${url}?page=${firstSourcePage}`;
    const { html: html2 } = await fetchNovelFullSourcePage(url, secondSourcePage, firstPageUrl);
    const $2 = cheerio.load(html2);
    chaptersFromPage2 = extractChapters($2, offset1 + chaptersFromPage1.length, url);
  }

  return {
    title,
    author,
    cover_url,
    synopsis,
    status,
    genres,
    totalPages,
    currentPage: page,
    chapters: [...chaptersFromPage1, ...chaptersFromPage2],
  };
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
  const debug = searchParams.get("debug") === "1";

  if (!novelUrl) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    new URL(novelUrl); // validate before anything else touches it
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
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

    // ── 3. Write to cache ────────────────────────────────────────────────────
    await setCache(novelUrl, page, result.totalPages, payload);

    return NextResponse.json(payload);

  } catch (error) {
    console.error("Novel fetch error:", error);
    const msg = error instanceof Error ? error.message : "";

    if (msg === "CLOUDFLARE_BLOCK") {
      // Serve stale cache if available — better than an error.
      const stale = await getCached(novelUrl, page);
      if (stale) {
        return NextResponse.json({ ...stale.payload, cached: true, stale: true });
      }
      return NextResponse.json({
        error: "CLOUDFLARE_BLOCK",
        message: "This source is temporarily blocked by Cloudflare. Direct fetch, retry, FlareSolverr and ScraperAPI (whichever are configured) all failed. Please try again shortly.",
        ...(debug ? { hint: "Set FLARESOLVERR_URL and/or SCRAPER_API_KEY env vars to enable the bypass layers." } : {}),
      }, { status: 503 });
    }

    return NextResponse.json(
      { error: "Failed to fetch novel data", ...(debug ? { detail: msg } : {}) },
      { status: 500 }
    );
  }
}