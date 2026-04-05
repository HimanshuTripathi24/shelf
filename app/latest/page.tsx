// app/latest/page.tsx
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import * as cheerio from "cheerio";

// ─── Image helper (same as library page) ─────────────────────────────────────
function proxiedUrl(coverUrl: string, sourceUrl?: string): string {
  if (!coverUrl) return "";
  let base = "https://novelfull.net";
  if (sourceUrl) {
    try { base = new URL(sourceUrl).origin; } catch {}
  }
  try {
    if (coverUrl.startsWith("/api/image?url=")) {
      const inner = decodeURIComponent(coverUrl.slice("/api/image?url=".length));
      const resolved = inner.startsWith("http") ? inner : `${base}${inner}`;
      return `/api/image?url=${encodeURIComponent(resolved)}`;
    }
    const u = new URL(coverUrl);
    if (u.pathname === "/api/image") {
      const inner = u.searchParams.get("url") || "";
      const resolved = inner.startsWith("http") ? inner : `${base}${inner}`;
      return `/api/image?url=${encodeURIComponent(resolved)}`;
    }
    return `/api/image?url=${encodeURIComponent(coverUrl)}`;
  } catch {
    return `/api/image?url=${encodeURIComponent(coverUrl)}`;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface LatestNovel {
  title: string;
  cover_url: string;
  source_url: string;
  chapter: string;
  author: string;
  genres: string[];
}

// ─── Scraper ──────────────────────────────────────────────────────────────────
async function scrapeLatestPage(page: number): Promise<{ novels: LatestNovel[]; totalPages: number }> {
  const url = page === 1
    ? "https://novelfull.net/latest-release-novel"
    : `https://novelfull.net/latest-release-novel?page=${page}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      // No ISR cache — latest releases are time-sensitive; use short revalidate
      next: { revalidate: 300 },
    });
    if (!res.ok) return { novels: [], totalPages: 1 };

    const html = await res.text();
    const $ = cheerio.load(html);

    // ── Parse total pages from Bootstrap pagination ──────────────────────────
    // novelfull renders: <li class="last"><a href="...?page=N">Last</a></li>
    let totalPages = 1;
    const lastHref = $(".pagination .last a").attr("href") || $(".pagination li:last-child a").attr("href") || "";
    const lastMatch = lastHref.match(/[?&]page=(\d+)/);
    if (lastMatch) {
      totalPages = parseInt(lastMatch[1], 10);
    } else {
      // Fallback: highest page number visible in pagination
      $(".pagination a").each((_, el) => {
        const n = parseInt($(el).text().trim(), 10);
        if (!isNaN(n) && n > totalPages) totalPages = n;
      });
    }

    // ── Parse novel rows ─────────────────────────────────────────────────────
    const novels: LatestNovel[] = [];
    $(".list-truyen .row").each((_, el) => {
      const titleEl = $(el).find("h3.truyen-title a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      if (!title || !link) return;

      const imgEl = $(el).find("img");
      const cover = imgEl.attr("data-src") || imgEl.attr("src") || "";

      const author = $(el).find(".author").text().trim() || "Unknown";

      let chapter = $(el).find(".text-info a").first().text().trim();
      if (!chapter) chapter = $(el).find(".text-info").first().text().trim();
      chapter = chapter.replace(/\s+/g, " ").trim();
      if (chapter.length > 40) chapter = "";

      const genres: string[] = [];
      $(el).find(".label-default").each((_, ge) => {
        const g = $(ge).text().trim();
        if (g && g.length < 20 && genres.length < 3) genres.push(g);
      });

      novels.push({
        title,
        cover_url: cover.startsWith("http") ? cover : `https://novelfull.net${cover}`,
        source_url: link.startsWith("http") ? link : `https://novelfull.net${link}`,
        author,
        chapter,
        genres,
      });
    });

    return { novels, totalPages };
  } catch {
    return { novels: [], totalPages: 1 };
  }
}

