// app/api/chapter/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return null; }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chapterUrl = searchParams.get("url");
  if (!chapterUrl) return NextResponse.json({ error: "URL is required" }, { status: 400 });

  try {
    const response = await fetch(chapterUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: new URL(chapterUrl).origin,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);
    const hostname = new URL(chapterUrl).hostname;

    let title = "", content = "", prev_url: string | null = null, next_url: string | null = null;

    // ─── LightNovelPub ───────────────────────────────────────────────────────
    if (hostname.includes("lightnovelpub")) {
      title = $(".chapter-title, h2.chr-title, h1.chapter-title, h2").first().text().trim() ||
        $("title").text().split("-")[0].trim();

      // Try multiple content selectors
      const contentSelectors = [".chapter-content", ".reading-container", "#chapter-content", ".chr-c", ".chapter-entity", ".novel-content", ".text-left"];
      for (const sel of contentSelectors) {
        const el = $(sel).first();
        if (el.length && el.text().trim().length > 200) {
          el.find("script, style, .ads, .ad, [class*='adsbygoogle'], .sharedaddy").remove();
          content = el.html() || "";
          break;
        }
      }

      // Prev/Next navigation
      prev_url = resolveUrl($("a.prev-chapter, a[rel='prev'], .btn-prev a, a:contains('Prev'), a:contains('Previous')").first().attr("href"), chapterUrl);
      next_url = resolveUrl($("a.next-chapter, a[rel='next'], .btn-next a, a:contains('Next Chapter'), a:contains('Next')").first().attr("href"), chapterUrl);

      // Fallback: look for nav links with chapter URLs
      if (!prev_url || !next_url) {
        $("a[href*='/book/']").each((_, el) => {
          const text = $(el).text().trim().toLowerCase();
          const href = $(el).attr("href");
          if (!href) return;
          if (!prev_url && (text.includes("prev") || text === "←")) prev_url = resolveUrl(href, chapterUrl);
          if (!next_url && (text.includes("next") || text === "→")) next_url = resolveUrl(href, chapterUrl);
        });
      }
    }

    // ─── RoyalRoad ──────────────────────────────────────────────────────────
    else if (hostname.includes("royalroad.com")) {
      title = $(".chapter-title, .fic-chapter-title h1").first().text().trim() || $("h1").first().text().trim();
      const contentEl = $(".chapter-content");
      contentEl.find("script, style, .ads, .ad-container").remove();
      content = contentEl.html() || "";
      prev_url = resolveUrl($('a[href*="/chapter/"]:contains("Previous"), a.prev').attr("href"), chapterUrl);
      next_url = resolveUrl($('a[href*="/chapter/"]:contains("Next"), a.next').attr("href"), chapterUrl);
    }

    // ─── NovelFull / AllNovelFull / NovLove ────────────────────────────────
    else if (hostname.includes("novelfull.net") || hostname.includes("allnovelfull.net") || hostname.includes("novlove.com")) {
      title = $("h2.chapter-title, .chapter-title, h2").first().text().trim() || $("title").text().split("|")[0].trim();
      const contentEl = $("#chapter-c, .chapter-c, div#chapter-content").first();
      contentEl.find("script, style, .ads, [class*='ads'], h2, h3").remove();
      content = contentEl.html() || "";
      $("a").each((_, el) => {
        const text = $(el).text().trim().toLowerCase();
        const href = $(el).attr("href");
        if (!href) return;
        if (!prev_url && (text.includes("prev") || $(el).attr("id")?.includes("prev"))) prev_url = resolveUrl(href, chapterUrl);
        if (!next_url && (text.includes("next") || $(el).attr("id")?.includes("next"))) next_url = resolveUrl(href, chapterUrl);
      });
      if (!prev_url) prev_url = resolveUrl($("#prev_chap").attr("href"), chapterUrl);
      if (!next_url) next_url = resolveUrl($("#next_chap").attr("href"), chapterUrl);
    }

    // ─── NovelBin ──────────────────────────────────────────────────────────
    else if (hostname.includes("novelbin.me") || hostname.includes("novelbin.com")) {
      title = $(".chr-title, .chapter-title, h2").first().text().trim() || $("title").text().split("-")[0].trim();
      const contentEl = $(".chr-c, #chr-content, .chapter-c").first();
      contentEl.find("script, style, .ads, h2, h3, .lock-premium").remove();
      content = contentEl.html() || "";
      prev_url = resolveUrl($(".chr-nav a.chr-prev, a#prev_chap, a.prev-chap").attr("href"), chapterUrl);
      next_url = resolveUrl($(".chr-nav a.chr-next, a#next_chap, a.next-chap").attr("href"), chapterUrl);
      if (!prev_url || !next_url) {
        $("a").each((_, el) => {
          const text = $(el).text().trim().toLowerCase();
          const href = $(el).attr("href");
          if (!href) return;
          if (!prev_url && text.includes("prev")) prev_url = resolveUrl(href, chapterUrl);
          if (!next_url && text.includes("next")) next_url = resolveUrl(href, chapterUrl);
        });
      }
    }

    // ─── NovelCool ─────────────────────────────────────────────────────────
    else if (hostname.includes("novelcool.com")) {
      title = $(".chapter-title, h1.title, h1").first().text().trim() || $("title").text().split("-")[0].trim();
      const contentEl = $(".chapter-entity, .chapter-content").first();
      contentEl.find("script, style, .ads, .ad").remove();
      content = contentEl.html() || "";
      prev_url = resolveUrl($("a.chapter-prev, a[rel='prev'], a:contains('Previous Chapter')").attr("href"), chapterUrl);
      next_url = resolveUrl($("a.chapter-next, a[rel='next'], a:contains('Next Chapter')").attr("href"), chapterUrl);
    }

    // ─── NovelHall ─────────────────────────────────────────────────────────
    else if (hostname.includes("novelhall.com")) {
      title = $(".chapter-title, h1").first().text().trim() || $("title").text().split("|")[0].trim();
      const contentEl = $(".chapter-entity, #htmlContent, .entry-content").first();
      contentEl.find("script, style, .ads").remove();
      content = contentEl.html() || "";
      prev_url = resolveUrl($("a.prev-chapter, a:contains('Previous')").attr("href"), chapterUrl);
      next_url = resolveUrl($("a.next-chapter, a:contains('Next')").attr("href"), chapterUrl);
    }

    // ─── Generic fallback ──────────────────────────────────────────────────
    else {
      title = $("h1, h2").first().text().trim() || $("title").text().trim();
      for (const sel of ["#chapter-content", ".chapter-content", "#chapter-c", ".chapter-c", ".chr-c", "#chr-content", ".chapter-entity", "#htmlContent", ".entry-content", ".text-left", "article", ".post-content", ".content", "main"]) {
        const el = $(sel).first();
        if (el.length && el.text().trim().length > 200) {
          el.find("script, style, .ads, nav, header, footer").remove();
          content = el.html() || "";
          break;
        }
      }
      $("a").each((_, el) => {
        const text = $(el).text().trim().toLowerCase();
        const href = $(el).attr("href");
        if (!href) return;
        if (!prev_url && (text === "previous chapter" || text === "← previous" || text === "prev chapter")) prev_url = resolveUrl(href, chapterUrl);
        if (!next_url && (text === "next chapter" || text === "next →" || text === "next chapter →")) next_url = resolveUrl(href, chapterUrl);
      });
    }

    if (!content || content.trim().length < 100) {
      return NextResponse.json({ error: "Could not extract chapter content. The source site may have changed its layout." }, { status: 422 });
    }

    content = content.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").trim();
    return NextResponse.json({ title, content, prev_url, next_url });

  } catch (error) {
    console.error("Chapter fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch chapter content" }, { status: 500 });
  }
}