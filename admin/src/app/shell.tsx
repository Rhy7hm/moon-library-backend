/*
 * The frame around every page: sidebar (navigation, your pinned folders, the folder tree), top bar
 * (search, upload), sheet and toasts.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { logout, nameOf, type Folder } from './api';
import { IAuto, IBriefcase, IChart, IChevR, IClock, IFolder, IGear, IGrid, IGrip, IHome, IMoonLine, IPin, IPulse, ISearch, ISignOut, ISparkles, ISun, ITrash, IUsers, IX } from './icons';
import { ActivityPage, HomePage, InsightsPage, TeamPage, TrashPage } from './pages';
import { SettingsPage } from './settings';
import { FolderPage, RecentPage, SearchPage } from './library';
import { AssetSheet } from './sheet';
import { Spotlight } from './spotlight';
import { ClientPage, ClientsPage } from './clients';
import { useStore, type Route } from './store';
import { gsap, pop, settle } from './motion';
import { useTheme } from './theme';
import { MenuButton, Toasts, UploadTray, UserAvatar } from './ui';

function NavItem({ icon, label, active, onClick, count }: { icon: ReactNode; label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button className={`nav-item${active ? ' on' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
      {!!count && <i className="nav-count">{count}</i>}
    </button>
  );
}

/**
 * The main places. Their icon is a 3D picture in the 3D theme and a line icon otherwise; either way the
 * current one sits a little bigger, and a click squashes and pops it (GSAP).
 */
function NavMain({ src, icon, label, active, onClick, count }: { src: string; icon: ReactNode; label: string; active: boolean; onClick: () => void; count?: number }) {
  const [theme] = useTheme();
  const is3d = theme === '3d';
  const big = is3d ? 1.18 : 1.12; // how much bigger the current page's icon sits
  const img = useRef<HTMLSpanElement>(null);
  const first = useRef(true);
  const clicked = useRef(false);
  useEffect(() => {
    // no animation on first draw, just the right size
    if (first.current) {
      first.current = false;
      if (img.current) gsap.set(img.current, { scale: active ? big : 1 });
      return;
    }
    // a click already squashes and pops it to the selected size: let that play out
    if (active && clicked.current) return void (clicked.current = false);
    settle(img.current, active ? big : 1);
  }, [active, big]);
  return (
    <button
      className={`nav-item nav-main${is3d ? ' nav-3d' : ''}${active ? ' on' : ''}`}
      onClick={() => {
        clicked.current = !active;
        pop(img.current, big);
        onClick();
      }}
      aria-current={active ? 'page' : undefined}
    >
      <span ref={img} className="nav-icon">
        {is3d ? <img src={`${import.meta.env.BASE_URL}nav/${src}.webp`} alt="" width={26} height={26} draggable={false} /> : icon}
      </span>
      <span>{label}</span>
      {!!count && <i className="nav-count">{count}</i>}
    </button>
  );
}

