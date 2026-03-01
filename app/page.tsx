import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import * as cheerio from "cheerio";

function proxyImg(url: string) {
  if (!url) return "";
  // Unwrap if already proxied (absolute localhost URL from old saves)
  try {
    if (url.startsWith("/api/image?url=")) {
      const inner = decodeURIComponent(url.slice("/api/image?url=".length));
      return `/api/image?url=${encodeURIComponent(inner.startsWith("http") ? inner : `https://novelfull.net${inner}`)}`;
    }
    const u = new URL(url);
    if (u.pathname === "/api/image") {
      const inner = u.searchParams.get("url") || "";
      return `/api/image?url=${encodeURIComponent(inner.startsWith("http") ? inner : `https://novelfull.net${inner}`)}`;
    }
  } catch {}
  return `/api/image?url=${encodeURIComponent(url)}`;
}

// ─── Inline Search ────────────────────────────────────────────────────────────

function InlineSearch() {
  return (
    <form method="get" action="/search" className="ln-inline-search" style={{ position: "relative", flex: 1 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "8px",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "20px", padding: "6px 14px",
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <input
          name="q"
          type="text"
          placeholder="Search novels…"
          autoComplete="off"
          style={{
            background: "transparent", border: "none", outline: "none",
            color: "rgba(255,255,255,0.75)", fontSize: "13px",
            fontFamily: "Georgia, serif", width: "180px",
          }}
        />
      </div>
    </form>
  );
}

// ─── NavBar ───────────────────────────────────────────────────────────────────

async function NavBar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <>
      {/* CSS-only mobile drawer using checkbox hack */}
      <input type="checkbox" id="ln-menu-toggle" className="ln-menu-toggle" />

      {/* Overlay — clicking closes drawer */}
      <label htmlFor="ln-menu-toggle" className="ln-menu-overlay" />

      {/* Mobile drawer */}
      <div className="ln-drawer">
        <div className="ln-drawer-head">
          <Link href="/" className="ln-drawer-logo">
            <span style={{ color: "#c8a96e" }}>⬡</span>
            <span style={{ letterSpacing: "0.3em" }}>SHELF</span>
          </Link>
          <label htmlFor="ln-menu-toggle" className="ln-drawer-close">✕</label>
        </div>
        <div className="ln-drawer-body">
          <div className="ln-drawer-search">
            <form method="get" action="/search" className="ln-drawer-search-form">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input name="q" type="text" placeholder="Search novels…" autoComplete="off" className="ln-drawer-search-input" />
            </form>
          </div>
          <Link href="/" className="ln-drawer-link">Home</Link>
          <Link href="/library" className="ln-drawer-link">Library</Link>
          <Link href="/search" className="ln-drawer-link">Search</Link>
        </div>
        <div className="ln-drawer-foot">
          {user ? (
            <>
              <p className="ln-drawer-email">{user.email ?? "Guest User"}</p>
              <form action="/auth/signout" method="post">
                <button type="submit" formAction="/auth/signout" className="ln-drawer-signout">Sign Out</button>
              </form>
            </>
          ) : (
            <Link href="/sign-in" className="ln-drawer-signin">Sign In</Link>
          )}
        </div>
      </div>

      {/* Main nav bar */}
      <nav className="ln-nav">
        <div className="ln-nav-inner">
          {/* Hamburger label — mobile only */}
          <label htmlFor="ln-menu-toggle" className="ln-hamburger" aria-label="Open menu">
            <span /><span /><span />
          </label>

          <Link href="/" className="ln-logo">
            <span className="ln-logo-icon">⬡</span><span className="ln-logo-text">SHELF</span>
          </Link>
          <div className="ln-nav-links">
            <Link href="/library" className="ln-nav-link">Library</Link>
            <Link href="/search" className="ln-nav-link">Search</Link>
          </div>
          <div className="ln-nav-right">
            <InlineSearch />
            {user ? (
              <details className="ln-account-menu">
                <summary className="ln-icon-btn ln-avatar" title={user.email ?? "Guest"}>
                  {user.email ? user.email[0].toUpperCase() : "G"}
                </summary>
                <div className="ln-dropdown">
                  <p className="ln-dropdown-email">{user.email ?? "Guest User"}</p>
                  <Link href="/library" className="ln-dropdown-item">📚 My Library</Link>
                  <form action="/auth/signout" method="post" style={{ display: "contents" }}>
                    <button type="submit" className="ln-dropdown-item ln-dropdown-signout" formAction="/auth/signout">Sign Out</button>
                  </form>
                </div>
              </details>
            ) : (
              <Link href="/sign-in" className="ln-sign-in-btn">Sign In</Link>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  // A cinematic xianxia/cultivation scene — dragon, mountains, warrior silhouette
  // Using a reliable public domain fantasy image
  // Dramatic dark misty mountain landscape — evokes xianxia/wuxia cultivation world atmosphere
  const heroImg = "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1800&q=80";

  return (
    <section className="ln-hero">
      {/* Background image — dark cinematic scene */}
      <div className="ln-hero-bg-img" style={{ backgroundImage: `url(${heroImg})` }} />
      {/* Overlays to keep text readable */}
      <div className="ln-hero-overlay-left" />
      <div className="ln-hero-overlay-bottom" />
      <div className="ln-hero-overlay-vignette" />

      <div className="ln-hero-content">
        <div className="ln-hero-left">
          <p className="ln-hero-label">✦ YOUR READING UNIVERSE</p>
          <h1 className="ln-hero-title">Track &amp;<br />Read Light<br />Novels</h1>
          <p className="ln-hero-synopsis">
            Search thousands of light novels from top sources. Track your progress,
            sync across all your devices, and read anywhere.
          </p>
          <div className="ln-hero-actions">
            <Link href="/search" className="ln-cta-btn">SEARCH NOVELS <span>→</span></Link>
            <Link href="/library" className="ln-cta-ghost">View Library</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Archive Banner ───────────────────────────────────────────────────────────

function ArchiveBanner() {
  return (
    <div className="ln-banner">
      <div className="ln-banner-left">
        <span className="ln-live-dot">●</span>
        <span className="ln-banner-title">LIVE UNIFIED ARCHIVE</span>
        <span className="ln-banner-tagline">· Track every volume, every chapter, every world</span>
      </div>
      <Link href="/search" className="ln-banner-btn">SEARCH NOVELS →</Link>
    </div>
  );
}

// ─── Continue Reading ─────────────────────────────────────────────────────────
// Shows novels where user has read at least 1 chapter (current_chapter > 0)
// across ALL statuses (not just "reading") — catches paused, completed, etc.

async function ContinueReading() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: novels } = await supabase
    .from("novels")
    .select("id, title, cover_url, source_url, current_chapter, total_chapters, status")
    .eq("user_id", user.id)
    .gt("current_chapter", 0)          // at least 1 chapter read
    .order("created_at", { ascending: false })
    .limit(10);

  if (!novels || novels.length === 0) return null;

  return (
    <section className="ln-section">
      <div className="ln-section-header">
        <span className="ln-pill">CONTINUE</span>
        <h2 className="ln-section-title">Continue Reading</h2>
        <Link href="/library" className="ln-see-all">View all →</Link>
      </div>
      <div className="ln-continue-grid">
        {novels.map((novel) => (
          <Link
            key={novel.id}
            href={`/novel?url=${encodeURIComponent(novel.source_url)}&id=${novel.id}`}
            className="ln-continue-card"
          >
            {/* Cover */}
            <div className="ln-continue-cover">
              {novel.cover_url ? (
                <img src={proxyImg(novel.cover_url)} alt={novel.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <div className="ln-card-no-img">
                  <span className="ln-card-art-text">{novel.title.slice(0, 2).toUpperCase()}</span>
                </div>
              )}
              <div className="ln-card-overlay" />
            </div>
            {/* Info */}
            <div className="ln-continue-info">
              <p className="ln-continue-title">{novel.title}</p>
              <p className="ln-continue-ch">
                Ch.{novel.current_chapter}
                {novel.total_chapters > 0 ? ` / ${novel.total_chapters}` : ""}
              </p>
              {/* Progress bar */}
              {novel.total_chapters > 0 && (
                <div className="ln-continue-bar">
                  <div
                    className="ln-continue-bar-fill"
                    style={{ width: `${Math.min(100, Math.round((novel.current_chapter / novel.total_chapters) * 100))}%` }}
                  />
                </div>
              )}
              <span className="ln-continue-cta">Continue →</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── Trending Novels ──────────────────────────────────────────────────────────

async function TrendingNovels() {
  let novels: { title: string; cover_url: string; source_url: string }[] = [];
  try {
    const res = await fetch("https://novelfull.net/most-popular", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      next: { revalidate: 3600 },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    $(".list-truyen .row").each((_, el) => {
      const titleEl = $(el).find("h3.truyen-title a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href") || "";
      const cover = $(el).find("img").attr("src") || "";
      if (title && link && novels.length < 10) {
        novels.push({
          title,
          cover_url: cover.startsWith("http") ? cover : `https://novelfull.net${cover}`,
          source_url: `https://novelfull.net${link}`,
        });
      }
    });
  } catch { novels = []; }

  if (novels.length === 0) return null;

  return (
    <section className="ln-section">
      <div className="ln-section-header">
        <span className="ln-pill">TRENDING</span>
        <h2 className="ln-section-title">Popular Light Novels</h2>
        <Link href="/search" className="ln-see-all">Search more →</Link>
      </div>
      <div className="ln-grid">
        {novels.map((n) => (
          <Link key={n.source_url} href={`/novel?url=${encodeURIComponent(n.source_url)}`} style={{ textDecoration: "none" }}>
            <div className="ln-card">
              <div className="ln-card-img">
                {n.cover_url ? (
                  <img src={proxyImg(n.cover_url)} alt={n.title}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <div className="ln-card-no-img">
                    <span className="ln-card-art-text">{n.title.slice(0, 3).toUpperCase()}</span>
                  </div>
                )}
                <div className="ln-card-overlay" />
              </div>
              <p className="ln-card-title">{n.title.toUpperCase()}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
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

        /* ── Hero ── */
        .ln-hero { position: relative; min-height: 100vh; display: flex; align-items: center; padding-top: 60px; overflow: hidden; }
        .ln-hero-bg-img {
          position: absolute; inset: 0;
          background-size: cover; background-position: center 30%;
          filter: brightness(0.35) saturate(0.8);
        }
        .ln-hero-overlay-left {
          position: absolute; inset: 0;
          background: linear-gradient(to right, #080808 40%, rgba(8,8,8,0.5) 70%, rgba(8,8,8,0.1) 100%);
        }
        .ln-hero-overlay-bottom {
          position: absolute; inset: 0;
          background: linear-gradient(to top, #080808 0%, transparent 35%);
        }
        .ln-hero-overlay-vignette {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse 120% 100% at 70% 50%, rgba(200,169,110,0.04), transparent 60%);
        }
        .ln-hero-content { position: relative; z-index: 2; max-width: 1400px; margin: 0 auto; padding: 120px 32px 100px; width: 100%; }
        .ln-hero-left { max-width: 580px; }
        .ln-hero-label { font-size: 11px; letter-spacing: 0.25em; color: #c8a96e; text-transform: uppercase; margin-bottom: 24px; }
        .ln-hero-title { font-size: clamp(52px, 7vw, 96px); font-weight: 700; line-height: 0.95; color: #fff; margin-bottom: 24px; letter-spacing: -0.02em; }
        .ln-hero-synopsis { font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.55); max-width: 460px; margin-bottom: 40px; }
        .ln-hero-actions { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
        .ln-cta-btn { background: #c8a96e; color: #080808; text-decoration: none; border-radius: 4px; padding: 14px 32px; font-size: 12px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; display: flex; gap: 8px; align-items: center; transition: background 0.2s; }
        .ln-cta-btn:hover { background: #d4b87a; }
        .ln-cta-ghost { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 2px; transition: color 0.2s; }
        .ln-cta-ghost:hover { color: #fff; }

        /* ── Banner ── */
        .ln-banner { background: rgba(200,169,110,0.07); border-top: 1px solid rgba(200,169,110,0.2); border-bottom: 1px solid rgba(200,169,110,0.2); padding: 14px 32px; display: flex; align-items: center; justify-content: space-between; }
        .ln-banner-left { display: flex; align-items: center; gap: 10px; font-size: 12px; letter-spacing: 0.12em; }
        .ln-live-dot { color: #c8a96e; font-size: 10px; animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        .ln-banner-title { color: #c8a96e; font-weight: 700; letter-spacing: 0.2em; }
        .ln-banner-tagline { color: rgba(255,255,255,0.35); font-style: italic; }
        .ln-banner-btn { background: transparent; border: 1px solid #c8a96e44; color: #c8a96e; border-radius: 4px; padding: 8px 18px; font-size: 11px; font-weight: 700; text-decoration: none; letter-spacing: 0.18em; transition: border-color 0.2s; }
        .ln-banner-btn:hover { border-color: #c8a96e; }

        /* ── Sections ── */
        .ln-section { max-width: 1400px; margin: 0 auto; padding: 64px 32px; }
        .ln-section-header { display: flex; align-items: baseline; gap: 20px; margin-bottom: 32px; }
        .ln-pill { background: rgba(200,169,110,0.15); color: #c8a96e; border: 1px solid rgba(200,169,110,0.3); border-radius: 20px; padding: 4px 12px; font-size: 10px; letter-spacing: 0.2em; font-weight: 700; text-transform: uppercase; white-space: nowrap; }
        .ln-section-title { font-size: clamp(24px, 3vw, 36px); font-weight: 700; color: #fff; letter-spacing: -0.01em; flex: 1; }
        .ln-see-all { color: rgba(255,255,255,0.35); font-size: 13px; text-decoration: none; letter-spacing: 0.08em; white-space: nowrap; transition: color 0.2s; }
        .ln-see-all:hover { color: #c8a96e; }

        /* ── Continue Reading grid — horizontal scroll cards ── */
        .ln-continue-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 16px;
        }
        .ln-continue-card {
          display: flex; gap: 16px; align-items: flex-start;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 10px; padding: 14px;
          text-decoration: none; color: inherit;
          transition: background 0.2s, border-color 0.2s, transform 0.2s;
        }
        .ln-continue-card:hover { background: rgba(200,169,110,0.06); border-color: rgba(200,169,110,0.25); transform: translateY(-2px); }
        .ln-continue-cover {
          position: relative; flex-shrink: 0;
          width: 70px; height: 100px;
          border-radius: 6px; overflow: hidden;
          background: #111; border: 1px solid rgba(255,255,255,0.06);
        }
        .ln-continue-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .ln-continue-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; padding-top: 2px; }
        .ln-continue-title { font-size: 13px; font-weight: 700; color: #e8e8e8; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .ln-continue-card:hover .ln-continue-title { color: #c8a96e; }
        .ln-continue-ch { font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 0.08em; }
        .ln-continue-bar { width: 100%; height: 2px; background: rgba(255,255,255,0.08); border-radius: 2px; margin-top: 2px; }
        .ln-continue-bar-fill { height: 100%; background: #c8a96e; border-radius: 2px; }
        .ln-continue-cta { font-size: 11px; color: #c8a96e; letter-spacing: 0.1em; margin-top: auto; padding-top: 4px; }

        /* ── Trending grid ── */
        .ln-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; }
        .ln-card { cursor: pointer; }
        .ln-card-img { position: relative; width: 100%; aspect-ratio: 2/3; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.06); transition: transform 0.3s ease, box-shadow 0.3s ease; background: #111; }
        .ln-card:hover .ln-card-img { transform: translateY(-6px); box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
        .ln-card-no-img { width: 100%; height: 100%; background: linear-gradient(135deg,#1a0d2e,#2d1b4e); display: flex; align-items: center; justify-content: center; }
        .ln-card-art-text { font-size: 32px; font-weight: 900; color: rgba(255,255,255,0.1); letter-spacing: 0.1em; }
        .ln-card-overlay { position: absolute; bottom: 0; left: 0; right: 0; height: 40%; background: linear-gradient(to top, rgba(0,0,0,0.75), transparent); pointer-events: none; }
        .ln-badge-vol { position: absolute; bottom: 8px; left: 8px; color: rgba(255,255,255,0.8); font-size: 10px; letter-spacing: 0.08em; z-index: 2; }
        .ln-card-title { margin-top: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: rgba(255,255,255,0.75); line-height: 1.3; }

        .ln-footer { border-top: 1px solid rgba(255,255,255,0.06); padding: 32px; text-align: center; color: rgba(255,255,255,0.2); font-size: 12px; letter-spacing: 0.1em; }

        /* ── Mobile hamburger + drawer (CSS-only checkbox hack) ── */
        .ln-menu-toggle { display: none; }
        .ln-hamburger { display: none; flex-direction: column; justify-content: center; gap: 5px; cursor: pointer; padding: 4px; width: 36px; height: 36px; flex-shrink: 0; }
        .ln-hamburger span { display: block; height: 2px; background: #e8e8e8; border-radius: 2px; transition: all 0.25s; }
        .ln-menu-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 150; backdrop-filter: blur(2px); }
        .ln-drawer { position: fixed; top: 0; left: 0; bottom: 0; width: 280px; max-width: 85vw; background: #111; z-index: 200; transform: translateX(-100%); transition: transform 0.3s ease; display: flex; flex-direction: column; }
        .ln-drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 0 20px; height: 60px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ln-drawer-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; color: #fff; font-size: 17px; font-weight: 700; letter-spacing: 0.15em; }
        .ln-drawer-close { color: rgba(255,255,255,0.4); font-size: 22px; cursor: pointer; line-height: 1; padding: 4px; }
        .ln-drawer-body { flex: 1; overflow-y: auto; padding: 16px 0; }
        .ln-drawer-link { display: block; padding: 14px 24px; color: rgba(255,255,255,0.7); text-decoration: none; font-size: 15px; letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.04); transition: color 0.15s; }
        .ln-drawer-link:hover { color: #c8a96e; }
        .ln-drawer-search { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.06); }
        .ln-drawer-search-form { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 8px 14px; }
        .ln-drawer-search-input { background: transparent; border: none; outline: none; color: rgba(255,255,255,0.75); font-size: 14px; font-family: 'Georgia', serif; flex: 1; }
        .ln-drawer-search-input::placeholder { color: rgba(255,255,255,0.3); }
        .ln-drawer-foot { padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.06); }
        .ln-drawer-email { font-size: 11px; color: rgba(255,255,255,0.25); letter-spacing: 0.06em; margin-bottom: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ln-drawer-signout { width: 100%; background: rgba(248,113,113,0.08); border: 1px solid rgba(248,113,113,0.2); color: #f87171; border-radius: 6px; padding: 10px; font-family: 'Georgia', serif; font-size: 13px; cursor: pointer; letter-spacing: 0.08em; }
        .ln-drawer-signin { display: block; text-align: center; background: #c8a96e; color: #080808; text-decoration: none; border-radius: 6px; padding: 11px; font-weight: 700; font-size: 13px; letter-spacing: 0.1em; }
        /* Checkbox toggles drawer open */
        .ln-menu-toggle:checked ~ .ln-menu-overlay { display: block; }
        .ln-menu-toggle:checked ~ .ln-drawer { transform: translateX(0); }

        @media (max-width: 1024px) {
          .ln-grid { grid-template-columns: repeat(3, 1fr); }
          .ln-continue-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 768px) {
          .ln-hamburger { display: flex; }
          .ln-nav-links { display: none; }
          .ln-nav-right .ln-inline-search { display: none; }
          .ln-nav-inner { padding: 0 16px; gap: 12px; }
        }
        @media (max-width: 640px) {
          .ln-grid { grid-template-columns: repeat(2, 1fr); }
          .ln-banner { flex-direction: column; align-items: flex-start; gap: 10px; padding: 14px 16px; }
          .ln-banner-tagline { display: none; }
          .ln-hero { min-height: 85vh; }
          .ln-hero-content { padding: 60px 16px 50px; }
          .ln-hero-title { font-size: clamp(38px, 11vw, 60px); }
          .ln-hero-synopsis { font-size: 14px; margin-bottom: 28px; }
          .ln-hero-actions { flex-direction: column; align-items: flex-start; gap: 12px; }
          .ln-cta-btn { width: 100%; justify-content: center; }
          .ln-continue-grid { grid-template-columns: 1fr; }
          .ln-section { padding: 40px 16px; }
          .ln-section-header { flex-wrap: wrap; gap: 10px; }
          .ln-footer { padding: 24px 16px; }
        }
      `}</style>

      <Suspense><NavBar /></Suspense>

      <main>
        <Hero />
        <ArchiveBanner />
        <Suspense fallback={null}><ContinueReading /></Suspense>
        <Suspense fallback={
          <section className="ln-section">
            <div className="ln-section-header">
              <span className="ln-pill">TRENDING</span>
              <h2 className="ln-section-title">Popular Light Novels</h2>
            </div>
            <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "13px", letterSpacing: "0.1em" }}>Loading novels…</p>
          </section>
        }>
          <TrendingNovels />
        </Suspense>
      </main>

      <footer className="ln-footer">
        ⬡ SHELF · Your personal light novel archive · 2025
      </footer>
    </>
  );
}