// ─── NavBar ───────────────────────────────────────────────────────────────────
async function NavBar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <>
      <input type="checkbox" id="ln-menu-toggle" className="ln-menu-toggle" />
      <label htmlFor="ln-menu-toggle" className="ln-menu-overlay" />
      <div className="ln-drawer">
        <div className="ln-drawer-head">
          <Link href="/" className="ln-drawer-logo"><span style={{ color: "#c8a96e" }}>⬡</span><span style={{ letterSpacing: "0.3em" }}>SHELF</span></Link>
          <label htmlFor="ln-menu-toggle" className="ln-drawer-close">✕</label>
        </div>
        <div className="ln-drawer-body">
          <div className="ln-drawer-search">
            <form method="get" action="/search" className="ln-drawer-search-form">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input name="q" type="text" placeholder="Search novels…" autoComplete="off" className="ln-drawer-search-input" />
            </form>
          </div>
          <Link href="/" className="ln-drawer-link">Home</Link>
          <Link href="/latest" className="ln-drawer-link ln-drawer-link-active">Latest</Link>
          <Link href="/library" className="ln-drawer-link">Library</Link>
          <Link href="/search" className="ln-drawer-link">Search</Link>
        </div>
        <div className="ln-drawer-foot">
          {user ? (
            <><div className="ln-drawer-email">{user.email ?? "Guest User"}</div><form action="/auth/signout" method="post"><button type="submit" formAction="/auth/signout" className="ln-drawer-signout">Sign Out</button></form></>
          ) : (<Link href="/sign-in" className="ln-drawer-signin">Sign In</Link>)}
        </div>
      </div>
      <nav className="ln-nav">
        <div className="ln-nav-inner">
          <label htmlFor="ln-menu-toggle" className="ln-hamburger" aria-label="Open menu"><span /><span /><span /></label>
          <Link href="/" className="ln-logo"><span className="ln-logo-icon">⬡</span><span className="ln-logo-text">SHELF</span></Link>
          <div className="ln-nav-links">
            <Link href="/library" className="ln-nav-link">Library</Link>
            <Link href="/latest" className="ln-nav-link ln-nav-link-active">Latest</Link>
            <Link href="/search" className="ln-nav-link">Search</Link>
          </div>
          <div className="ln-nav-right">
            <form method="get" action="/search" style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "6px 14px" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                <input name="q" type="text" placeholder="Search novels…" autoComplete="off" style={{ background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,0.75)", fontSize: "13px", fontFamily: "Georgia, serif", width: "180px" }} />
              </div>
            </form>
            {user ? (
              <details className="ln-account-menu">
                <summary className="ln-icon-btn ln-avatar" title={user.email ?? "Guest"}>{user.email ? user.email[0].toUpperCase() : "G"}</summary>
                <div className="ln-dropdown">
                  <div className="ln-dropdown-email">{user.email ?? "Guest User"}</div>
                  <Link href="/library" className="ln-dropdown-item">📚 My Library</Link>
                  <form action="/auth/signout" method="post" style={{ display: "contents" }}><button type="submit" className="ln-dropdown-item ln-dropdown-signout" formAction="/auth/signout">Sign Out</button></form>
                </div>
              </details>
            ) : (<Link href="/sign-in" className="ln-sign-in-btn">Sign In</Link>)}
          </div>
        </div>
      </nav>
    </>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────
function Pagination({ current, total }: { current: number; total: number }) {
  if (total <= 1) return null;

  // Build a window of page links: always show first, last, and ±2 around current
  const pages: (number | "…")[] = [];
  const add = (n: number) => { if (n >= 1 && n <= total && !pages.includes(n)) pages.push(n); };

  add(1);
  if (current > 4) pages.push("…");
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) add(i);
  if (current < total - 3) pages.push("…");
  add(total);

  return (
    <nav className="lat-pagination" aria-label="Page navigation">
      {current > 1 && (
        <Link href={`/latest?page=${current - 1}`} className="lat-page-btn lat-page-prev">← Prev</Link>
      )}
      <div className="lat-page-nums">
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="lat-page-ellipsis">…</span>
          ) : (
            <Link
              key={p}
              href={`/latest?page=${p}`}
              className={`lat-page-num${p === current ? " active" : ""}`}
            >
              {p}
            </Link>
          )
        )}
      </div>
      {current < total && (
        <Link href={`/latest?page=${current + 1}`} className="lat-page-btn lat-page-next">Next →</Link>
      )}
    </nav>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function LatestPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const currentPage = Math.max(1, parseInt(searchParams.page || "1", 10));
  const { novels, totalPages } = await scrapeLatestPage(currentPage);

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080808; color: #e8e8e8; font-family: 'Georgia', serif; min-height: 100vh; overflow-x: hidden; }

        /* ── Nav ── */
        .ln-nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; background: rgba(8,8,8,0.85); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ln-nav-inner { max-width: 1400px; margin: 0 auto; display: flex; align-items: center; gap: 32px; padding: 0 32px; height: 60px; }
        .ln-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; color: #fff; font-size: 18px; font-weight: 700; letter-spacing: 0.15em; flex-shrink: 0; }
        .ln-logo-icon { color: #c8a96e; font-size: 22px; }
        .ln-logo-text { letter-spacing: 0.3em; }
        .ln-nav-links { display: flex; gap: 28px; }
        .ln-nav-link { color: rgba(255,255,255,0.55); text-decoration: none; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; transition: color 0.2s; }
        .ln-nav-link:hover { color: #fff; }
        .ln-nav-link-active { color: #c8a96e !important; }
        .ln-nav-right { display: flex; align-items: center; gap: 16px; margin-left: auto; }
        .ln-icon-btn { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,0.6); cursor: pointer; list-style: none; }
        .ln-avatar { font-size: 14px; font-weight: 700; color: #c8a96e; border-color: #c8a96e44; }
        .ln-sign-in-btn { background: #c8a96e; color: #080808; border: none; border-radius: 20px; padding: 7px 18px; font-size: 12px; font-weight: 700; text-decoration: none; letter-spacing: 0.08em; }
        .ln-account-menu { position: relative; list-style: none; }
        .ln-account-menu summary { list-style: none; cursor: pointer; }
        .ln-account-menu summary::-webkit-details-marker { display: none; }
        .ln-dropdown { position: absolute; top: 44px; right: 0; background: #1a1a1a; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 8px; min-width: 200px; z-index: 200; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }
        .ln-dropdown-email { font-size: 11px; color: rgba(255,255,255,0.3); padding: 8px 12px; letter-spacing: 0.06em; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 6px; }
        .ln-dropdown-item { display: block; padding: 10px 12px; font-size: 13px; color: rgba(255,255,255,0.7); text-decoration: none; border-radius: 6px; transition: all 0.15s; font-family: 'Georgia', serif; width: 100%; text-align: left; background: none; border: none; cursor: pointer; }
        .ln-dropdown-item:hover { background: rgba(255,255,255,0.06); color: #fff; }
        .ln-dropdown-signout { color: rgba(248,113,113,0.7); }
        .ln-dropdown-signout:hover { background: rgba(248,113,113,0.1); color: #f87171; }

        /* ── Mobile drawer ── */
        .ln-menu-toggle { display: none; }
        .ln-hamburger { display: none; flex-direction: column; justify-content: center; gap: 5px; cursor: pointer; padding: 4px; width: 36px; height: 36px; flex-shrink: 0; }
        .ln-hamburger span { display: block; height: 2px; background: #e8e8e8; border-radius: 2px; }
        .ln-menu-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 150; backdrop-filter: blur(2px); }
        .ln-drawer { position: fixed; top: 0; left: 0; bottom: 0; width: 280px; max-width: 85vw; background: #111; z-index: 200; transform: translateX(-100%); transition: transform 0.3s ease; display: flex; flex-direction: column; }
        .ln-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; height: 60px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ln-drawer-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; color: #fff; font-size: 17px; font-weight: 700; letter-spacing: 0.15em; }
        .ln-drawer-close { color: rgba(255,255,255,0.4); font-size: 22px; cursor: pointer; line-height: 1; padding: 4px; }
        .ln-drawer-body { flex: 1; overflow-y: auto; padding: 16px 0; }
        .ln-drawer-link { display: block; padding: 14px 24px; color: rgba(255,255,255,0.7); text-decoration: none; font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.04); transition: color 0.15s; }
        .ln-drawer-link:hover, .ln-drawer-link-active { color: #c8a96e; }
        .ln-drawer-search { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ln-drawer-search-form { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 8px 14px; }
        .ln-drawer-search-input { background: transparent; border: none; outline: none; color: rgba(255,255,255,0.75); font-size: 14px; font-family: 'Georgia', serif; flex: 1; }
        .ln-drawer-foot { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.06); }
        .ln-drawer-email { font-size: 11px; color: rgba(255,255,255,0.25); letter-spacing: 0.06em; margin-bottom: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ln-drawer-signout { width: 100%; background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2); color: #f87171; border-radius: 6px; padding: 10px; font-family: 'Georgia', serif; font-size: 13px; cursor: pointer; letter-spacing: 0.08em; }
        .ln-drawer-signin { display: block; text-align: center; background: #c8a96e; color: #080808; text-decoration: none; border-radius: 6px; padding: 11px; font-weight: 700; font-size: 13px; letter-spacing: 0.1em; }
        .ln-menu-toggle:checked ~ .ln-menu-overlay { display: block; }
        .ln-menu-toggle:checked ~ .ln-drawer { transform: translateX(0); }

        /* ── Page layout ── */
        .lat-page { max-width: 1400px; margin: 0 auto; padding: 96px 32px 80px; }
        .lat-header { margin-bottom: 40px; }
        .lat-breadcrumb { display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,0.3); letter-spacing: 0.1em; margin-bottom: 16px; }
        .lat-breadcrumb a { color: rgba(255,255,255,0.3); text-decoration: none; transition: color 0.2s; }
        .lat-breadcrumb a:hover { color: #c8a96e; }
        .lat-breadcrumb-sep { color: rgba(255,255,255,0.15); }
        .lat-title-row { display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap; }
        .lat-pill { background: rgba(74,222,128,0.1); color: #4ade80; border: 1px solid rgba(74,222,128,0.3); border-radius: 20px; padding: 4px 12px; font-size: 10px; letter-spacing: 0.2em; font-weight: 700; text-transform: uppercase; white-space: nowrap; animation: lat-pulse 2.5s infinite; }
        @keyframes lat-pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        .lat-title { font-size: clamp(28px, 4vw, 48px); font-weight: 700; color: #fff; letter-spacing: -0.02em; }
        .lat-subtitle { font-size: 13px; color: rgba(255,255,255,0.35); margin-top: 10px; letter-spacing: 0.05em; }

        /* ── Novel list rows ── */
        .lat-list { display: flex; flex-direction: column; gap: 2px; }
        .lat-row { display: flex; align-items: center; gap: 16px; padding: 12px 14px; border-radius: 8px; text-decoration: none; color: inherit; transition: background 0.15s; border: 1px solid transparent; }
        .lat-row:hover { background: rgba(255,255,255,0.03); border-color: rgba(255,255,255,0.05); }
        .lat-row-num { font-size: 12px; color: rgba(255,255,255,0.15); font-weight: 700; width: 28px; flex-shrink: 0; text-align: right; font-family: monospace; }
        .lat-thumb { width: 48px; height: 68px; border-radius: 4px; overflow: hidden; flex-shrink: 0; background: #111; border: 1px solid rgba(255,255,255,0.08); position: relative; }
        .lat-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .lat-thumb-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg,#1a0d2e,#2d1b4e); font-size: 13px; font-weight: 900; color: rgba(200,169,110,0.3); }
        .lat-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
        .lat-novel-title { font-size: 14px; font-weight: 700; color: #e8e8e8; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color 0.15s; }
        .lat-row:hover .lat-novel-title { color: #c8a96e; }
        .lat-novel-author { font-size: 11px; color: rgba(255,255,255,0.35); }
        .lat-genres { display: flex; flex-wrap: wrap; gap: 4px; }
        .lat-genre { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(200,169,110,0.8); background: rgba(200,169,110,0.1); border: 1px solid rgba(200,169,110,0.2); border-radius: 3px; padding: 2px 5px; white-space: nowrap; }
        .lat-chapter { flex-shrink: 0; font-size: 11px; color: #4ade80; font-weight: 600; letter-spacing: 0.05em; white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }

        /* ── Empty state ── */
        .lat-empty { text-align: center; padding: 80px 20px; color: rgba(255,255,255,0.25); font-size: 15px; letter-spacing: 0.1em; }

        /* ── Pagination ── */
        .lat-pagination { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 56px; flex-wrap: wrap; }
        .lat-page-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); border-radius: 6px; padding: 9px 18px; font-size: 12px; font-weight: 700; letter-spacing: 0.1em; text-decoration: none; transition: all 0.2s; font-family: 'Georgia', serif; }
        .lat-page-btn:hover { border-color: #c8a96e; color: #c8a96e; background: rgba(200,169,110,0.06); }
        .lat-page-nums { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; justify-content: center; }
        .lat-page-num { min-width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 6px; font-size: 13px; font-weight: 700; text-decoration: none; color: rgba(255,255,255,0.5); border: 1px solid transparent; transition: all 0.15s; font-family: 'Georgia', serif; }
        .lat-page-num:hover { background: rgba(255,255,255,0.06); color: #fff; border-color: rgba(255,255,255,0.1); }
        .lat-page-num.active { background: #c8a96e; color: #080808; border-color: #c8a96e; }
        .lat-page-ellipsis { color: rgba(255,255,255,0.2); font-size: 13px; padding: 0 4px; line-height: 36px; }

        /* ── Page info ── */
        .lat-page-info { text-align: center; margin-top: 16px; font-size: 12px; color: rgba(255,255,255,0.2); letter-spacing: 0.08em; }

        /* ── Footer ── */
        .ln-footer { border-top: 1px solid rgba(255,255,255,0.06); padding: 32px; text-align: center; color: rgba(255,255,255,0.2); font-size: 12px; letter-spacing: 0.1em; }

        @media (max-width: 768px) {
          .ln-hamburger { display: flex; }
          .ln-nav-links { display: none; }
          .ln-nav-right form { display: none; }
          .ln-nav-inner { padding: 0 16px; gap: 12px; }
          .lat-page { padding: 80px 16px 60px; }
          .lat-chapter { display: none; }
          .lat-row-num { display: none; }
        }
        @media (max-width: 480px) {
          .lat-genres { display: none; }
        }
      `}</style>

      <Suspense><NavBar /></Suspense>

      <main>
        <div className="lat-page">
          {/* Header */}
          <div className="lat-header">
            <div className="lat-breadcrumb">
              <Link href="/">Home</Link>
              <span className="lat-breadcrumb-sep">›</span>
              <span>Latest Releases</span>
            </div>
            <div className="lat-title-row">
              <span className="lat-pill">● LIVE</span>
              <h1 className="lat-title">Latest Releases</h1>
            </div>
            <p className="lat-subtitle">
              Page {currentPage} of {totalPages} · Updated continuously from NovelFull
            </p>
          </div>

          {/* Novel list */}
          {novels.length === 0 ? (
            <div className="lat-empty">Could not load novels. Please try again.</div>
          ) : (
            <div className="lat-list">
              {novels.map((n, i) => {
                const rowNum = (currentPage - 1) * novels.length + i + 1;
                return (
                  <Link
                    key={n.source_url}
                    href={`/novel?url=${encodeURIComponent(n.source_url)}`}
                    className="lat-row"
                  >
                    <span className="lat-row-num">{rowNum}</span>

                    <div className="lat-thumb">
                      {n.cover_url ? (
                        <img src={proxiedUrl(n.cover_url, n.source_url)} alt={n.title} loading="lazy" />
                      ) : (
                        <div className="lat-thumb-fallback">{n.title.slice(0, 2).toUpperCase()}</div>
                      )}
                    </div>

                    <div className="lat-info">
                      <div className="lat-novel-title">{n.title}</div>
                      <div className="lat-novel-author">{n.author}</div>
                      {n.genres.length > 0 && (
                        <div className="lat-genres">
                          {n.genres.map(g => <span key={g} className="lat-genre">{g}</span>)}
                        </div>
                      )}
                    </div>

                    {n.chapter && (
                      <span className="lat-chapter">{n.chapter}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          <Pagination current={currentPage} total={totalPages} />
          {totalPages > 1 && (
            <p className="lat-page-info">Page {currentPage} / {totalPages}</p>
          )}
        </div>
      </main>

      <footer className="ln-footer">
        ⬡ SHELF · Your personal light novel archive
      </footer>
    </>
  );
}