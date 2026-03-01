// components/SiteNav.tsx
// Shared nav used across library, search, novel pages.
// Client component — reads auth state via browser Supabase client.
// For the homepage, the server-component NavBar is used instead (same visual result).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Optional back button shown on novel page
interface SiteNavProps {
  backButton?: { label: string; onClick: () => void };
}

export default function SiteNav({ backButton }: SiteNavProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    setMounted(true);
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
    });
  }, []);

  async function handleSignOut() {
    await fetch("/auth/signout", { method: "POST" });
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
        @media(max-width:768px){.sn-links{display:none;}.sn-search-input{width:120px;}}
        @media(max-width:480px){.sn-search-form{display:none;}}
      `}</style>

      <nav className="sn-nav">
        <div className="sn-inner">
          {/* Logo */}
          <Link href="/" className="sn-logo">
            <span className="sn-logo-icon">⬡</span>
            <span className="sn-logo-text">SHELF</span>
          </Link>

          {/* Nav links */}
          <div className="sn-links">
            <Link href="/library" className="sn-link">Library</Link>
            <Link href="/search" className="sn-link">Search</Link>
          </div>

          <div className="sn-right">
            {/* Search bar */}
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

            {/* Auth — only render after mount to avoid hydration flash */}
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
    </>
  );
}