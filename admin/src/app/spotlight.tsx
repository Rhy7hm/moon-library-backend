/*
 * Spotlight: the search panel (⌘K, "/" or the search pill). Results appear as you type, grouped into
 * Folders, Files, Clients and Actions; ↑ ↓ move, Enter opens, Esc closes. Animated with GSAP.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { mainFile, nameOf, titleOf } from './api';
import { ClientAvatar } from './clients';
import { fmtDate, fmtSize } from './format';
import { IBriefcase, IChart, IChevR, IClock, IFolder, IGear, IHome, IPulse, ISearch, ISparkles, ITrash, IUpload, IUsers, IX } from './icons';
import { gsap, motionOK } from './motion';
import { useStore, type Route } from './store';
import { FolderGlyph, Thumb } from './ui';

type Result = { key: string; group: string; title: string; sub?: string; icon: ReactNode; run: () => void; keep?: boolean };

const RECENT_KEY = 'moonlib.recentSearches';
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').slice(0, 5);
  } catch {
    return [];
  }
};
const saveRecent = (q: string) => {
  const t = q.trim();
  if (!t) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([t, ...readRecent().filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 5)));
  } catch {
    /* private mode */
  }
};

/** Bolds the part of `text` that matches what was typed. */
function Mark({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function Spotlight({ open, onClose, onUpload }: { open: boolean; onClose: () => void; onUpload: (() => void) | null }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const scrim = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const hl = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const needle = q.trim().toLowerCase();

  const go = (r: Route) => () => s.go(r);
  const actions: Result[] = useMemo(() => {
    const a: (Result | false)[] = [
      !!onUpload && { key: 'a:upload', group: 'Actions', title: 'Upload files here', icon: <IUpload />, run: onUpload! },
      { key: 'a:home', group: 'Actions', title: 'Home', icon: <IHome />, run: go({ page: 'home' }) },
      { key: 'a:library', group: 'Actions', title: 'Library', icon: <IFolder />, run: go({ page: 'folder', id: null }) },
      { key: 'a:recent', group: 'Actions', title: 'Recent uploads', icon: <IClock />, run: go({ page: 'recent' }) },
      { key: 'a:clients', group: 'Actions', title: 'Clients', icon: <IBriefcase />, run: go({ page: 'clients' }) },
      { key: 'a:trash', group: 'Actions', title: 'Trash', icon: <ITrash />, run: go({ page: 'trash' }) },
      { key: 'a:insights', group: 'Actions', title: 'Insights', sub: 'Storage and file types', icon: <IChart />, run: go({ page: 'insights' }) },
      { key: 'a:activity', group: 'Actions', title: 'Activity', sub: 'Who changed what', icon: <IPulse />, run: go({ page: 'activity' }) },
      s.isOwner && { key: 'a:team', group: 'Actions', title: 'Team', sub: 'Add people, roles, passwords', icon: <IUsers />, run: go({ page: 'team' }) },
      { key: 'a:appearance', group: 'Actions', title: 'Appearance', sub: 'Theme and colour', icon: <ISparkles />, run: go({ page: 'settings', tab: 'appearance' }) },
      { key: 'a:settings', group: 'Actions', title: 'Settings', sub: 'Password and devices', icon: <IGear />, run: go({ page: 'settings', tab: 'account' }) },
    ];
    return a.filter(Boolean) as Result[];
  }, [onUpload, s]); // eslint-disable-line react-hooks/exhaustive-deps

  const results: Result[] = useMemo(() => {
    if (!needle) {
      const rec: Result[] = recent.map((r) => ({ key: 'r:' + r, group: 'Recent searches', title: r, icon: <IClock />, run: () => setQ(r), keep: true }));
      return [...rec, ...actions.slice(0, onUpload ? 5 : 4)];
    }
    const has = (t: string | null | undefined) => !!t && t.toLowerCase().includes(needle);
    const folders = s.folders
      .filter((f) => has(nameOf(f)))
      .slice(0, 5)
      .map<Result>((f) => ({
        key: 'f:' + f.id,
        group: 'Folders',
        title: nameOf(f),
        sub: s.path(f.parentId).map(nameOf).join(' › ') || 'Library',
        icon: <FolderGlyph f={f} small />,
        run: go({ page: 'folder', id: f.id }),
      }));
    const files = s.assets
      .filter((a) => has(titleOf(a)) || a.variants.some((v) => has(v.name)) || has(a.createdBy))
      .slice(0, 8)
      .map<Result>((a) => {
        const f = mainFile(a);
        return {
          key: 'i:' + a.id,
          group: 'Files',
          title: titleOf(a),
          sub: [s.path(a.folderId).map(nameOf).join(' › '), f ? fmtSize(f.size) : '', fmtDate(a.date)].filter(Boolean).join(' · '),
          icon: (
            <span className="sp-thumb">
              <Thumb asset={a} />
            </span>
          ),
          run: () => s.openSheet(a.id),
        };
      });
    const clients = s.clients
      .filter((c) => has(c.name) || has(c.email))
      .slice(0, 4)
      .map<Result>((c) => ({ key: 'c:' + c.id, group: 'Clients', title: c.name, sub: c.email || undefined, icon: <ClientAvatar c={c} size={26} />, run: go({ page: 'client', id: c.id }) }));
    const acts = actions.filter((a) => has(a.title) || has(a.sub)).slice(0, 4);
    const all: Result = { key: 'all', group: '', title: `Show all results for “${q.trim()}”`, icon: <ISearch />, run: go({ page: 'search', q: q.trim() }) };
    return [...folders, ...files, ...clients, ...acts, all];
  }, [needle, q, s, recent, actions, onUpload]); // eslint-disable-line react-hooks/exhaustive-deps

  // open / close
  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    setRecent(readRecent());
    requestAnimationFrame(() => input.current?.focus());
    if (motionOK()) {
      gsap.fromTo(scrim.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power1.out' });
      gsap.fromTo(panel.current, { opacity: 0, scale: 0.94, y: -14 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' });
    }
  }, [open]);

  const close = () => {
    if (!motionOK() || !panel.current) return onClose();
    gsap.to(scrim.current, { opacity: 0, duration: 0.18, ease: 'power1.in' });
    gsap.to(panel.current, { opacity: 0, scale: 0.96, y: -8, duration: 0.18, ease: 'power2.in' });
    // close on a plain timer, not the animation's end: a paused tab must never leave the panel stuck open
    setTimeout(onClose, 190);
  };

  // results stagger in each time the list changes
  useEffect(() => {
    if (!open || !list.current || !motionOK()) return;
    const rows = list.current.querySelectorAll('.sp-row');
    gsap.fromTo(rows, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.018, ease: 'power3.out', overwrite: true });
  }, [open, results.length, needle]); // eslint-disable-line react-hooks/exhaustive-deps

  // the highlight glides to the selected row
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`);
    if (!row || !hl.current) return;
    row.scrollIntoView({ block: 'nearest' });
    const to = { y: row.offsetTop, height: row.offsetHeight, opacity: 1 };
    if (motionOK()) gsap.to(hl.current, { ...to, duration: 0.28, ease: 'power3.out', overwrite: true });
    else gsap.set(hl.current, to);
  }, [sel, results]);

  useEffect(() => setSel(0), [needle]);

  // Esc closes wherever the focus is (e.g. after clicking in the list); keys typed elsewhere go to the box
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.target === input.current) return; // the box handles its own keys
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (r: Result | undefined) => {
    if (!r) return;
    if (needle) {
      saveRecent(q);
      setRecent(readRecent());
    }
    if (r.keep) return r.run();
    close();
    r.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((i) => Math.min(results.length - 1, i + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((i) => Math.max(0, i - 1)));
    else if (e.key === 'Enter') (e.preventDefault(), choose(results[sel]));
    else if (e.key === 'Escape') (e.preventDefault(), q ? setQ('') : close());
  };

  if (!open) return null;
  let lastGroup = '';
  return (
    <div className="sp-scrim" ref={scrim} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sp" ref={panel} role="dialog" aria-modal aria-label="Search">
        <div className="sp-input">
          <ISearch />
          <input
            ref={input}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search files, folders, clients…"
            aria-label="Search"
            aria-activedescendant={results[sel] ? `sp-${sel}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {q ? (
            <button className="sp-clear" aria-label="Clear" onClick={() => (setQ(''), input.current?.focus())}>
              <IX />
            </button>
          ) : (
            <kbd>esc</kbd>
          )}
        </div>
        <div className="sp-list" ref={list} role="listbox">
          <div className="sp-hl" ref={hl} />
          {needle && results.length === 1 && <p className="sp-empty">No folders, files or clients match “{q.trim()}”.</p>}
          {results.map((r, i) => {
            const head = r.group && r.group !== lastGroup ? r.group : null;
            lastGroup = r.group || lastGroup;
            return (
              <div key={r.key}>
                {head && <div className="sp-group">{head}</div>}
                <button
                  id={`sp-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  className={`sp-row${i === sel ? ' on' : ''}${r.key === 'all' ? ' all' : ''}`}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => choose(r)}
                >
                  <span className="sp-icon">{r.icon}</span>
                  <span className="sp-text">
                    <strong>
                      <Mark text={r.title} q={r.key.startsWith('r:') || r.key === 'all' ? '' : q.trim()} />
                    </strong>
                    {r.sub && <small>{r.sub}</small>}
                  </span>
                  {i === sel && <span className="sp-enter">↵</span>}
                  {r.key === 'all' && <IChevR className="sp-go" />}
                </button>
              </div>
            );
          })}
        </div>
        <footer className="sp-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>esc</kbd> to close
          </span>
        </footer>
      </div>
    </div>
  );
}
