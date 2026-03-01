"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import SiteNav from "../components/SiteNav";

interface SearchResult {
  title: string;
  url: string;
  cover_url: string;
  source: string;
}

interface ApiResult {
  id?: string;
  title: string;
  cover_url?: string;
  source_url?: string;
  source?: string;
  synopsis?: string;
  _score?: number;
}

const SOURCES = ["All", "NovelFull", "AllNovelFull", "NovelBin", "NovelCool", "NovelHall", "NovLove"];

function SearchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeSource, setActiveSource] = useState("All");
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({});

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setSearched(true);
    setResults([]);
    setActiveSource("All");
    setSourceCounts({});

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();

      // API returns { results: [...], query, total }
      const raw: ApiResult[] = Array.isArray(data) ? data : (data?.results ?? []);

      const normalised: SearchResult[] = raw.map((item) => ({
        title: item.title || "",
        url: item.source_url || item.id || "",
        cover_url: item.cover_url || "",
        source: item.source || "Unknown",
      }));

      setResults(normalised);

      const counts: Record<string, number> = {};
      for (const r of normalised) {
        counts[r.source] = (counts[r.source] || 0) + 1;
      }
      setSourceCounts(counts);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery) doSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query)}`);
    doSearch(query);
  };

  const filtered =
    activeSource === "All" ? results : results.filter((r) => r.source === activeSource);

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080808; color: #e8e8e8; font-family: Georgia, serif; }

        .page { min-height: 100vh; padding: 80px 24px 40px; max-width: 1100px; margin: 0 auto; }


        .heading { font-size: 28px; letter-spacing: 0.06em; color: #e8e8e8; margin: 24px 0 28px; font-weight: normal; }

        .search-form { display: flex; gap: 12px; margin-bottom: 32px; }
        .search-input {
          flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
          color: #e8e8e8; font-family: Georgia, serif; font-size: 15px;
          padding: 12px 16px; border-radius: 4px; outline: none;
        }
        .search-input:focus { border-color: #c8a96e; }
        .search-btn {
          background: #c8a96e; color: #080808; border: none; padding: 12px 24px;
          font-family: Georgia, serif; font-size: 14px; letter-spacing: 0.08em;
          cursor: pointer; border-radius: 4px; font-weight: bold;
        }
        .search-btn:hover { background: #d4b87a; }

        .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
        .tab {
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.5); font-family: Georgia, serif; font-size: 12px;
          letter-spacing: 0.06em; padding: 6px 14px; border-radius: 20px;
          cursor: pointer; transition: all 0.15s;
        }
        .tab:hover { border-color: rgba(200,169,110,0.5); color: #c8a96e; }
        .tab.active { background: rgba(200,169,110,0.15); border-color: #c8a96e; color: #c8a96e; }
        .tab-count { margin-left: 5px; opacity: 0.6; font-size: 11px; }

        .results-meta { font-size: 12px; color: rgba(255,255,255,0.35); letter-spacing: 0.06em; margin-bottom: 20px; }

        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 20px;
        }

        .card { text-decoration: none; color: inherit; display: block; }
        .cover-wrap {
          position: relative; width: 100%; padding-bottom: 145%;
          background: rgba(255,255,255,0.05); border-radius: 4px; overflow: hidden;
          border: 1px solid rgba(255,255,255,0.07); margin-bottom: 10px;
        }
        .cover-wrap img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .cover-fallback {
          position: absolute; inset: 0; display: flex; align-items: center;
          justify-content: center; font-size: 22px; color: rgba(200,169,110,0.5);
          letter-spacing: 0.1em;
        }
        .source-badge {
          position: absolute; top: 6px; right: 6px;
          background: rgba(8,8,8,0.85); color: #c8a96e;
          font-size: 9px; letter-spacing: 0.08em; padding: 3px 7px;
          border-radius: 3px; font-family: Georgia, serif;
        }
        .card-title {
          font-size: 13px; line-height: 1.4; color: #e8e8e8;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .card:hover .card-title { color: #c8a96e; }

        .empty { text-align: center; padding: 60px 0; color: rgba(255,255,255,0.3); font-size: 15px; }

        .spinner {
          display: flex; align-items: center; justify-content: center;
          gap: 10px; padding: 60px 0; color: rgba(255,255,255,0.3); font-size: 14px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin-icon {
          width: 20px; height: 20px; border: 2px solid rgba(200,169,110,0.3);
          border-top-color: #c8a96e; border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @media (max-width: 600px) {
          .grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 14px; }
        }
      `}</style>

      <div className="page">
        <SiteNav />
        <h1 className="heading">Search Light Novels</h1>

        <form onSubmit={handleSubmit} className="search-form">
          <input
            className="search-input"
            type="text"
            placeholder="Search by title..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button type="submit" className="search-btn">Search</button>
        </form>

        {searched && !loading && results.length > 0 && (
          <div className="tabs">
            {SOURCES.map((src) => {
              const count = src === "All" ? results.length : (sourceCounts[src] || 0);
              if (src !== "All" && count === 0) return null;
              return (
                <button
                  key={src}
                  className={`tab${activeSource === src ? " active" : ""}`}
                  onClick={() => setActiveSource(src)}
                >
                  {src}
                  <span className="tab-count">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="spinner">
            <div className="spin-icon" />
            Searching all sources...
          </div>
        )}

        {!loading && searched && (
          <>
            {results.length > 0 && (
              <p className="results-meta">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
                {activeSource !== "All" ? ` from ${activeSource}` : ""}
              </p>
            )}

            {filtered.length === 0 ? (
              <div className="empty">
                {results.length === 0
                  ? "No results found. Try a different search term."
                  : `No results from ${activeSource}.`}
              </div>
            ) : (
              <div className="grid">
                {filtered.map((novel, i) => (
                  <Link
                    key={i}
                    href={`/novel?url=${encodeURIComponent(novel.url)}`}
                    className="card"
                  >
                    <div className="cover-wrap">
                      {novel.cover_url ? (
                        <img
                          src={`/api/image?url=${encodeURIComponent(novel.cover_url)}`}
                          alt={novel.title}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                            const fb = e.currentTarget.parentElement?.querySelector(".cover-fallback") as HTMLElement | null;
                            if (fb) fb.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div className="cover-fallback" style={{ display: novel.cover_url ? "none" : "flex" }}>
                        {novel.title.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="source-badge">{novel.source}</span>
                    </div>
                    <p className="card-title">{novel.title}</p>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        {!loading && !searched && (
          <div className="empty">Enter a title to search across all sources.</div>
        )}
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ background: "#080808", minHeight: "100vh" }} />}>
      <SearchContent />
    </Suspense>
  );
}