'use client';

import { useEffect, useState, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface ReaderSettings {
  font_family: string;
  font_size: number;
  line_height: number;
  theme: 'dark' | 'sepia' | 'light';
}

const DEFAULT_SETTINGS: ReaderSettings = {
  font_family: 'Georgia',
  font_size: 18,
  line_height: 1.9,
  theme: 'dark',
};

const THEMES = {
  dark:  { bg: '#0a0a0a', text: '#d4c9b8', muted: '#666',    panel: '#111',    border: '#222',    accent: '#c8a96e', overlay: 'rgba(0,0,0,0.85)' },
  sepia: { bg: '#f4efe6', text: '#3b2f1e', muted: '#8a7560', panel: '#ede8df', border: '#d4c9b8', accent: '#8b6914', overlay: 'rgba(244,239,230,0.92)' },
  light: { bg: '#fafafa', text: '#1a1a1a', muted: '#888',    panel: '#f0f0f0', border: '#e0e0e0', accent: '#c8a96e', overlay: 'rgba(250,250,250,0.92)' },
};

const FONT_OPTIONS = [
  { label: 'Georgia',     value: 'Georgia, serif' },
  { label: 'Palatino',    value: '"Palatino Linotype", Palatino, serif' },
  { label: 'Garamond',    value: 'Garamond, serif' },
  { label: 'System Sans', value: '-apple-system, BlinkMacSystemFont, sans-serif' },
];

function ReaderContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  const chapterUrl = searchParams.get('url')      || '';
  const novelId    = searchParams.get('novelId')  || '';
  const chapterNum = parseInt(searchParams.get('chapter') || '1', 10);
  const novelTitle = decodeURIComponent(searchParams.get('title')    || 'Novel');
  const novelUrl   = searchParams.get('novelUrl') || '';

  const [content,      setContent]      = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [settings,     setSettings]     = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [showPanel,    setShowPanel]    = useState(false);
  const [showSidebar,  setShowSidebar]  = useState(false);
  const [sidebarChapters, setSidebarChapters] = useState<{number:number;title:string;url:string}[]>([]);
  const [sidebarLoading,  setSidebarLoading]  = useState(false);
  const [sidebarPage,     setSidebarPage]     = useState(1);
  const [sidebarTotalPages, setSidebarTotalPages] = useState(1);
  const [markedRead,   setMarkedRead]   = useState(false);
  const [hideUI,       setHideUI]       = useState(false);
  const [prevUrl,      setPrevUrl]      = useState<string | null>(null);
  const [nextUrl,      setNextUrl]      = useState<string | null>(null);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const panelRef    = useRef<HTMLDivElement>(null);
  const sidebarRef  = useRef<HTMLDivElement>(null);
  const theme = THEMES[settings.theme];

  // ── Back: go to novel page if novelUrl available, else browser back
  function goBack() {
    if (novelUrl) {
      router.push(`/novel?url=${encodeURIComponent(novelUrl)}${novelId ? `&id=${novelId}` : ''}`);
    } else {
      router.back();
    }
  }

  // ── Load settings from localStorage (device-local)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('shelf_reader_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        setSettings({
          font_family: parsed.font_family || DEFAULT_SETTINGS.font_family,
          font_size:   parsed.font_size   || DEFAULT_SETTINGS.font_size,
          line_height: parsed.line_height || DEFAULT_SETTINGS.line_height,
          theme:       parsed.theme       || DEFAULT_SETTINGS.theme,
        });
      }
    } catch { /* ignore */ }
  }, []);

  // ── Save settings to localStorage (device-local)
  const saveSettings = useCallback((s: ReaderSettings) => {
    try {
      localStorage.setItem('shelf_reader_settings', JSON.stringify(s));
    } catch { /* ignore */ }
  }, []);

  const updateSetting = useCallback(<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  // ── Fetch chapter
  useEffect(() => {
    if (!chapterUrl) return;
    setLoading(true);
    setContent('');
    setMarkedRead(false);
    setPrevUrl(null);
    setNextUrl(null);
    async function fetchChapter() {
      try {
        const res = await fetch(`/api/chapter?url=${encodeURIComponent(chapterUrl)}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setContent(data.content || '');
        setChapterTitle(data.title || `Chapter ${chapterNum}`);
        setPrevUrl(data.prev_url || null);
        setNextUrl(data.next_url || null);
      } catch {
        setError('Failed to load chapter. The source site may be unavailable.');
      } finally {
        setLoading(false);
      }
    }
    fetchChapter();
  }, [chapterUrl]);

  // ── Mark read at bottom (UPDATED WITH AUTO-STATUS LOGIC)
  useEffect(() => {
    if (!bottomRef.current || markedRead || !content) return;
    const observer = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting || markedRead) return;
      setMarkedRead(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !novelId) return;

      try {
        // 1. Update fine-grained reading progress
        await supabase.from('reading_progress').upsert(
          { user_id: user.id, novel_id: novelId, chapter_number: chapterNum, last_read_at: new Date().toISOString() },
          { onConflict: 'user_id,novel_id' }
        );

        // 2. Fetch current state to determine if updates are needed
        const { data: novel, error } = await supabase
          .from('novels')
          .select('current_chapter, status')
          .eq('id', novelId)
          .single();

        if (!error && novel) {
          const updates: any = {};
          let needsUpdate = false;

          // Update high-water mark for current chapter
          if (chapterNum > (novel.current_chapter || 0)) {
            updates.current_chapter = chapterNum;
            needsUpdate = true;
          }

          // AUTO-STATUS: Force status to "reading" if they just finished a chapter
          if (novel.status !== 'reading') {
            updates.status = 'reading';
            needsUpdate = true;
          }

          // Only run database update if something actually changed
          if (needsUpdate) {
            updates.updated_at = new Date().toISOString();
            await supabase.from('novels').update(updates).eq('id', novelId);
          }
        }
      } catch (err) {
        console.error("Failed to mark chapter as read:", err);
      }
    }, { threshold: 0.5 });
    
    observer.observe(bottomRef.current);
    return () => observer.disconnect();
  }, [content, markedRead, novelId, chapterNum, supabase]);

  // ── Close panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setShowPanel(false);
    }
    if (showPanel) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showPanel]);

  // ── Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft'  && prevUrl) navigateChapter(prevUrl, chapterNum - 1);
      if (e.key === 'ArrowRight' && nextUrl) navigateChapter(nextUrl, chapterNum + 1);
      if (e.key === 'Escape') { setShowPanel(false); setShowSidebar(false); }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [prevUrl, nextUrl, chapterNum]);


  // ── Hide/show UI on mobile scroll ──────────────────────────────────────────
  useEffect(() => {
    let lastY = window.scrollY;
    function handleScroll() {
      // Only apply on mobile (≤768px)
      if (window.innerWidth > 768) return;
      const currentY = window.scrollY;
      if (currentY > lastY + 5) {
        setHideUI(true);   // scrolling down — hide
      } else if (currentY < lastY - 5) {
        setHideUI(false);  // scrolling up — show
      }
      lastY = currentY;
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  function navigateChapter(url: string, num: number) {
    const params = new URLSearchParams({
      url,
      novelId,
      chapter: String(num),
      title: encodeURIComponent(novelTitle),
    });
    if (novelUrl) params.set('novelUrl', novelUrl);
    router.push(`/read?${params.toString()}`);
    window.scrollTo({ top: 0 });
    setShowSidebar(false);
  }

  async function openSidebar() {
    setShowSidebar(true);
    if (sidebarChapters.length > 0) {
      // Already loaded — scroll to current chapter
      setTimeout(() => {
        const el = sidebarRef.current?.querySelector('[data-current="true"]') as HTMLElement | null;
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 50);
      return;
    }
    if (!novelUrl) return;
    setSidebarLoading(true);
    try {
      // First fetch page 1 to get totalPages
      const res1 = await fetch(`/api/novel?url=${encodeURIComponent(novelUrl)}&page=1`);
      const data1 = await res1.json();
      const totalPages = data1.totalPages || 1;
      setSidebarTotalPages(totalPages);

      // Load all pages from 1 up to (current chapter's page + 1)
      const currentPage = Math.max(1, Math.ceil(chapterNum / 100));
      const loadUpTo = Math.min(currentPage + 1, totalPages);

      let chapters = data1.chapters || [];

      // Fetch pages 2..loadUpTo in parallel
      if (loadUpTo > 1) {
        const pageNums = Array.from({ length: loadUpTo - 1 }, (_, i) => i + 2);
        const results = await Promise.all(
          pageNums.map(p => fetch(`/api/novel?url=${encodeURIComponent(novelUrl)}&page=${p}`).then(r => r.json()))
        );
        for (const d of results) chapters = [...chapters, ...(d.chapters || [])];
      }

      setSidebarChapters(chapters.map((c: {number:number|string;title:string;url:string}) => ({ ...c, number: Number(c.number) })));
      setSidebarPage(loadUpTo);
      setTimeout(() => {
        const el = sidebarRef.current?.querySelector('[data-current="true"]') as HTMLElement | null;
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 100);
    } catch { /* silent */ }
    setSidebarLoading(false);
  }

  async function loadMoreSidebarChapters() {
    if (!novelUrl || sidebarPage >= sidebarTotalPages) return;
    const nextPage = sidebarPage + 1;
    setSidebarLoading(true);
    try {
      const res = await fetch(`/api/novel?url=${encodeURIComponent(novelUrl)}&page=${nextPage}`);
      const data = await res.json();
      setSidebarChapters(prev => [...prev, ...(data.chapters || []).map((c: {number:number|string;title:string;url:string}) => ({ ...c, number: Number(c.number) }))]);
      setSidebarPage(nextPage);
    } catch { /* silent */ }
    setSidebarLoading(false);
  }

  return (
    <div style={{ background: theme.bg, color: theme.text, minHeight: '100vh', fontFamily: settings.font_family, transition: 'background 0.3s, color 0.3s' }}>

      {/* Top bar — hides on mobile scroll down, shows on scroll up */}
      <style>{`
        @media (max-width: 768px) {
          .reader-topbar, .reader-bottom { transition: transform 0.3s ease; }
          .reader-topbar button, .reader-topbar div { font-size: 16px !important; }
          .reader-topbar .rdr-label { font-size: 11px !important; }
        }
      `}</style>
      <div
        className="reader-topbar"
        style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
          background: theme.overlay, backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${theme.border}`, height: '52px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 1.5rem', gap: '1rem',
          transform: hideUI ? 'translateY(-100%)' : 'translateY(0)',
          transition: 'transform 0.3s ease',
        }}>
        <button onClick={goBack}
          style={{ background: 'none', border: `1px solid ${theme.border}`, color: theme.muted, cursor: 'pointer', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem', transition: 'all 0.2s', flexShrink: 0, padding: '0.3rem 0.7rem', borderRadius: '4px' }}
          onMouseEnter={e => { e.currentTarget.style.color = theme.accent; e.currentTarget.style.borderColor = theme.accent; }}
          onMouseLeave={e => { e.currentTarget.style.color = theme.muted; e.currentTarget.style.borderColor = theme.border; }}
        >
          ← Back
        </button>
        <div style={{ textAlign: 'center', overflow: 'hidden', flex: 1 }}>
          <div className="rdr-label" style={{ fontSize: '0.7rem', color: theme.muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '1px' }}>{novelTitle}</div>
          <div style={{ fontSize: '0.85rem', color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chapterTitle || `Chapter ${chapterNum}`}</div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
          <button onClick={() => openSidebar()}
            style={{ background: 'none', border: `1px solid ${showSidebar ? theme.accent : theme.border}`, color: showSidebar ? theme.accent : theme.muted, cursor: 'pointer', fontSize: '0.8rem', letterSpacing: '0.08em', padding: '0.3rem 0.7rem', borderRadius: '4px', transition: 'all 0.2s' }}
            title="Chapter list"
          >☰</button>
          <button onClick={() => { setShowPanel(p => !p); setShowSidebar(false); }}
            style={{ background: 'none', border: `1px solid ${showPanel ? theme.accent : theme.border}`, color: showPanel ? theme.accent : theme.muted, cursor: 'pointer', fontSize: '0.8rem', letterSpacing: '0.08em', padding: '0.3rem 0.7rem', borderRadius: '4px', transition: 'all 0.2s' }}
          >Aa</button>
        </div>
      </div>

      {/* Settings panel */}
      {showPanel && (
        <div ref={panelRef} style={{ position: 'fixed', top: '60px', right: '1.5rem', zIndex: 100, background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: '8px', padding: '1.25rem', width: '260px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
          <div style={{ fontSize: '0.7rem', color: theme.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '1rem' }}>Reader Settings</div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', opacity: 0.5, letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Theme</div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['dark', 'sepia', 'light'] as const).map(t => (
                <button key={t} onClick={() => updateSetting('theme', t)} style={{ flex: 1, padding: '0.35rem 0', fontSize: '0.72rem', letterSpacing: '0.06em', border: `1px solid ${settings.theme === t ? theme.accent : theme.border}`, borderRadius: '4px', background: settings.theme === t ? theme.accent + '22' : 'transparent', color: settings.theme === t ? theme.accent : theme.muted, cursor: 'pointer', textTransform: 'capitalize', transition: 'all 0.15s' }}>{t}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', opacity: 0.5, letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Font</div>
            <select value={settings.font_family} onChange={e => updateSetting('font_family', e.target.value)} style={{ width: '100%', background: theme.bg, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: '4px', padding: '0.35rem 0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
              {FONT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.72rem', opacity: 0.5, letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Font Size — {settings.font_size}px</div>
            <input type="range" min={14} max={26} step={1} value={settings.font_size} onChange={e => updateSetting('font_size', Number(e.target.value))} style={{ width: '100%', accentColor: theme.accent }} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', opacity: 0.5, letterSpacing: '0.06em', marginBottom: '0.4rem' }}>Line Height — {settings.line_height.toFixed(1)}</div>
            <input type="range" min={1.4} max={2.6} step={0.1} value={settings.line_height} onChange={e => updateSetting('line_height', Number(e.target.value))} style={{ width: '100%', accentColor: theme.accent }} />
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{ maxWidth: '680px', margin: '0 auto', padding: '80px 1.5rem 100px' }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: '6rem', color: theme.muted }}>
            <div style={{ fontSize: '0.8rem', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Loading chapter…</div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
              {[0, 1, 2].map(i => <span key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: theme.accent, display: 'inline-block', animation: `dp 1.2s ease-in-out ${i * 0.2}s infinite` }} />)}
            </div>
            <style>{`@keyframes dp{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}`}</style>
          </div>
        )}
        {error && (
          <div style={{ textAlign: 'center', paddingTop: '6rem' }}>
            <div style={{ fontSize: '1.1rem', color: '#e06c75', marginBottom: '0.5rem' }}>⚠ Failed to load</div>
            <div style={{ fontSize: '0.85rem', color: theme.muted }}>{error}</div>
          </div>
        )}
        {!loading && !error && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '3rem', paddingBottom: '2rem', borderBottom: `1px solid ${theme.border}` }}>
              <div style={{ fontSize: '0.7rem', color: theme.muted, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Chapter {chapterNum}</div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 'normal', color: theme.text, lineHeight: 1.4, margin: 0 }}>{chapterTitle}</h1>
            </div>
            <div style={{ fontSize: `${settings.font_size}px`, lineHeight: settings.line_height, fontFamily: settings.font_family, color: theme.text, overflowWrap: 'break-word', wordBreak: 'break-word', minWidth: 0 }} dangerouslySetInnerHTML={{ __html: formatContent(content) }} />
            <div ref={bottomRef} style={{ height: '1px', marginTop: '4rem' }} />
            {markedRead && (
              <div style={{ textAlign: 'center', padding: '1rem', color: theme.accent, fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>✓ Chapter marked as read</div>
            )}
          </>
        )}
      </main>

      {/* Chapter sidebar overlay */}
      {showSidebar && (
        <div onClick={() => setShowSidebar(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 149, backdropFilter: 'blur(2px)' }} />
      )}

      {/* Chapter sidebar */}
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '300px', maxWidth: '85vw', background: theme.panel, borderLeft: `1px solid ${theme.border}`, zIndex: 150, transform: showSidebar ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.3s ease', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
        {/* Sidebar header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1rem', height: '52px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0 }}>
          <span style={{ fontSize: '0.75rem', color: theme.accent, letterSpacing: '0.15em', textTransform: 'uppercase' }}>Chapters</span>
          <button onClick={() => setShowSidebar(false)} style={{ background: 'none', border: 'none', color: theme.muted, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
        </div>

        {/* Chapter list */}
        <div ref={sidebarRef} style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
          {sidebarLoading && sidebarChapters.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: theme.muted, fontSize: '0.8rem', letterSpacing: '0.1em' }}>Loading…</div>
          )}
          {!novelUrl && (
            <div style={{ padding: '2rem', textAlign: 'center', color: theme.muted, fontSize: '0.8rem' }}>No novel URL available.</div>
          )}
          {sidebarChapters.map(ch => (
            <button
              key={ch.number}
              data-current={ch.number === chapterNum ? "true" : undefined}
              onClick={() => navigateChapter(ch.url, ch.number)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '10px 1rem', background: ch.number === chapterNum ? theme.accent + '18' : 'none',
                border: 'none', borderLeft: `3px solid ${ch.number === chapterNum ? theme.accent : 'transparent'}`,
                color: ch.number === chapterNum ? theme.accent : theme.text,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.82rem',
                lineHeight: 1.4, transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (ch.number !== chapterNum) e.currentTarget.style.background = theme.accent + '0d'; }}
              onMouseLeave={e => { if (ch.number !== chapterNum) e.currentTarget.style.background = 'none'; }}
            >
              <span style={{ fontSize: '0.68rem', color: ch.number === chapterNum ? theme.accent : theme.muted, display: 'block', marginBottom: '2px', letterSpacing: '0.06em' }}>CH. {ch.number}</span>
              <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{ch.title}</span>
            </button>
          ))}
          {/* Load more */}
          {sidebarChapters.length > 0 && sidebarPage < sidebarTotalPages && (
            <button
              onClick={loadMoreSidebarChapters}
              disabled={sidebarLoading}
              style={{ display: 'block', width: '100%', padding: '12px', background: 'none', border: 'none', borderTop: `1px solid ${theme.border}`, color: sidebarLoading ? theme.muted : theme.accent, cursor: sidebarLoading ? 'not-allowed' : 'pointer', fontSize: '0.75rem', letterSpacing: '0.1em', fontFamily: 'inherit' }}
            >
              {sidebarLoading ? 'Loading…' : `Load More (${sidebarPage}/${sidebarTotalPages})`}
            </button>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      {!loading && (
        <div
          className="reader-bottom"
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: theme.overlay, backdropFilter: 'blur(12px)',
            borderTop: `1px solid ${theme.border}`,
            padding: '0.75rem 1.5rem',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
            transform: hideUI ? 'translateY(100%)' : 'translateY(0)',
            transition: 'transform 0.3s ease',
          }}>
          <NavBtn label="← Previous" disabled={!prevUrl} onClick={() => prevUrl && navigateChapter(prevUrl, chapterNum - 1)} accent={theme.accent} muted={theme.muted} border={theme.border} />
          <div style={{ fontSize: '0.75rem', color: theme.muted, letterSpacing: '0.08em' }}>Ch. {chapterNum}</div>
          <NavBtn label="Next →" disabled={!nextUrl} onClick={() => nextUrl && navigateChapter(nextUrl, chapterNum + 1)} accent={theme.accent} muted={theme.muted} border={theme.border} primary />
        </div>
      )}
    </div>
  );
}

function NavBtn({ label, disabled, onClick, accent, muted, border, primary }: { label: string; disabled: boolean; onClick: () => void; accent: string; muted: string; border: string; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ background: primary && !disabled ? accent + '18' : 'transparent', border: `1px solid ${disabled ? border : primary ? accent : border}`, color: disabled ? muted : primary ? accent : muted, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.78rem', letterSpacing: '0.06em', padding: '0.45rem 1.1rem', borderRadius: '4px', opacity: disabled ? 0.4 : 1, transition: 'all 0.2s', minWidth: '110px', textAlign: 'center' }}>{label}</button>
  );
}

function stripTranslatorLines(html: string): string {
  return html.replace(/<p[^>]*>[^<]*(translated by|translator|tlc:|tl:|edited by|editor|proofreader|pr:|gravitas novelus|wuxiaworld|webnovel)[^<]*<\/p>/gi, '');
}

function formatContent(raw: string): string {
  if (!raw) return '';
  const ps = 'margin:0 0 1.5em 0;overflow-wrap:break-word;word-break:break-word;';
  if (raw.includes('<p>') || raw.includes('<p ')) {
    return stripTranslatorLines(
      raw.replace(/<p>/gi, `<p style="${ps}">`).replace(/<p /gi, `<p style="${ps}" `)
    );
  }
  return raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p style="${ps}">${p.replace(/\n/g, '<br/>')}</p>`).join('');
}

export default function ReaderPage() {
  return (
    <Suspense fallback={<div style={{ background: '#0a0a0a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#666', fontSize: '0.8rem', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Loading…</div></div>}>
      <ReaderContent />
    </Suspense>
  );
}