import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

// ─── Relevance scoring ────────────────────────────────────────────────────────

function relevanceScore(title: string, query: string): number {
  const t = title.toLowerCase().trim();
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(w => w.length > 1);

  if (t === q) return 100;
  if (t.startsWith(q)) return 85;
  if (t.includes(q)) return 70;

  const matched = words.filter(w => t.includes(w)).length;
  if (matched === 0) return 0;
  // Require at least half the words to match for multi-word queries
  if (words.length >= 2 && matched < Math.ceil(words.length / 2)) return 0;
  return Math.round((matched / words.length) * 50);
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const SOURCES = [
  {
    id: "novelfull",
    name: "NovelFull",
    search: async (query: string) => {
      const url = `https://novelfull.net/search?keyword=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      $(".list-truyen .row").each((_, el) => {
        const titleEl = $(el).find("h3.truyen-title a");
        const title = titleEl.text().trim();
        const link = titleEl.attr("href") || "";
        const cover = $(el).find("img").attr("src") || "";
        const synopsis = $(el).find(".excerpt").text().trim().slice(0, 300);
        if (title && link) {
          results.push({
            id: `https://novelfull.net${link}`,
            title,
            cover_url: cover.startsWith("http") ? cover : `https://novelfull.net${cover}`,
            synopsis,
            source_url: `https://novelfull.net${link}`,
            source: "NovelFull",
          });
        }
      });
      return results;
    },
  },

  {
    id: "allnovelfull",
    name: "AllNovelFull",
    search: async (query: string) => {
      const url = `https://allnovelfull.net/search?keyword=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      $(".list-truyen .row, .list-novel .row").each((_, el) => {
        const titleEl = $(el).find("h3 a, .truyen-title a");
        const title = titleEl.text().trim();
        const link = titleEl.attr("href") || "";
        const cover = $(el).find("img").attr("src") || "";
        const synopsis = $(el).find(".excerpt, p").text().trim().slice(0, 300);
        if (title && link) {
          const fullLink = link.startsWith("http") ? link : `https://allnovelfull.net${link}`;
          const fullCover = cover.startsWith("http") ? cover : `https://allnovelfull.net${cover}`;
          results.push({ id: fullLink, title, cover_url: fullCover, synopsis, source_url: fullLink, source: "AllNovelFull" });
        }
      });
      return results;
    },
  },

  {
    id: "novelbin",
    name: "NovelBin",
    search: async (query: string) => {
      const url = `https://novelbin.me/search?keyword=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      $(".novel-item, .list-truyen .row").each((_, el) => {
        const titleEl = $(el).find(".novel-title a, h3 a, h3.truyen-title a");
        const title = titleEl.text().trim();
        const link = titleEl.attr("href") || $(el).find("a").first().attr("href") || "";
        const cover = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || "";
        if (title && link) {
          const fullLink = link.startsWith("http") ? link : `https://novelbin.me${link}`;
          results.push({ id: fullLink, title, cover_url: cover, synopsis: "", source_url: fullLink, source: "NovelBin" });
        }
      });
      return results;
    },
  },

  {
    id: "novelcool",
    name: "NovelCool",
    search: async (query: string) => {
      const url = `https://www.novelcool.com/search/?name=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      $(".book-item").each((_, el) => {
        const titleEl = $(el).find(".book-name a, h4 a, a").first();
        const title = titleEl.text().trim();
        const link = $(el).find("a").first().attr("href") || "";
        const cover = $(el).find("img").attr("src") || "";
        if (title && link) {
          const fullLink = link.startsWith("http") ? link : `https://www.novelcool.com${link}`;
          results.push({ id: fullLink, title, cover_url: cover, synopsis: "", source_url: fullLink, source: "NovelCool" });
        }
      });
      return results;
    },
  },

  {
    id: "novelhall",
    name: "NovelHall",
    search: async (query: string) => {
      // NovelHall search URL
      const url = `https://www.novelhall.com/?s=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { ...HEADERS, "Referer": "https://www.novelhall.com/" },
      });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];

      // NovelHall search results use table rows or article cards
      const selectors = [
        "table.altrow tr",
        ".section-body .book-item",
        ".book-list .book-item",
        "ul li.book-item",
        ".bookList li",
      ];

      let found = false;
      for (const sel of selectors) {
        if ($(sel).length > 0) {
          $(sel).each((_, el) => {
            const a = $(el).find("a").first();
            const title = ($(el).find("td a, h4 a, h3 a, .book-name a").first().text() || a.text()).trim();
            const link = $(el).find("td a, h4 a, h3 a, .book-name a").first().attr("href") || a.attr("href") || "";
            const cover = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || "";
            if (title && link && title.length > 1) {
              const fullLink = link.startsWith("http") ? link : `https://www.novelhall.com${link}`;
              const fullCover = cover ? (cover.startsWith("http") ? cover : `https://www.novelhall.com${cover}`) : "";
              results.push({ id: fullLink, title, cover_url: fullCover, synopsis: "", source_url: fullLink, source: "NovelHall" });
            }
          });
          found = true;
          break;
        }
      }

      // Fallback: parse all anchor tags that look like novel links
      if (!found || results.length === 0) {
        $("a[href*='/novel/'], a[href*='/book/']").each((_, el) => {
          const title = $(el).text().trim();
          const link = $(el).attr("href") || "";
          if (title && link && title.length > 3) {
            const fullLink = link.startsWith("http") ? link : `https://www.novelhall.com${link}`;
            if (!results.find(r => r.id === fullLink)) {
              results.push({ id: fullLink, title, cover_url: "", synopsis: "", source_url: fullLink, source: "NovelHall" });
            }
          }
        });
      }

      return results;
    },
  },

  {
    id: "novlove",
    name: "NovLove",
    search: async (query: string) => {
      const url = `https://novlove.com/search?keyword=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: HEADERS });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      $(".novel-item, .list-novel .row, .list-truyen .row").each((_, el) => {
        const titleEl = $(el).find(".novel-title a, h3 a");
        const title = titleEl.text().trim();
        const link = titleEl.attr("href") || "";
        const cover = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || "";
        if (title && link) {
          const fullLink = link.startsWith("http") ? link : `https://novlove.com${link}`;
          results.push({ id: fullLink, title, cover_url: cover, synopsis: "", source_url: fullLink, source: "NovLove" });
        }
      });
      return results;
    },
  },
];

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q");
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  const settled = await Promise.allSettled(SOURCES.map(s => s.search(query)));

  const combined: any[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      combined.push(...result.value);
    } else {
      console.error(`Source ${SOURCES[i].name} failed:`, result.reason);
    }
  });

  // Deduplicate by title (case-insensitive)
  const seen = new Set<string>();
  const deduped = combined.filter(novel => {
    const key = novel.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Score and filter
  const scored = deduped
    .map(novel => ({ ...novel, _score: relevanceScore(novel.title, query) }))
    .filter(novel => novel._score > 0)
    .sort((a, b) => b._score - a._score);

  // Fallback: if strict filter removed everything, return all deduped
  const results = scored.length > 0 ? scored : deduped.slice(0, 30);

  return NextResponse.json({ results, query, total: results.length });
}