function TreeNode({ f, depth, current }: { f: Folder; depth: number; current: string | null }) {
  const s = useStore();
  const [theme] = useTheme();
  const kids = s.children(f.id);
  const inPath = !!current && s.path(current).some((x) => x.id === f.id);
  const [open, setOpen] = useState(inPath);
  useEffect(() => {
    if (inPath) setOpen(true);
  }, [inPath]);
  const on = current === f.id;
  return (
    <>
      <div className={`tree-row${on ? ' on' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}>
        <button className={`tree-caret${open ? ' open' : ''}${kids.length ? '' : ' none'}`} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpen((v) => !v)} tabIndex={kids.length ? 0 : -1}>
          <IChevR />
        </button>
        <button className="tree-name" onClick={() => s.go({ page: 'folder', id: f.id })} title={nameOf(f)}>
          {theme === '3d' ? (
            <img className="tree-folder" src={`${import.meta.env.BASE_URL}nav/folder.webp`} alt="" draggable={false} />
          ) : (
            <span className="tree-dot" style={{ background: f.iconBg || '#4aa3ff' }} />
          )}
          <span>{nameOf(f)}</span>
        </button>
        <button
          className={`tree-pin${s.pins.includes(f.id) ? ' on' : ''}`}
          aria-label={s.pins.includes(f.id) ? `Unpin ${nameOf(f)}` : `Pin ${nameOf(f)} to the sidebar`}
          title={s.pins.includes(f.id) ? 'Unpin' : 'Pin to the top of the sidebar'}
          onClick={() => s.togglePin(f.id)}
        >
          <IPin />
        </button>
      </div>
      {open && kids.map((k) => <TreeNode key={k.id} f={k} depth={depth + 1} current={current} />)}
    </>
  );
}

/**
 * Your pinned folders, in your order. Drag a row (or Alt + ↑ / ↓ on it) to move it; the rows glide to
 * their new places. Saved on the server for you only, so it follows you to any computer.
 */
function Pinned({ current }: { current: string | null }) {
  const s = useStore();
  const [theme] = useTheme();
  const [order, setOrder] = useState<string[] | null>(null); // while dragging
  const [dragId, setDragId] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const tops = useRef(new Map<string, number>());
  const ids = order ?? s.pins;

  // glide: each row starts where it was and slides to where it now is
  useLayoutEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const [id, el] of rows.current) {
      const top = el.offsetTop;
      const was = tops.current.get(id);
      if (was !== undefined && was !== top && !reduce) {
        el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
      tops.current.set(id, top);
    }
  }, [ids.join()]);

  if (!s.pins.length) return null;
  const moveTo = (id: string, to: number, list = ids) => {
    const next = list.filter((x) => x !== id);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
    return next;
  };
  const finish = () => {
    if (order && order.join() !== s.pins.join()) s.setPins(order);
    setOrder(null);
    setDragId(null);
  };
  return (
    <>
      <div className="side-label">Pinned</div>
      <div className="pins" role="list" aria-label="Pinned folders">
        {ids.map((id, i) => {
          const f = s.byId.get(id)!;
          const above = s.path(id).slice(0, -1);
          const name = nameOf(f);
          return (
            <div
              key={id}
              role="listitem"
              ref={(el) => void (el ? rows.current.set(id, el) : rows.current.delete(id))}
              className={`tree-row pin-row${current === id ? ' on' : ''}${dragId === id ? ' dragging' : ''}`}
              draggable
              onDragStart={(e) => {
                setDragId(id);
                setOrder(s.pins);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', name);
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                if (dragId !== id) setOrder(moveTo(dragId, ids.indexOf(id)));
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={finish}
            >
              <span className="pin-grip" aria-hidden>
                <IGrip />
              </span>
              <button
                className="tree-name"
                onClick={() => s.go({ page: 'folder', id })}
                title={[...above.map(nameOf), name].join(' / ')}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  e.preventDefault();
                  s.setPins(moveTo(id, i + (e.key === 'ArrowUp' ? -1 : 1)));
                }}
              >
                {theme === '3d' ? (
                  <img className="tree-folder" src={`${import.meta.env.BASE_URL}nav/folder.webp`} alt="" draggable={false} />
                ) : (
                  <span className="tree-dot" style={{ background: f.iconBg || '#4aa3ff' }} />
                )}
                <span>{name}</span>
                {above.length > 0 && <small className="pin-where">{nameOf(above[above.length - 1])}</small>}
              </button>
              <button className="pin-x" aria-label={`Unpin ${name}`} title="Unpin" onClick={() => s.togglePin(id)}>
                <IX />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case 'home':
      return <HomePage />;
    case 'folder':
      return <FolderPage key={route.id ?? 'root'} id={route.id} />;
    case 'recent':
      return <RecentPage />;
    case 'clients':
      return <ClientsPage />;
    case 'client':
      return <ClientPage key={route.id} id={route.id} />;
    case 'trash':
      return <TrashPage />;
    case 'search':
      return <SearchPage q={route.q} />;
    case 'insights':
      return <InsightsPage />;
    case 'activity':
      return <ActivityPage />;
    case 'team':
      return <TeamPage />;
    case 'settings':
      return <SettingsPage tab={route.tab} />;
  }
}

export function Shell({ onSignedOut }: { onSignedOut: () => void }) {
  const s = useStore();
  const [menu, setMenu] = useState(false);
  const [spot, setSpot] = useState(false);
  const upRef = useRef<HTMLInputElement>(null);
  const r = s.route;
  const current = r.page === 'folder' ? r.id : null;
  const [theme] = useTheme();
  // Insights, Activity and Team fold away under "Manage"; it opens by itself when you're on one of them
  const manageActive = r.page === 'insights' || r.page === 'activity' || r.page === 'team';
  const [manageOpen, setManageOpen] = useState(() => {
    try {
      return localStorage.getItem('moonlib.manage') === '1';
    } catch {
      return false;
    }
  });
  const toggleManage = (v = !manageOpen) => {
    setManageOpen(v);
    try {
      localStorage.setItem('moonlib.manage', v ? '1' : '0');
    } catch {
      /* private mode */
    }
  };
  useEffect(() => {
    if (manageActive) setManageOpen(true);
  }, [manageActive]);

  // ⌘K / Ctrl+K opens search, like Spotlight; so does "/" when you're not typing somewhere
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSpot((v) => !v);
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setSpot(true);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    setMenu(false);
  }, [r]);
  const nav = (to: Route) => () => s.go(to);
  const signOut = async () => {
    await logout().catch(() => null);
    onSignedOut();
  };

  if (!s.tree) {
    return (
      <div className="boot">
        <img className="boot-mark" src={`${import.meta.env.BASE_URL}brand-mark.png`} alt="" width={34} height={34} draggable={false} />
      </div>
    );
  }

  return (
    <div className={`app${menu ? ' menu-open' : ''}`}>
      <aside className="side">
        <div className="brand">
          <span className="brand-mark">
            <img src={`${import.meta.env.BASE_URL}brand-mark.png`} alt="" width={28} height={28} draggable={false} />
          </span>
          <span>Moon Library</span>
        </div>
        <nav className="nav" aria-label="Main">
          <NavMain src="home" icon={<IHome />} label="Home" active={r.page === 'home'} onClick={nav({ page: 'home' })} />
          <NavMain src="collection" icon={<IFolder />} label="Library" active={r.page === 'folder' && !r.id} onClick={nav({ page: 'folder', id: null })} />
          <NavMain src="recent" icon={<IClock />} label="Recent" active={r.page === 'recent'} onClick={nav({ page: 'recent' })} />
          <NavMain src="clients" icon={<IBriefcase />} label="Clients" active={r.page === 'clients' || r.page === 'client'} onClick={nav({ page: 'clients' })} count={s.clients.length} />
          <NavMain src="trash" icon={<ITrash />} label="Trash" active={r.page === 'trash'} onClick={nav({ page: 'trash' })} count={s.trashAssets.length + s.trashFolders.length} />
        </nav>
        <Pinned current={current} />
        <div className="side-label">Folders</div>
        <div className="tree">
          {s.children(null).map((f) => (
            <TreeNode key={f.id} f={f} depth={0} current={current} />
          ))}
          {!s.children(null).length && <p className="side-empty">No folders yet</p>}
        </div>
        <nav className={`nav bottom manage${manageOpen ? ' open' : ''}`} aria-label="Manage">
          <button className={`nav-item manage-toggle${manageActive && !manageOpen ? ' on' : ''}`} aria-expanded={manageOpen} onClick={() => toggleManage()}>
            <IGrid />
            <span>Manage</span>
            <IChevR className="manage-chev" />
          </button>
          <div className="manage-body">
            <div>
              <NavItem icon={<IChart />} label="Insights" active={r.page === 'insights'} onClick={nav({ page: 'insights' })} />
              <NavItem icon={<IPulse />} label="Activity" active={r.page === 'activity'} onClick={nav({ page: 'activity' })} />
              {s.isOwner && <NavItem icon={<IUsers />} label="Team" active={r.page === 'team'} onClick={nav({ page: 'team' })} />}
            </div>
          </div>
        </nav>
      </aside>
      <div className="side-scrim" onClick={() => setMenu(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn burger" aria-label="Menu" onClick={() => setMenu((v) => !v)}>
            <span />
            <span />
          </button>
          <button className="search-pill" onClick={() => setSpot(true)} aria-label="Search (⌘K)">
            <ISearch />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          {s.canEdit && current && (
            <input ref={upRef} type="file" multiple hidden onChange={(e) => (s.upload(Array.from(e.target.files ?? []), current), (e.target.value = ''))} />
          )}
          <div className="topbar-right">
            <MenuButton
              label="Account"
              icon={<UserAvatar user={s.me} />}
              items={[
                { label: `${s.me.name} · ${s.me.role}`, onClick: nav({ page: 'settings', tab: 'account' }) },
                'sep',
                { label: 'Settings', icon: <IGear />, onClick: nav({ page: 'settings', tab: 'account' }) },
                { label: 'Appearance', icon: theme === 'dark' ? <IMoonLine /> : theme === 'light' ? <ISun /> : theme === '3d' ? <ISparkles /> : <IAuto />, onClick: nav({ page: 'settings', tab: 'appearance' }) },
                { label: 'Sign out', icon: <ISignOut />, onClick: signOut },
              ]}
            />
          </div>
        </header>
        <main className="content" key={r.page + (r.page === 'folder' ? r.id ?? '' : r.page === 'client' ? r.id : '')}>
          <Page route={r} />
        </main>
      </div>

      <Spotlight open={spot} onClose={() => setSpot(false)} onUpload={s.canEdit && current ? () => upRef.current?.click() : null} />
      <AssetSheet />
      <UploadTray />
      <Toasts />
    </div>
  );
}
