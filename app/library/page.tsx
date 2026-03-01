"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SiteNav from "../components/SiteNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type NovelStatus = "reading" | "completed" | "plan_to_read" | "paused" | "dropped";

interface Novel {
  id: string;
  title: string;
  author: string;
  cover_url: string;
  source_url: string;
  status: NovelStatus;
  current_chapter: number;
  total_chapters: number;
  updated_at: string;
}

const STATUS_LABELS: Record<NovelStatus, string> = {
  reading: "Reading",
  completed: "Completed",
  plan_to_read: "Plan to Read",
  paused: "Paused",
  dropped: "Dropped",
};

const STATUS_COLORS: Record<NovelStatus, string> = {
  reading: "#c8a96e",
  completed: "#4ade80",
  plan_to_read: "#60a5fa",
  paused: "#facc15",
  dropped: "#f87171",
};

const FILTER_TABS: { key: "all" | NovelStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "reading", label: "Reading" },
  { key: "plan_to_read", label: "Plan to Read" },
  { key: "completed", label: "Completed" },
  { key: "paused", label: "Paused" },
  { key: "dropped", label: "Dropped" },
];

// ─── Image helper (same as novel page) ───────────────────────────────────────
function proxiedUrl(coverUrl: string, sourceUrl?: string): string {
  if (!coverUrl) return "";
  // Derive a base origin from source_url to resolve relative image paths
  // e.g. https://novelfull.net/novel/... → https://novelfull.net
  let base = "https://novelfull.net";
  if (sourceUrl) {
    try { base = new URL(sourceUrl).origin; } catch {}
  }

  try {
    // Case 1: relative proxy path — /api/image?url=...
    if (coverUrl.startsWith("/api/image?url=")) {
      const inner = decodeURIComponent(coverUrl.slice("/api/image?url=".length));
      const resolved = inner.startsWith("http") ? inner : `${base}${inner}`;
      return `/api/image?url=${encodeURIComponent(resolved)}`;
    }
    // Case 2: absolute URL pointing to our own proxy (any host, e.g. localhost:3000)
    const u = new URL(coverUrl);
    if (u.pathname === "/api/image") {
      const inner = u.searchParams.get("url") || "";
      const resolved = inner.startsWith("http") ? inner : `${base}${inner}`;
      return `/api/image?url=${encodeURIComponent(resolved)}`;
    }
    // Case 3: plain external image URL
    return `/api/image?url=${encodeURIComponent(coverUrl)}`;
  } catch {
    return `/api/image?url=${encodeURIComponent(coverUrl)}`;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const router = useRouter();
  const supabase = createClient();

  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | NovelStatus>("all");
  const [search, setSearch] = useState("");
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // ── Add modal state
  const [addForm, setAddForm] = useState({ title: "", author: "", source_url: "", cover_url: "", synopsis: "", status: "plan_to_read" as NovelStatus });
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [isGuest, setIsGuest] = useState(false);

  // ── Load novels
  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push("/sign-in"); return; }
        // Anonymous/guest users — show sign-in prompt instead of loading library
        if (user.is_anonymous) { setIsGuest(true); return; }
        const { data, error } = await supabase
          .from("novels")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) console.error("Library load error:", error.message);
        console.log("Library loaded:", data?.length, "novels");
        setNovels((data as Novel[]) || []);
      } catch (err) {
        console.error("Library error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest(".status-dropdown-wrap")) setOpenDropdown(null);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  // ── Status change
  async function changeStatus(novelId: string, status: NovelStatus) {
    setNovels(prev => prev.map(n => n.id === novelId ? { ...n, status } : n));
    setOpenDropdown(null);
    await supabase.from("novels").update({ status }).eq("id", novelId);
  }

  // ── Delete
  async function deleteNovel(e: React.MouseEvent, novelId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Remove from library?")) return;
    await supabase.from("novels").delete().eq("id", novelId);
    setNovels(prev => prev.filter(n => n.id !== novelId));
  }

  // ── Add novel
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.title || !addForm.source_url) return;
    setAdding(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("novels").insert([{
      user_id: user.id,
      title: addForm.title,
      author: addForm.author,
      source_url: addForm.source_url,
      cover_url: addForm.cover_url,
      synopsis: addForm.synopsis,
      status: addForm.status,
      current_chapter: 0,
      total_chapters: 0,
    }]).select().single();
    if (data) setNovels(prev => [data as Novel, ...prev]);
    setShowAddModal(false);
    setAddForm({ title: "", author: "", source_url: "", cover_url: "", synopsis: "", status: "plan_to_read" });
    setAdding(false);
  }

  // ── Sync total_chapters for all novels from their source
  async function syncLibrary() {
    if (syncing || novels.length === 0) return;
    setSyncing(true);
    let updated = 0;
    for (const novel of novels) {
      setSyncProgress(`Syncing ${updated + 1}/${novels.length}…`);
      try {
        const res = await fetch(`/api/novel?url=${encodeURIComponent(novel.source_url)}&page=1`);
        const data = await res.json();
        // total chapters = chapters on page 1 * total pages (approx), or use allChapters
        // The API returns totalPages — use chapters.length * totalPages as upper bound
        // but actually we want the accurate count so use chapters on last page
        const totalPages = data.totalPages || 1;
        let totalChapters = (data.chapters?.length || 0);
        if (totalPages > 1) {
          // fetch last page to get accurate count
          const lastRes = await fetch(`/api/novel?url=${encodeURIComponent(novel.source_url)}&page=${totalPages}`);
          const lastData = await lastRes.json();
          totalChapters = (totalPages - 1) * 100 + (lastData.chapters?.length || 0);
        }
        if (totalChapters > 0 && totalChapters !== novel.total_chapters) {
          await supabase.from("novels").update({ total_chapters: totalChapters }).eq("id", novel.id);
          setNovels(prev => prev.map(n => n.id === novel.id ? { ...n, total_chapters: totalChapters } : n));
        }
        updated++;
      } catch {
        // skip failed novels silently
        updated++;
      }
    }
    setSyncing(false);
    setSyncProgress("");
  }

  const filtered = novels.filter(n => {
    const matchesFilter = filter === "all" || n.status === filter;
    const matchesSearch = !search || n.title.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  // Guest prompt
  if (isGuest) {
    return (
      <>
        <style>{`
          *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
          body{background:#080808;color:#e8e8e8;font-family:'Georgia',serif;min-height:100vh}
        `}</style>
        <SiteNav />
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "radial-gradient(ellipse 80% 80% at 50% 0%, #1a0d2e33, transparent), #080808" }}>
          <div style={{ textAlign: "center", maxWidth: "400px" }}>
            <div style={{ fontSize: "48px", marginBottom: "24px" }}>📚</div>
            <h2 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "12px", letterSpacing: "-0.01em" }}>Sign in to access your Library</h2>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.4)", lineHeight: 1.7, marginBottom: "32px" }}>
              Create a free account to track your novels, sync reading progress across devices, and pick up right where you left off.
            </p>
            <a href="/sign-in" style={{ display: "inline-block", background: "#c8a96e", color: "#080808", textDecoration: "none", borderRadius: "8px", padding: "13px 32px", fontWeight: 700, fontSize: "13px", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "16px" }}>
              Sign In →
            </a>
            <br />
            <a href="/" style={{ fontSize: "12px", color: "rgba(255,255,255,0.25)", textDecoration: "none", letterSpacing: "0.08em" }}>← Back to home</a>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:#080808;color:#e8e8e8;font-family:'Georgia',serif;min-height:100vh}


        .lib-page{max-width:1200px;margin:0 auto;padding:80px 24px 60px}

        .lib-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:16px}
        .lib-title{font-size:26px;font-weight:700;letter-spacing:0.04em}
        .lib-header-right{display:flex;gap:12px;align-items:center}

        .lib-search{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e8e8e8;font-family:'Georgia',serif;font-size:13px;padding:9px 14px;border-radius:4px;outline:none;width:200px;transition:border-color 0.2s}
        .lib-search:focus{border-color:rgba(200,169,110,0.5)}
        .lib-search::placeholder{color:rgba(255,255,255,0.2)}

        .btn-add{background:#c8a96e;color:#080808;border:none;padding:9px 18px;font-family:'Georgia',serif;font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border-radius:4px;cursor:pointer;transition:background 0.2s}
        .btn-add:hover{background:#d4b87a}
        .btn-sync{background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);border:1px solid rgba(255,255,255,0.12);padding:9px 18px;font-family:'Georgia',serif;font-size:12px;letter-spacing:0.08em;border-radius:4px;cursor:pointer;transition:all 0.2s;white-space:nowrap}
        .btn-sync:hover:not(:disabled){background:rgba(255,255,255,0.1);color:#fff}
        .btn-sync:disabled{opacity:0.5;cursor:not-allowed}

        .lib-tabs{display:flex;gap:6px;margin-bottom:28px;flex-wrap:wrap}
        .lib-tab{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-family:'Georgia',serif;font-size:12px;letter-spacing:0.08em;padding:6px 16px;border-radius:20px;cursor:pointer;transition:all 0.15s}
        .lib-tab:hover{border-color:rgba(200,169,110,0.4);color:#c8a96e}
        .lib-tab.active{background:rgba(200,169,110,0.12);border-color:#c8a96e;color:#c8a96e}

        .lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:20px}

        /* Card */
        .lib-card{position:relative;text-decoration:none;color:inherit;display:block;border-radius:6px;transition:transform 0.2s}
        .lib-card:hover{transform:translateY(-3px)}

        .lib-card-cover{position:relative;width:100%;padding-bottom:148%;border-radius:6px;overflow:hidden;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);margin-bottom:10px}
        .lib-card-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .lib-cover-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:rgba(200,169,110,0.3);letter-spacing:0.05em}

        /* Unread badge — top left */
        .lib-unread-badge{position:absolute;top:7px;left:7px;background:rgba(200,169,110,0.92);color:#080808;font-size:10px;font-weight:700;font-family:'Georgia',serif;padding:2px 7px;border-radius:10px;letter-spacing:0.04em;z-index:3}

        /* Delete button — top right */
        .lib-delete-btn{position:absolute;top:7px;right:7px;background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);width:24px;height:24px;border-radius:50%;font-size:12px;cursor:pointer;display:none;align-items:center;justify-content:center;z-index:3;transition:all 0.15s;line-height:1}
        .lib-card:hover .lib-delete-btn{display:flex}
        .lib-delete-btn:hover{background:rgba(248,113,113,0.8);border-color:#f87171;color:#fff}

        /* Progress bar */
        .lib-progress{width:100%;height:2px;background:rgba(255,255,255,0.07);border-radius:2px;margin-bottom:8px}
        .lib-progress-fill{height:100%;background:#c8a96e;border-radius:2px;transition:width 0.3s}

        .lib-card-title{font-size:12px;line-height:1.4;color:rgba(255,255,255,0.8);margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .lib-card:hover .lib-card-title{color:#c8a96e}

        /* Status dropdown */
        .status-dropdown-wrap{position:relative}
        .status-pill{display:inline-flex;align-items:center;gap:4px;font-size:10px;letter-spacing:0.06em;padding:3px 8px;border-radius:10px;cursor:pointer;border:1px solid transparent;transition:all 0.15s;font-family:'Georgia',serif}
        .status-pill:hover{filter:brightness(1.2)}
        .status-pill-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
        .status-pill-arrow{opacity:0.5;font-size:8px}
        .status-dropdown-menu{position:absolute;bottom:calc(100% + 6px);left:0;background:#1c1c1c;border:1px solid rgba(255,255,255,0.12);border-radius:8px;overflow:hidden;z-index:50;min-width:150px;box-shadow:0 8px 32px rgba(0,0,0,0.8)}
        .status-dropdown-item{padding:9px 14px;font-size:12px;font-family:'Georgia',serif;cursor:pointer;display:flex;align-items:center;gap:8px;transition:background 0.1s;border:none;background:none;color:#e8e8e8;width:100%;text-align:left}
        .status-dropdown-item:hover{background:rgba(255,255,255,0.06)}
        .status-dropdown-item.active{color:#c8a96e}

        .lib-card-continue{font-size:10px;color:rgba(255,255,255,0.25);letter-spacing:0.06em}

        .lib-empty{text-align:center;padding:80px 0;color:rgba(255,255,255,0.2);font-size:15px}

        /* Add modal */
        .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px}
        .modal-box{background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:32px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto}
        .modal-title{font-size:18px;font-weight:700;margin-bottom:24px;letter-spacing:0.04em}
        .modal-field{margin-bottom:16px}
        .modal-label{font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;display:block}
        .modal-input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e8e8e8;font-family:'Georgia',serif;font-size:14px;padding:10px 14px;border-radius:4px;outline:none;transition:border-color 0.2s}
        .modal-input:focus{border-color:rgba(200,169,110,0.5)}
        .modal-input::placeholder{color:rgba(255,255,255,0.2)}
        .modal-actions{display:flex;gap:12px;margin-top:24px}
        .modal-btn-primary{background:#c8a96e;color:#080808;border:none;padding:10px 24px;font-family:'Georgia',serif;font-size:13px;font-weight:700;letter-spacing:0.08em;border-radius:4px;cursor:pointer;flex:1}
        .modal-btn-cancel{background:transparent;border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.5);padding:10px 24px;font-family:'Georgia',serif;font-size:13px;letter-spacing:0.08em;border-radius:4px;cursor:pointer}

        .loading-wrap{display:flex;align-items:center;justify-content:center;min-height:60vh;color:rgba(255,255,255,0.25);font-size:13px;letter-spacing:0.2em}

        @media(max-width:640px){
          .lib-grid{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:14px}
          .lib-page{padding:72px 16px 60px}
          .lib-search{width:140px}
        }
      `}</style>

      <SiteNav />

      <div className="lib-page">
        {/* Header */}
        <div className="lib-header">
          <h1 className="lib-title">My Library</h1>
          <div className="lib-header-right">
            <input
              className="lib-search"
              placeholder="Search library…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button
              className="btn-sync"
              onClick={syncLibrary}
              disabled={syncing}
              title="Refresh chapter counts from source"
            >
              {syncing ? syncProgress || "Syncing…" : "⟳ Sync"}
            </button>
            <button className="btn-add" onClick={() => setShowAddModal(true)}>+ Add Novel</button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="lib-tabs">
          {FILTER_TABS.map(tab => {
            const count = tab.key === "all" ? novels.length : novels.filter(n => n.status === tab.key).length;
            return (
              <button
                key={tab.key}
                className={`lib-tab${filter === tab.key ? " active" : ""}`}
                onClick={() => setFilter(tab.key)}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="loading-wrap">LOADING LIBRARY…</div>
        ) : filtered.length === 0 ? (
          <div className="lib-empty">
            {search ? "No novels match your search." : filter === "all" ? "Your library is empty. Search for novels to add them." : `No novels with status "${STATUS_LABELS[filter as NovelStatus]}".`}
          </div>
        ) : (
          <div className="lib-grid">
            {filtered.map(novel => {
              const progress = novel.total_chapters > 0
                ? Math.min(100, Math.round((novel.current_chapter / novel.total_chapters) * 100))
                : 0;
              const unread = novel.total_chapters > 0
                ? Math.max(0, novel.total_chapters - novel.current_chapter)
                : null;
              const color = STATUS_COLORS[novel.status] || "#c8a96e";

              return (
                <div key={novel.id} style={{ position: "relative" }}>
                  <Link
                    href={`/novel?url=${encodeURIComponent(novel.source_url)}&id=${novel.id}`}
                    className="lib-card"
                  >
                    <div className="lib-card-cover">
                      {/* Unread badge */}
                      {unread !== null && unread > 0 && (
                        <span className="lib-unread-badge">+{unread}</span>
                      )}

                      {/* Delete button */}
                      <button
                        className="lib-delete-btn"
                        onClick={e => deleteNovel(e, novel.id)}
                        title="Remove from library"
                      >✕</button>

                      {novel.cover_url ? (
                        <img
                          src={proxiedUrl(novel.cover_url, novel.source_url)}
                          alt={novel.title}
                          loading="lazy"
                          onError={e => { (e.target as HTMLImageElement).style.display = "none"; const fb = (e.target as HTMLImageElement).parentElement?.querySelector(".lib-cover-fallback") as HTMLElement | null; if (fb) fb.style.display = "flex"; }}
                        />
                      ) : null}
                      <div className="lib-cover-fallback" style={{ display: novel.cover_url ? "none" : "flex" }}>
                        {novel.title.slice(0, 2).toUpperCase()}
                      </div>
                    </div>

                    {/* Progress bar */}
                    {novel.total_chapters > 0 && (
                      <div className="lib-progress">
                        <div className="lib-progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                    )}

                    <p className="lib-card-title">{novel.title}</p>


                    <p className="lib-card-continue">
                      {novel.current_chapter > 0
                        ? `Ch.${novel.current_chapter}${novel.total_chapters > 0 ? ` / ${novel.total_chapters}` : ""}`
                        : "Not started"}
                    </p>
                  </Link>

                  {/* Status dropdown — outside the Link so clicks don't navigate */}
                  <div className="status-dropdown-wrap" style={{ marginTop: "8px" }}>
                    <button
                      className="status-pill"
                      style={{ color, borderColor: color + "40", background: color + "12" }}
                      onClick={e => { e.preventDefault(); setOpenDropdown(openDropdown === novel.id ? null : novel.id); }}
                    >
                      <span className="status-pill-dot" style={{ background: color }} />
                      {STATUS_LABELS[novel.status]}
                      <span className="status-pill-arrow">▾</span>
                    </button>

                    {openDropdown === novel.id && (
                      <div className="status-dropdown-menu">
                        {(Object.keys(STATUS_LABELS) as NovelStatus[]).map(s => (
                          <button
                            key={s}
                            className={`status-dropdown-item${novel.status === s ? " active" : ""}`}
                            onClick={() => changeStatus(novel.id, s)}
                          >
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[s], flexShrink: 0, display: "inline-block" }} />
                            {STATUS_LABELS[s]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Novel Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false); }}>
          <div className="modal-box">
            <h2 className="modal-title">Add Novel Manually</h2>
            <form onSubmit={handleAdd}>
              <div className="modal-field">
                <label className="modal-label">Title *</label>
                <input className="modal-input" placeholder="Novel title" value={addForm.title} onChange={e => setAddForm(f => ({ ...f, title: e.target.value }))} required />
              </div>
              <div className="modal-field">
                <label className="modal-label">Author</label>
                <input className="modal-input" placeholder="Author name" value={addForm.author} onChange={e => setAddForm(f => ({ ...f, author: e.target.value }))} />
              </div>
              <div className="modal-field">
                <label className="modal-label">Source URL *</label>
                <input className="modal-input" placeholder="https://novelfull.net/..." value={addForm.source_url} onChange={e => setAddForm(f => ({ ...f, source_url: e.target.value }))} required />
              </div>
              <div className="modal-field">
                <label className="modal-label">Cover URL</label>
                <input className="modal-input" placeholder="https://..." value={addForm.cover_url} onChange={e => setAddForm(f => ({ ...f, cover_url: e.target.value }))} />
              </div>
              <div className="modal-field">
                <label className="modal-label">Status</label>
                <select className="modal-input" value={addForm.status} onChange={e => setAddForm(f => ({ ...f, status: e.target.value as NovelStatus }))}>
                  {(Object.keys(STATUS_LABELS) as NovelStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="modal-btn-cancel" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button type="submit" className="modal-btn-primary" disabled={adding}>{adding ? "Adding…" : "Add to Library"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}