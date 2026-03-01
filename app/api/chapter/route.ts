// app/api/chapter/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const chapterUrl = searchParams.get("url");

  if (!chapterUrl) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  try {
    const response = await fetch(chapterUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: new URL(chapterUrl).origin,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const hostname = new URL(chapterUrl).hostname;

    let title = "";
    let content = "";
    let prev_url: string | null = null;
    let next_url: string | null = null;

    // ─── RoyalRoad ───────────────────────────────────────────────────────────
    if (hostname.includes("royalroad.com")) {
      title =
        $(".chapter-title, .fic-chapter-title h1").first().text().trim() ||
        $("h1").first().text().trim();

      const contentEl = $(".chapter-content");
      contentEl.find("script, style, .ads, .ad-container").remove();
      content = contentEl.html() || "";

      const prevHref = $('a[href*="/chapter/"]:contains("Previous"), a.prev').attr("href");
      const nextHref = $('a[href*="/chapter/"]:contains("Next"), a.next').attr("href");
      prev_url = resolveUrl(prevHref, chapterUrl);
      next_url = resolveUrl(nextHref, chapterUrl);
    }

    // ─── NovelFull / AllNovelFull / NovLove ──────────────────────────────────
    else if (
      hostname.includes("novelfull.net") ||
      hostname.includes("allnovelfull.net") ||
      hostname.includes("novlove.com")
    ) {
      title =
        $("h2.chapter-title, .chapter-title, h2").first().text().trim() ||
        $("title").text().split("|")[0].trim();

      const contentEl = $("#chapter-c, .chapter-c, div#chapter-content").first();
      contentEl.find("script, style, .ads, [class*='ads'], h2, h3").remove();
      content = contentEl.html() || "";

      $("a").each((_, el) => {
        const text = $(el).text().trim().toLowerCase();
        const href = $(el).attr("href");
        if (!href) return;
        if (!prev_url && (text.includes("prev") || $(el).attr("id")?.includes("prev"))) {
          prev_url = resolveUrl(href, chapterUrl);
        }
        if (!next_url && (text.includes("next") || $(el).attr("id")?.includes("next"))) {
          next_url = resolveUrl(href, chapterUrl);
        }
      });

      if (!prev_url) prev_url = resolveUrl($("#prev_chap").attr("href"), chapterUrl);
      if (!next_url) next_url = resolveUrl($("#next_chap").attr("href"), chapterUrl);
    }

    // ─── NovelBin ─────────────────────────────────────────────────────────────
    else if (hostname.includes("novelbin.me") || hostname.includes("novelbin.com")) {
      title =
        $(".chr-title, .chapter-title, h2").first().text().trim() ||
        $("title").text().split("-")[0].trim();

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

    // ─── NovelCool ────────────────────────────────────────────────────────────
    else if (hostname.includes("novelcool.com")) {
      title =
        $(".chapter-title, h1.title, h1").first().text().trim() ||
        $("title").text().split("-")[0].trim();

      const contentEl = $(".chapter-entity, .chapter-content").first();
      contentEl.find("script, style, .ads, .ad").remove();
      content = contentEl.html() || "";

      prev_url = resolveUrl(
        $("a.chapter-prev, a[rel='prev'], a:contains('Previous Chapter')").attr("href"),
        chapterUrl
      );
      next_url = resolveUrl(
        $("a.chapter-next, a[rel='next'], a:contains('Next Chapter')").attr("href"),
        chapterUrl
      );
    }

    // ─── NovelHall ────────────────────────────────────────────────────────────
    else if (hostname.includes("novelhall.com")) {
      title =
        $(".chapter-title, h1").first().text().trim() ||
        $("title").text().split("|")[0].trim();

      const contentEl = $(".chapter-entity, #htmlContent, .entry-content").first();
      contentEl.find("script, style, .ads").remove();
      content = contentEl.html() || "";

      prev_url = resolveUrl(
        $("a.prev-chapter, a:contains('Previous'), a[href*='chapter']:first").attr("href"),
        chapterUrl
      );
      next_url = resolveUrl(
        $("a.next-chapter, a:contains('Next')").attr("href"),
        chapterUrl
      );
    }

    // ─── Generic fallback ─────────────────────────────────────────────────────
    else {
      title = $("h1, h2").first().text().trim() || $("title").text().trim();

      const selectors = [
        "#chapter-content",
        ".chapter-content",
        "#chapter-c",
        ".chapter-c",
        ".chr-c",
        "#chr-content",
        ".chapter-entity",
        "#htmlContent",
        ".entry-content",
        ".text-left",
        "article",
        ".post-content",
        ".content",
        "main",
      ];

      for (const sel of selectors) {
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
        if (!prev_url && (text === "previous chapter" || text === "← previous" || text === "prev chapter")) {
          prev_url = resolveUrl(href, chapterUrl);
        }
        if (!next_url && (text === "next chapter" || text === "next →" || text === "next chapter →")) {
          next_url = resolveUrl(href, chapterUrl);
        }
      });
    }

    // ─── Sanitize content ─────────────────────────────────────────────────────
    if (!content || content.trim().length < 100) {
      return NextResponse.json(
        { error: "Could not extract chapter content. The source site may have changed its layout." },
        { status: 422 }
      );
    }

    content = content
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .trim();

    return NextResponse.json({ title, content, prev_url, next_url });
  } catch (error) {
    console.error("Chapter fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch chapter content" },
      { status: 500 }
    );
  }
}