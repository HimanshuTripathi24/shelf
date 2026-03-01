"use client";

import { useEffect, useState, Suspense, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SiteNav from "../components/SiteNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type Chapter = { number: number; title: string; url: string };
type NovelInfo = {
  title: string; author: string; cover_url: string; synopsis: string;
  chapters: Chapter[]; source: string; totalPages: number; currentPage: number;
};
type ReadStatus = Set<number>;

const CHAPTERS_PER_PAGE = 100;

// ─── Image helper ─────────────────────────────────────────────────────────────
// The scraper already proxies cover_url as /api/image?url=.... Unwrap first
// to avoid double-proxying which breaks image loading.
function proxiedUrl(url: string): string {
  if (!url) return "";
  try {
    if (url.startsWith("/api/image?url=")) {
      const raw = decodeURIComponent(url.slice("/api/image?url=".length));
      return `/api/image?url=${encodeURIComponent(raw)}`;
    }
    const u = new URL(url);
    if (u.pathname === "/api/image" && u.searchParams.get("url")) {
      return `/api/image?url=${encodeURIComponent(u.searchParams.get("url")!)}`;
    }
  } catch {}
  return `/api/image?url=${encodeURIComponent(url)}`;
}

// ─── Main Content ─────────────────────────────────────────────────────────────

function NovelDetailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const sourceUrl = mounted ? (searchParams.get("url") || "") : null;
  const novelId = mounted ? (searchParams.get("id") || "") : "";

  const supabase = createClient();

  const [novelMeta, setNovelMeta] = useState<Omit<NovelInfo, "chapters" | "totalPages" | "currentPage"> | null>(null);
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loadedPage, setLoadedPage] = useState(0);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [error, setError] = useState("");

  const [readChapters, setReadChapters] = useState<ReadStatus>(new Set());
  const [chapterSearch, setChapterSearch] = useState("");
  const [selectedChapters, setSelectedChapters] = useState<Set<number>>(new Set());
  const [inLibrary, setInLibrary] = useState(false);
  const [addingToLibrary, setAddingToLibrary] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [dbNovelId, setDbNovelId] = useState<string | null>(novelId || null);
  const [showSynopsis, setShowSynopsis] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; chapter: number } | null>(null);
  const [jumpLoading, setJumpLoading] = useState(false);
  const [jumpStatus, setJumpStatus] = useState<string>("");
  const [continueLoading, setContinueLoading] = useState(false);

  // Refs to avoid stale closures in async loops
  const loadedPageRef = useRef(0);
  const allChaptersRef = useRef<Chapter[]>([]);
  const totalPagesRef = useRef(1);

  // ── Raw page fetcher ────────────────────────────────────────────────────────
  async function fetchPageRaw(page: number) {
    const res = await fetch(`/api/novel?url=${encodeURIComponent(sourceUrl!)}&page=${page}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // ── Merge chapters deduplicating by URL ─────────────────────────────────────
  function mergeChapters(prev: Chapter[], incoming: Chapter[]): Chapter[] {
    const existingUrls = new Set(prev.map(c => c.url));
    const newOnes = incoming.filter(c => !existingUrls.has(c.url));
    return [...prev, ...newOnes].map((c, i) => ({ ...c, number: i + 1 }));
  }

  // ── Standard sequential fetch (Load More button) ────────────────────────────
  async function fetchChapterPage(page: number) {
    if (loadingChapters || !sourceUrl) return;
    setLoadingChapters(true);
    try {
      const data = await fetchPageRaw(page);
      if (page === 1) {
        setNovelMeta({ title: data.title, author: data.author, cover_url: data.cover_url, synopsis: data.synopsis, source: data.source });
        setTotalPages(data.totalPages || 1);
        totalPagesRef.current = data.totalPages || 1;
        setAllChapters(data.chapters || []);
        allChaptersRef.current = data.chapters || [];
        setLoadingMeta(false);
      } else {
        const merged = mergeChapters(allChaptersRef.current, data.chapters || []);
        setAllChapters(merged);
        allChaptersRef.current = merged;
      }
      setLoadedPage(page);
      loadedPageRef.current = page;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setError(msg);
      setLoadingMeta(false);
    } finally {
      setLoadingChapters(false);
    }
  }

  // ── Smart jump: fetch only pages needed to reach target chapter ─────────────
  // Page = Math.max(1, Math.ceil(chapterNum / 100))
  // ch 0-100 → page 1, ch 101-200 → page 2, ch 1293 → page 13, ch 1300 → page 13
  async function jumpToChapter(targetNum: number) {
    if (!sourceUrl || jumpLoading) return;

    // Already loaded — clear search and scroll
    const existing = allChaptersRef.current.find(c => c.number === targetNum);
    if (existing) {
      setChapterSearch("");
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToChapter(targetNum)));
      return;
    }

    setJumpLoading(true);
    setJumpStatus("Fetching…");

    try {
      let acc: Chapter[] = [...allChaptersRef.current];
      let knownTotalPages = totalPagesRef.current;

      // Ensure page 1 is loaded for meta + totalPages
      if (loadedPageRef.current === 0) {
        setJumpStatus("Loading metadata…");
        const data = await fetchPageRaw(1);
        knownTotalPages = data.totalPages || 1;
        totalPagesRef.current = knownTotalPages;
        setTotalPages(knownTotalPages);
        setNovelMeta({ title: data.title, author: data.author, cover_url: data.cover_url, synopsis: data.synopsis, source: data.source });
        setLoadingMeta(false);
        acc = data.chapters || [];
        setLoadedPage(1);
        loadedPageRef.current = 1;
        allChaptersRef.current = acc;
        setAllChapters(acc);
      }

      const targetPage = Math.max(1, Math.ceil(targetNum / CHAPTERS_PER_PAGE));
      const startPage = loadedPageRef.current + 1;
      const endPage = Math.min(targetPage, knownTotalPages);

      if (startPage > endPage) {
        setChapterSearch("");
        setJumpLoading(false);
        setJumpStatus("");
        requestAnimationFrame(() => requestAnimationFrame(() => scrollToChapter(targetNum)));
        return;
      }

      for (let p = startPage; p <= endPage; p++) {
        setJumpStatus(`Loading page ${p}/${endPage}…`);
        const data = await fetchPageRaw(p);
        acc = mergeChapters(acc, data.chapters || []);
        setLoadedPage(p);
        loadedPageRef.current = p;
        allChaptersRef.current = acc;
        setAllChapters([...acc]);
      }

      setChapterSearch("");
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToChapter(targetNum)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Jump failed");
    } finally {
      setJumpLoading(false);
      setJumpStatus("");
    }
  }

  function scrollToChapter(num: number) {
    const el = document.getElementById(`ch-${num}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setTimeout(() => {
        document.getElementById(`ch-${num}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    }
  }

  // ── Continue / Start Reading ─────────────────────────────────────────────────
  // Fetches pages until the next unread chapter is found, then navigates.
  async function handleContinue(e: React.MouseEvent) {
    e.preventDefault();
    if (!novelMeta || continueLoading) return;

    const targetNum = lastReadChapter + 1; // next unread chapter (or ch 1 if never read)
    const targetPage = Math.max(1, Math.ceil(targetNum / CHAPTERS_PER_PAGE));

    // Already loaded — navigate immediately
    const found = allChaptersRef.current.find(c => c.number === targetNum);
    if (found) {
      window.location.href = `/read?url=${encodeURIComponent(found.url)}&novelId=${dbNovelId || ""}&chapter=${found.number}&title=${encodeURIComponent(novelMeta.title)}&novelUrl=${encodeURIComponent(sourceUrl || "")}`;
      return;
    }

    setContinueLoading(true);
    try {
      let acc: Chapter[] = [...allChaptersRef.current];
      const startPage = loadedPageRef.current + 1;
      const endPage = Math.min(targetPage, totalPagesRef.current);

      for (let p = startPage; p <= endPage; p++) {
        const data = await fetchPageRaw(p);
        acc = mergeChapters(acc, data.chapters || []);
        setLoadedPage(p);
        loadedPageRef.current = p;
        allChaptersRef.current = acc;
        setAllChapters([...acc]);

        const ch = acc.find(c => c.number === targetNum);
        if (ch) {
          window.location.href = `/read?url=${encodeURIComponent(ch.url)}&novelId=${dbNovelId || ""}&chapter=${ch.number}&title=${encodeURIComponent(novelMeta.title)}&novelUrl=${encodeURIComponent(sourceUrl || "")}`;
          return;
        }
      }

      // Fallback to first chapter
      const fallback = allChaptersRef.current[0];
      if (fallback) {
        window.location.href = `/read?url=${encodeURIComponent(fallback.url)}&novelId=${dbNovelId || ""}&chapter=${fallback.number}&title=${encodeURIComponent(novelMeta.title)}&novelUrl=${encodeURIComponent(sourceUrl || "")}`;
      }
    } catch (e) {
      console.error("Continue failed:", e);
    } finally {
      setContinueLoading(false);
    }
  }

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    if (!sourceUrl) { setError("No URL provided"); setLoadingMeta(false); return; }
    fetchChapterPage(1);
  }, [mounted, sourceUrl]);

  // ── Load user + library status ──────────────────────────────────────────────
  useEffect(() => {
    if (!sourceUrl) return;
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: existing } = await supabase
        .from("novels").select("id, current_chapter")
        .eq("user_id", user.id).eq("source_url", sourceUrl).single();
      if (existing) {
        setInLibrary(true);
        setDbNovelId(existing.id);
        const readSet = new Set<number>();
        for (let i = 1; i <= (existing.current_chapter || 0); i++) readSet.add(i);
        setReadChapters(readSet);
      }
    }
    loadUser();
  }, [sourceUrl]);

  // ── Library actions ─────────────────────────────────────────────────────────
  async function handleAddToLibrary() {
    if (!novelMeta || !sourceUrl) return;
    if (!userId) {
      // Guest — redirect to sign-in, return here after
      router.push(`/sign-in?redirect=${encodeURIComponent(`/novel?url=${encodeURIComponent(sourceUrl)}`)}`);
      return;
    }
    setAddingToLibrary(true);
    const { data, error } = await supabase.from("novels").insert([{
      user_id: userId, title: novelMeta.title, author: novelMeta.author || "",
      synopsis: novelMeta.synopsis || "", cover_url: novelMeta.cover_url || "",
      source_url: sourceUrl, status: "plan_to_read",
      current_chapter: 0, total_chapters: allChapters.length,
    }]).select().single();
    if (!error && data) { setInLibrary(true); setDbNovelId(data.id); }
    else alert("Error: " + error?.message);
    setAddingToLibrary(false);
  }

  async function handleRemoveFromLibrary() {
    if (!dbNovelId || !confirm("Remove from library? Your progress will be lost.")) return;
    await supabase.from("novels").delete().eq("id", dbNovelId);
    setInLibrary(false); setDbNovelId(null); setReadChapters(new Set());
  }

  // ── Mark read/unread ────────────────────────────────────────────────────────
  async function markChaptersRead(nums: number[]) {
    const newRead = new Set(readChapters);
    nums.forEach(n => newRead.add(n));
    setReadChapters(newRead);
    if (dbNovelId && userId) {
      const maxCh = Math.max(...nums);
      await supabase.from("novels")
        .update({ current_chapter: Math.max(maxCh, readChapters.size), status: "reading", updated_at: new Date().toISOString() })
        .eq("id", dbNovelId);
      await supabase.from("reading_progress").upsert({
        user_id: userId, novel_id: dbNovelId,
        chapter_number: maxCh, last_read_at: new Date().toISOString(),
      }, { onConflict: "user_id,novel_id" });
    }
  }

  async function markAllPreviousRead(num: number) {
    await markChaptersRead(Array.from({ length: num }, (_, i) => i + 1));
    setContextMenu(null); setSelectedChapters(new Set());
  }

  async function markChaptersUnread(nums: number[]) {
    const newRead = new Set(readChapters);
    nums.forEach(n => newRead.delete(n));
    setReadChapters(newRead);
    if (dbNovelId && userId) {
      const maxRemaining = newRead.size > 0 ? Math.max(...newRead) : 0;
      await supabase.from("novels").update({ current_chapter: maxRemaining, updated_at: new Date().toISOString() }).eq("id", dbNovelId);
    }
  }

  function toggleSelect(num: number) {
    const s = new Set(selectedChapters);
    s.has(num) ? s.delete(num) : s.add(num);
    setSelectedChapters(s);
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const isNumericSearch = /^\d+$/.test(chapterSearch.trim()) && parseInt(chapterSearch) >= 0;
  const filteredChapters = chapterSearch
    ? allChapters.filter(ch => {
        const q = chapterSearch.toLowerCase();
        return ch.title.toLowerCase().includes(q) || ch.number.toString().includes(q);
      })
    : allChapters;

  // lastReadChapter = highest chapter marked read
  // nextUnreadNum   = the chapter the user should read next (lastRead + 1, or 1)
  const lastReadChapter = readChapters.size > 0 ? Math.max(...readChapters) : 0;
  const nextUnreadNum = lastReadChapter + 1;
  const hasMorePages = loadedPage < totalPages;

  // ── Loading / error screens ─────────────────────────────────────────────────
  if (!mounted || loadingMeta) return (
    <div style={{ background: "#080808", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontFamily: "Georgia, serif", gap: "20px" }}>
      <div style={{ fontSize: "11px", letterSpacing: "0.25em", textTransform: "uppercase" }}>Fetching Novel…</div>
      <div style={{ display: "flex", gap: "6px" }}>
        {[0, 1, 2].map(i => <span key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#c8a96e", display: "inline-block", animation: `dp 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
      </div>
      <style>{`@keyframes dp{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ background: "#080808", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontFamily: "Georgia, serif", gap: "16px" }}>
      <p style={{ fontSize: "48px" }}>⚠️</p><p>{error}</p>
      <button onClick={() => router.back()} style={{ background: "#c8a96e", color: "#080808", border: "none", padding: "10px 24px", borderRadius: "4px", cursor: "pointer", fontFamily: "Georgia, serif" }}>← Go Back</button>
    </div>
  );

  if (!novelMeta) return null;

  const coverImg = proxiedUrl(novelMeta.cover_url);

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:#080808;color:#e8e8e8;font-family:'Georgia',serif;min-height:100vh}

        .nd-hero{min-height:420px;position:relative;display:flex;align-items:flex-end;padding-top:60px;overflow:hidden}
        .nd-hero-bg{position:absolute;inset:0;background:#080808}
        .nd-hero-bg-blur{position:absolute;inset:0;background-size:cover;background-position:center;filter:blur(40px) brightness(0.2);transform:scale(1.1)}
        .nd-hero-content{position:relative;z-index:2;max-width:1200px;margin:0 auto;width:100%;padding:40px 32px;display:flex;gap:40px;align-items:flex-start}
        .nd-cover{flex-shrink:0;width:180px;height:260px;border-radius:8px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.8);border:1px solid rgba(255,255,255,0.1)}
        .nd-cover img{width:100%;height:100%;object-fit:cover}
        .nd-cover-placeholder{width:100%;height:100%;background:linear-gradient(135deg,#1a0d2e,#2d1b4e);display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:900;color:rgba(255,255,255,0.1)}
        .nd-meta{flex:1}
        .nd-source-badge{display:inline-block;font-size:10px;letter-spacing:0.15em;background:rgba(200,169,110,0.1);color:#c8a96e;border:1px solid rgba(200,169,110,0.2);border-radius:20px;padding:3px 12px;text-transform:uppercase;margin-bottom:14px}
        .nd-title{font-size:clamp(24px,4vw,44px);font-weight:700;letter-spacing:-0.02em;line-height:1.1;margin-bottom:10px}
        .nd-author{font-size:13px;color:rgba(255,255,255,0.4);letter-spacing:0.1em;margin-bottom:12px;text-transform:uppercase}
        .nd-stats{display:flex;gap:20px;margin-bottom:20px;flex-wrap:wrap}
        .nd-stat{font-size:12px;color:rgba(255,255,255,0.3);letter-spacing:0.08em}
        .nd-stat span{color:rgba(255,255,255,0.7);font-weight:700}
        .nd-synopsis{font-size:13px;line-height:1.7;color:rgba(255,255,255,0.5);max-width:600px;margin-bottom:24px}
        .nd-synopsis-clamped{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
        .nd-read-more{color:#c8a96e;font-size:12px;margin-top:4px;cursor:pointer;background:none;border:none;font-family:'Georgia',serif;padding:0}
        .nd-actions{display:flex;gap:12px;flex-wrap:wrap}
        .btn-gold{background:#c8a96e;color:#080808;border:none;border-radius:4px;padding:11px 24px;font-size:12px;font-family:'Georgia',serif;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;transition:all 0.2s;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
        .btn-gold:hover{background:#dfc07e;transform:translateY(-1px)}
        .btn-gold:disabled{opacity:0.5;cursor:not-allowed;transform:none}
        .btn-outline{background:transparent;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.6);border-radius:4px;padding:11px 24px;font-size:12px;font-family:'Georgia',serif;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;transition:all 0.2s;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
        .btn-outline:hover{border-color:rgba(255,255,255,0.35);color:#fff}
        .btn-danger{background:transparent;border:1px solid rgba(248,113,113,0.2);color:rgba(248,113,113,0.6);border-radius:4px;padding:11px 24px;font-size:12px;font-family:'Georgia',serif;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;transition:all 0.2s}
        .btn-danger:hover{border-color:#f87171;color:#f87171}
        .btn-green{background:rgba(74,222,128,0.1);border:1px solid rgba(74,222,128,0.3);color:#4ade80;border-radius:4px;padding:11px 24px;font-size:12px;font-family:'Georgia',serif;letter-spacing:0.12em;text-transform:uppercase}
        .nd-chapters{max-width:1200px;margin:0 auto;padding:40px 32px 80px}
        .nd-chapters-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px}
        .nd-chapters-title{font-size:20px;font-weight:700}
        .nd-chapters-count{font-size:12px;color:rgba(255,255,255,0.3);letter-spacing:0.1em;margin-top:4px}
        .nd-search-wrap{display:flex;align-items:center;gap:8px}
        .nd-ch-search{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:9px 16px;color:#fff;font-size:13px;font-family:'Georgia',serif;outline:none;width:220px;transition:border-color 0.2s}
        .nd-ch-search:focus{border-color:rgba(200,169,110,0.5)}
        .nd-ch-search::placeholder{color:rgba(255,255,255,0.2)}
        .nd-jump-btn{background:rgba(200,169,110,0.15);border:1px solid rgba(200,169,110,0.35);color:#c8a96e;border-radius:4px;padding:9px 14px;font-size:11px;font-family:'Georgia',serif;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;transition:all 0.2s;white-space:nowrap}
        .nd-jump-btn:hover:not(:disabled){background:rgba(200,169,110,0.25)}
        .nd-jump-btn:disabled{opacity:0.5;cursor:not-allowed}
        .nd-jump-status{font-size:11px;color:#c8a96e;letter-spacing:0.08em;animation:pulse 1s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:0.5}50%{opacity:1}}
        .nd-selection-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:200;background:#1a1400;border:1px solid rgba(200,169,110,0.4);border-radius:12px;padding:12px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 8px 32px rgba(0,0,0,0.7);backdrop-filter:blur(12px);white-space:nowrap}
        .nd-selection-info{font-size:13px;color:#c8a96e;letter-spacing:0.08em}
        .nd-sel-btn{background:rgba(200,169,110,0.15);border:1px solid rgba(200,169,110,0.3);color:#c8a96e;border-radius:4px;padding:6px 14px;font-size:11px;font-family:'Georgia',serif;letter-spacing:0.1em;cursor:pointer;transition:all 0.2s;text-transform:uppercase}
        .nd-sel-btn:hover{background:rgba(200,169,110,0.25)}
        .nd-sel-clear{background:none;border:none;color:rgba(255,255,255,0.3);cursor:pointer;font-size:12px;font-family:'Georgia',serif}
        .nd-sel-clear:hover{color:#fff}
        .nd-ch-list{display:flex;flex-direction:column;gap:2px}
        .nd-ch-item{display:flex;align-items:center;gap:12px;padding:10px 16px;border-radius:6px;transition:all 0.15s;border:1px solid transparent}
        .nd-ch-item:hover{background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.06)}
        .nd-ch-item.read{opacity:0.4}
        .nd-ch-item.selected{background:rgba(200,169,110,0.07);border-color:rgba(200,169,110,0.2)}
        .nd-ch-item.current-ch{border-color:rgba(200,169,110,0.3);background:rgba(200,169,110,0.05)}
        .nd-ch-checkbox{width:16px;height:16px;border-radius:3px;border:1px solid rgba(255,255,255,0.15);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all 0.15s;cursor:pointer}
        .nd-ch-item.selected .nd-ch-checkbox,.nd-ch-checkbox.checked{background:#c8a96e;border-color:#c8a96e}
        .nd-ch-num{font-size:11px;color:rgba(255,255,255,0.25);letter-spacing:0.06em;width:50px;flex-shrink:0;font-variant-numeric:tabular-nums}
        .nd-ch-title{flex:1;font-size:13px;color:rgba(255,255,255,0.75);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .nd-ch-item.read .nd-ch-title{color:rgba(255,255,255,0.3);text-decoration:line-through}
        .nd-ch-read-badge{font-size:9px;color:#4ade80;letter-spacing:0.1em;text-transform:uppercase;flex-shrink:0}
        .nd-ch-open-btn{background:none;border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.3);border-radius:3px;padding:4px 10px;font-size:10px;font-family:'Georgia',serif;letter-spacing:0.1em;cursor:pointer;transition:all 0.2s;text-decoration:none;text-transform:uppercase;flex-shrink:0}
        .nd-ch-open-btn:hover{border-color:#c8a96e;color:#c8a96e}
        .nd-load-more-wrap{display:flex;justify-content:center;align-items:center;gap:16px;margin-top:32px;flex-wrap:wrap}
        .nd-load-more-btn{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);border-radius:4px;padding:12px 32px;font-size:12px;font-family:'Georgia',serif;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;transition:all 0.2s}
        .nd-load-more-btn:hover:not(:disabled){border-color:#c8a96e;color:#c8a96e}
        .nd-load-more-btn:disabled{opacity:0.4;cursor:not-allowed}
        .nd-context-menu{position:fixed;z-index:500;background:#1a1a1a;border:1px solid rgba(255,255,255,0.12);border-radius:8px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.8);min-width:220px}
        .nd-ctx-item{padding:12px 18px;font-size:13px;cursor:pointer;transition:background 0.15s;border:none;background:none;color:#e8e8e8;width:100%;text-align:left;font-family:'Georgia',serif;display:block}
        .nd-ctx-item:hover{background:rgba(200,169,110,0.1);color:#c8a96e}
        .nd-ctx-divider{height:1px;background:rgba(255,255,255,0.06)}
        .nd-chapter-loading{display:flex;align-items:center;gap:8px;color:rgba(255,255,255,0.3);font-size:12px;letter-spacing:0.1em}
        @media(max-width:640px){
          .nd-hero-content{flex-direction:column;padding:24px 16px;gap:20px}
          .nd-cover{width:100px;height:150px}
          .nd-meta h1{font-size:20px}
          .nd-synopsis{font-size:13px;-webkit-line-clamp:3}
          .nd-actions{gap:8px}
          .btn-primary,.btn-outline{padding:9px 14px;font-size:11px}
          .nd-chapters{padding:24px 16px 80px}
          .nd-chapters-header{flex-direction:column;align-items:flex-start;gap:12px}
          .nd-search-wrap{width:100%}
          .nd-ch-search{flex:1;width:100%}
          .nd-selection-bar{left:12px;right:12px;transform:none;flex-wrap:wrap;gap:8px;bottom:12px}
          .nd-sel-btn{font-size:10px;padding:5px 10px}
          .nd-stats{gap:12px}
        }
      `}</style>

      {contextMenu && <div style={{ position: "fixed", inset: 0, zIndex: 499 }} onClick={() => setContextMenu(null)} />}
      {contextMenu && (
        <div className="nd-context-menu" style={{ top: contextMenu.y, left: Math.min(contextMenu.x, window.innerWidth - 240) }}>
          {readChapters.has(contextMenu.chapter) ? (
            <>
              <button className="nd-ctx-item" onClick={() => { markChaptersUnread([contextMenu.chapter]); setContextMenu(null); }}>↩ Mark as Unread</button>
              <button className="nd-ctx-item" onClick={() => { markChaptersUnread(Array.from({ length: contextMenu.chapter }, (_, i) => i + 1)); setContextMenu(null); }}>↩ Mark All Previous Unread</button>
            </>
          ) : (
            <>
              <button className="nd-ctx-item" onClick={() => { markChaptersRead([contextMenu.chapter]); setContextMenu(null); }}>✓ Mark as Read</button>
              <button className="nd-ctx-item" onClick={() => markAllPreviousRead(contextMenu.chapter)}>✓ Mark All Previous as Read</button>
            </>
          )}
          <div className="nd-ctx-divider" />
          <button className="nd-ctx-item" onClick={() => {
            const ch = allChapters.find(c => c.number === contextMenu.chapter);
            if (ch) window.open(ch.url, "_blank");
            setContextMenu(null);
          }}>↗ Open Chapter Source</button>
          <div className="nd-ctx-divider" />
          <button className="nd-ctx-item" style={{ color: "rgba(255,255,255,0.3)" }} onClick={() => setContextMenu(null)}>Cancel</button>
        </div>
      )}

      <SiteNav backButton={{ label: "Back", onClick: () => router.back() }} />

      <div className="nd-hero">
        <div className="nd-hero-bg" />
        {coverImg && <div className="nd-hero-bg-blur" style={{ backgroundImage: `url(${coverImg})` }} />}
        <div className="nd-hero-content">
          <div className="nd-cover">
            {coverImg
              ? <img src={coverImg} alt={novelMeta.title} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              : <div className="nd-cover-placeholder">{novelMeta.title.slice(0, 2).toUpperCase()}</div>
            }
          </div>
          <div className="nd-meta">
            <span className="nd-source-badge">{novelMeta.source}</span>
            <h1 className="nd-title">{novelMeta.title}</h1>
            <p className="nd-author">{novelMeta.author || "Unknown Author"}</p>
            <div className="nd-stats">
              <div className="nd-stat"><span>{allChapters.length}</span>{totalPages > 1 ? `+ of ${totalPages} pages` : ""} Chapters</div>
              {lastReadChapter > 0 && <div className="nd-stat">Next Unread <span>Ch.{nextUnreadNum}</span></div>}
              <div className="nd-stat">Source: <a href={sourceUrl ?? undefined} target="_blank" rel="noreferrer" style={{ color: "#c8a96e", textDecoration: "none" }}>View ↗</a></div>
            </div>
            {novelMeta.synopsis && (
              <div className="nd-synopsis">
                <p className={showSynopsis ? "" : "nd-synopsis-clamped"}>{novelMeta.synopsis}</p>
                <button className="nd-read-more" onClick={() => setShowSynopsis(s => !s)}>
                  {showSynopsis ? "Show less ↑" : "Read more ↓"}
                </button>
              </div>
            )}
            <div className="nd-actions">
              {allChapters.length > 0 && (
                <button className="btn-gold" onClick={handleContinue} disabled={continueLoading}>
                  {continueLoading ? "Loading…" : lastReadChapter > 0 ? `▶ Continue Ch.${nextUnreadNum}` : "▶ Start Reading"}
                </button>
              )}
              {inLibrary ? (
                <>
                  <span className="btn-green">✓ In Library</span>
                  <button className="btn-danger" onClick={handleRemoveFromLibrary}>Remove</button>
                </>
              ) : (
                <button className="btn-outline" onClick={handleAddToLibrary} disabled={addingToLibrary}>
                  {addingToLibrary ? "Adding..." : userId ? "+ Add to Library" : "Sign In to Add"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="nd-chapters">
        <div className="nd-chapters-header">
          <div>
            <h2 className="nd-chapters-title">Chapters</h2>
            <p className="nd-chapters-count">
              {allChapters.length} loaded · {readChapters.size} read
              {totalPages > 1 && ` · Page ${loadedPage}/${totalPages}`}
              {chapterSearch && ` · ${filteredChapters.length} matching`}
            </p>
          </div>
          <div className="nd-search-wrap">
            <input
              className="nd-ch-search"
              placeholder="Search or jump to ch #…"
              value={chapterSearch}
              onChange={e => setChapterSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && isNumericSearch) jumpToChapter(parseInt(chapterSearch.trim())); }}
            />
            {isNumericSearch && (
              <button className="nd-jump-btn" disabled={jumpLoading} onClick={() => jumpToChapter(parseInt(chapterSearch.trim()))}>
                {jumpLoading ? "…" : "Jump →"}
              </button>
            )}
            {jumpLoading && jumpStatus && <span className="nd-jump-status">{jumpStatus}</span>}
          </div>
        </div>

        {selectedChapters.size > 0 && (() => {
          const selArr = Array.from(selectedChapters);
          const allRead = selArr.every(n => readChapters.has(n));
          return (
            <div className="nd-selection-bar">
              <p className="nd-selection-info">{selectedChapters.size} chapter{selectedChapters.size > 1 ? "s" : ""} selected</p>
              {allRead ? (
                <>
                  <button className="nd-sel-btn" onClick={() => { markChaptersUnread(selArr); setSelectedChapters(new Set()); }}>↩ Mark as Unread</button>
                  <button className="nd-sel-btn" onClick={() => { markChaptersUnread(Array.from({ length: Math.max(...selArr) }, (_, i) => i + 1)); setSelectedChapters(new Set()); }}>↩ Mark All Previous Unread</button>
                </>
              ) : (
                <>
                  <button className="nd-sel-btn" onClick={() => { markChaptersRead(selArr); setSelectedChapters(new Set()); }}>✓ Mark as Read</button>
                  <button className="nd-sel-btn" onClick={() => { markAllPreviousRead(Math.max(...selArr)); setSelectedChapters(new Set()); }}>✓ Mark All Previous</button>
                </>
              )}
              <button className="nd-sel-clear" onClick={() => setSelectedChapters(new Set())}>✕</button>
            </div>
          );
        })()}

        <div className="nd-ch-list">
          {filteredChapters.length === 0 && !loadingChapters && !jumpLoading && (
            <p style={{ color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "40px", fontSize: "14px" }}>
              {chapterSearch
                ? isNumericSearch
                  ? `Chapter ${chapterSearch} not loaded yet — press Jump → to fetch it`
                  : "No chapters match your search"
                : "No chapters found"}
            </p>
          )}
          {filteredChapters.map(ch => (
            <div
              key={ch.url}
              id={`ch-${ch.number}`}
              className={["nd-ch-item", readChapters.has(ch.number) ? "read" : "", selectedChapters.has(ch.number) ? "selected" : "", ch.number === nextUnreadNum ? "current-ch" : ""].join(" ")}
              onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, chapter: ch.number }); }}
            >
              <div className={`nd-ch-checkbox ${selectedChapters.has(ch.number) ? "checked" : ""}`} onClick={() => toggleSelect(ch.number)}>
                {selectedChapters.has(ch.number) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#080808" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
              </div>
              <span className="nd-ch-num">Ch.{ch.number}</span>
              <span className="nd-ch-title" onClick={() => toggleSelect(ch.number)}>{ch.title}</span>
              {readChapters.has(ch.number) && <span className="nd-ch-read-badge">✓</span>}
              <a
                href={`/read?url=${encodeURIComponent(ch.url)}&novelId=${dbNovelId || ""}&chapter=${ch.number}&title=${encodeURIComponent(novelMeta.title)}&novelUrl=${encodeURIComponent(sourceUrl || "")}`}
                className="nd-ch-open-btn"
                onClick={e => e.stopPropagation()}
              >Read →</a>
            </div>
          ))}
        </div>

        {!chapterSearch && (
          <div className="nd-load-more-wrap">
            {hasMorePages && (
              <button className="nd-load-more-btn" disabled={loadingChapters || jumpLoading} onClick={() => fetchChapterPage(loadedPage + 1)}>
                {loadingChapters ? "Loading…" : `Load Next Page (${loadedPage + 1}/${totalPages})`}
              </button>
            )}
            {(loadingChapters || jumpLoading) && (
              <div className="nd-chapter-loading">
                <span style={{ color: "#c8a96e" }}>●</span> {jumpStatus || "Loading chapters…"}
              </div>
            )}
            {!hasMorePages && allChapters.length > 0 && totalPages > 1 && (
              <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "12px", letterSpacing: "0.1em" }}>All {allChapters.length} chapters loaded</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function NovelDetailPage() {
  return (
    <Suspense fallback={
      <div style={{ background: "#080808", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontFamily: "Georgia, serif", letterSpacing: "0.2em" }}>
        LOADING...
      </div>
    }>
      <NovelDetailContent />
    </Suspense>
  );
}