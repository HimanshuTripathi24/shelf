// components/SiteNav.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface SiteNavProps {
  backButton?: { label: string; onClick: () => void };
}

export default function SiteNav({ backButton }: SiteNavProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    setMounted(true);
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });
  }, []);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [router]);

  // Prevent body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [drawerOpen]);

  async function handleSignOut() {
    await fetch("/auth/signout", { method: "POST" });
    setDrawerOpen(false);
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <style>{`
        .sn-nav{position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(8,8,8,0.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.06);}
        .sn-inner{max-width:1400px;margin:0 auto;display:flex;align-items:center;gap:28px;padding:0 32px;height:60px;}
        .sn-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:#fff;font-size:18px;font-weight:700;letter-spacing:0.15em;flex-shrink:0;}
        .sn-logo-icon{color:#c8a96e;font-size:22px;}
        .sn-logo-text{letter-spacing:0.3em;}
        .sn-links{display:flex;gap:24px;}
        .sn-link{color:rgba(255,255,255,0.55);text-decoration:none;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;transition:color 0.2s;}
        .sn-link:hover{color:#fff;}
        .sn-link.active{color:#c8a96e;}
        .sn-right{display:flex;align-items:center;gap:14px;margin-left:auto;}
        .sn-search-form{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:6px 14px;}
        .sn-search-input{background:transparent;border:none;outline:none;color:rgba(255,255,255,0.75);font-size:13px;font-family:'Georgia',serif;width:180px;}
        .sn-search-input::placeholder{color:rgba(255,255,255,0.3);}
        .sn-back{color:rgba(255,255,255,0.45);font-size:12px;letter-spacing:0.15em;text-transform:uppercase;background:none;border:none;cursor:pointer;font-family:'Georgia',serif;transition:color 0.2s;display:flex;align-items:center;gap:6px;}
        .sn-back:hover{color:#fff;}
        .sn-avatar-wrap{position:relative;}
        .sn-avatar{background:rgba(255,255,255,0.06);border:1px solid #c8a96e44;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#c8a96e;cursor:pointer;list-style:none;font-family:'Georgia',serif;}
        .sn-avatar::-webkit-details-marker{display:none;}
        .sn-dropdown{position:absolute;top:44px;right:0;background:#1a1a1a;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:8px;min-width:200px;z-index:200;box-shadow:0 10px 40px rgba(0,0,0,0.6);}
        .sn-dropdown-email{font-size:11px;color:rgba(255,255,255,0.3);padding:8px 12px;letter-spacing:0.06em;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .sn-dropdown-item{display:block;padding:10px 12px;font-size:13px;color:rgba(255,255,255,0.7);text-decoration:none;border-radius:6px;transition:all 0.15s;font-family:'Georgia',serif;width:100%;text-align:left;background:none;border:none;cursor:pointer;}
        .sn-dropdown-item:hover{background:rgba(255,255,255,0.06);color:#fff;}
        .sn-signout{color:rgba(248,113,113,0.7);}
        .sn-signout:hover{background:rgba(248,113,113,0.1) !important;color:#f87171 !important;}
        .sn-signin{background:#c8a96e;color:#080808;border:none;border-radius:20px;padding:7px 18px;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:0.08em;white-space:nowrap;}

        /* Hamburger button — hidden on desktop */
        .sn-hamburger{display:none;flex-direction:column;justify-content:center;gap:5px;background:none;border:none;cursor:pointer;padding:4px;width:36px;height:36px;flex-shrink:0;}
        .sn-hamburger span{display:block;height:2px;background:#e8e8e8;border-radius:2px;transition:all 0.25s;}

        /* Mobile drawer overlay */
        .sn-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:150;backdrop-filter:blur(2px);}
        .sn-overlay.open{display:block;}

        /* Mobile drawer */
        .sn-drawer{position:fixed;top:0;left:0;bottom:0;width:280px;max-width:85vw;background:#111;z-index:200;transform:translateX(-100%);transition:transform 0.3s ease;display:flex;flex-direction:column;padding:0;}
        .sn-drawer.open{transform:translateX(0);}
        .sn-drawer-head{display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:60px;border-bottom:1px solid rgba(255,255,255,0.06);}
        .sn-drawer-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:#fff;font-size:17px;font-weight:700;letter-spacing:0.15em;}
        .sn-drawer-close{background:none;border:none;color:rgba(255,255,255,0.4);font-size:22px;cursor:pointer;line-height:1;padding:4px;}
        .sn-drawer-body{flex:1;overflow-y:auto;padding:16px 0;}
        .sn-drawer-link{display:block;padding:14px 24px;color:rgba(255,255,255,0.7);text-decoration:none;font-size:15px;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.04);transition:color 0.15s;}
        .sn-drawer-link:hover{color:#c8a96e;}
        .sn-drawer-search{padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.06);}
        .sn-drawer-search-form{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:8px 14px;}
        .sn-drawer-search-input{background:transparent;border:none;outline:none;color:rgba(255,255,255,0.75);font-size:14px;font-family:'Georgia',serif;flex:1;}
        .sn-drawer-search-input::placeholder{color:rgba(255,255,255,0.3);}
        .sn-drawer-foot{padding:16px 20px;border-top:1px solid rgba(255,255,255,0.06);}
        .sn-drawer-email{font-size:11px;color:rgba(255,255,255,0.25);letter-spacing:0.06em;margin-bottom:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .sn-drawer-signout{width:100%;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);color:#f87171;border-radius:6px;padding:10px;font-family:'Georgia',serif;font-size:13px;cursor:pointer;letter-spacing:0.08em;}
        .sn-drawer-signin{display:block;text-align:center;background:#c8a96e;color:#080808;text-decoration:none;border-radius:6px;padding:11px;font-weight:700;font-size:13px;letter-spacing:0.1em;}

        @media(max-width:768px){
          .sn-links{display:none;}
          .sn-search-form{display:none;}
          .sn-hamburger{display:flex;}
          .sn-inner{padding:0 16px;gap:12px;}
        }
        @media(min-width:769px){
          .sn-hamburger{display:none;}
          .sn-overlay{display:none !important;}
          .sn-drawer{display:none !important;}
        }
      `}</style>

      {/* Main nav bar */}
      <nav className="sn-nav">
        <div className="sn-inner">
          {/* Hamburger — mobile only */}
          <button className="sn-hamburger" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
            <span /><span /><span />
          </button>

          <Link href="/" className="sn-logo">
            <span className="sn-logo-icon">⬡</span>
            <span className="sn-logo-text">SHELF</span>
          </Link>

          {/* Desktop nav links */}
          <div className="sn-links">
            <Link href="/library" className="sn-link">Library</Link>
            <Link href="/search" className="sn-link">Search</Link>
          </div>

          <div className="sn-right">
            {/* Desktop search bar */}
            <form method="get" action="/search" className="sn-search-form">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input name="q" type="text" placeholder="Search novels…" autoComplete="off" className="sn-search-input" />
            </form>

            {/* Back button (novel page only) */}
            {backButton && (
              <button className="sn-back" onClick={backButton.onClick}>
                ← {backButton.label}
              </button>
            )}

            {/* Desktop auth */}
            {mounted && (
              email ? (
                <details className="sn-avatar-wrap">
                  <summary className="sn-avatar" title={email}>
                    {email[0].toUpperCase()}
                  </summary>
                  <div className="sn-dropdown">
                    <p className="sn-dropdown-email">{email}</p>
                    <Link href="/library" className="sn-dropdown-item">📚 My Library</Link>
                    <button className="sn-dropdown-item sn-signout" onClick={handleSignOut}>Sign Out</button>
                  </div>
                </details>
              ) : (
                <Link href="/sign-in" className="sn-signin">Sign In</Link>
              )
            )}
          </div>
        </div>
      </nav>

      {/* Mobile drawer overlay */}
      <div className={`sn-overlay${drawerOpen ? " open" : ""}`} onClick={() => setDrawerOpen(false)} />

      {/* Mobile drawer */}
      <div className={`sn-drawer${drawerOpen ? " open" : ""}`}>
        <div className="sn-drawer-head">
          <Link href="/" className="sn-drawer-logo" onClick={() => setDrawerOpen(false)}>
            <span style={{ color: "#c8a96e" }}>⬡</span>
            <span style={{ letterSpacing: "0.3em" }}>SHELF</span>
          </Link>
          <button className="sn-drawer-close" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>

        <div className="sn-drawer-body">
          {/* Search inside drawer */}
          <div className="sn-drawer-search">
            <form method="get" action="/search" className="sn-drawer-search-form" onSubmit={() => setDrawerOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input name="q" type="text" placeholder="Search novels…" autoComplete="off" className="sn-drawer-search-input" />
            </form>
          </div>

          <Link href="/" className="sn-drawer-link" onClick={() => setDrawerOpen(false)}>Home</Link>
          <Link href="/library" className="sn-drawer-link" onClick={() => setDrawerOpen(false)}>Library</Link>
          <Link href="/search" className="sn-drawer-link" onClick={() => setDrawerOpen(false)}>Search</Link>

          {/* Back button in drawer if on novel page */}
          {backButton && (
            <button className="sn-drawer-link" style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontFamily: "'Georgia',serif" }}
              onClick={() => { setDrawerOpen(false); backButton.onClick(); }}>
              ← {backButton.label}
            </button>
          )}
        </div>

        {/* Auth at bottom of drawer */}
        <div className="sn-drawer-foot">
          {mounted && (
            email ? (
              <>
                <p className="sn-drawer-email">{email}</p>
                <button className="sn-drawer-signout" onClick={handleSignOut}>Sign Out</button>
              </>
            ) : (
              <Link href="/sign-in" className="sn-drawer-signin" onClick={() => setDrawerOpen(false)}>Sign In</Link>
            )
          )}
        </div>
      </div>
    </>
  );
}