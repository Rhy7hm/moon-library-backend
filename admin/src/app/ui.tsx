/* Building blocks shared by every page. Styles: app.css. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { adFormat } from '@/lib/adformat';
import { extOf, fileUrl, mainFile, nameOf, titleOf, type Asset, type Folder, type Me } from './api';
import { isDesignFile } from './derive/derive-design';
import { extColor, fmtDuration, fmtSize, typeOf } from './format';
import { IAudio, ICheck, IChevR, ICopy, IDoc, IFile, IFolder, IImage, IMore, IPen, IVideo, IX } from './icons';
import { useStore } from './store';
import { useTheme } from './theme';

/* ---------------- buttons ---------------- */

export function Button({
  children,
  kind = 'secondary',
  size,
  icon,
  reveal,
  ...rest
}: { kind?: 'primary' | 'secondary' | 'plain' | 'danger'; size?: 'sm'; icon?: ReactNode; reveal?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // reveal: just the icon until hovered or focused, then the label slides out
  return (
    <button type="button" className={`btn ${kind}${size ? ' ' + size : ''}${children ? '' : ' icon-only'}${reveal && children ? ' reveal' : ''}`} {...rest}>
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}

/* ---------------- moving by drag and drop ---------------- */
// Drag file cards and folder tiles onto a folder (tile, sidebar row or path crumb) to move them there.

const DRAG_TYPE = 'application/x-moonlib-move';
export type DragLoad = { items: string[]; folders: string[] };

export function startDrag(e: React.DragEvent, load: DragLoad) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(load));
  e.dataTransfer.effectAllowed = 'move';
  const n = load.items.length + load.folders.length;
  const what = !load.folders.length ? 'file' : !load.items.length ? 'folder' : 'item';
  // a small "3 files" pill under the pointer instead of a ghost of the whole card
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = `${n} ${what}${n === 1 ? '' : 's'}`;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 14, 14);
  setTimeout(() => ghost.remove(), 0);
  document.body.classList.add('is-moving');
}
export const endDrag = () => document.body.classList.remove('is-moving');

/** Props that make an element a place to drop dragged files and folders; target null = the Library itself. */
export function useMoveDrop(target: string | null, label: string) {
  const s = useStore();
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  if (!s.canEdit) return { over: false, dropProps: {} };
  const has = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!has(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      endDrag();
      let load: DragLoad;
      try {
        load = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
      } catch {
        return;
      }
      const above = new Set(s.path(target).map((f) => f.id));
      // leave out what's already there, and a folder dropped on itself or on a folder inside it
      const folders = (load.folders ?? []).filter((id) => id !== target && !above.has(id) && (s.byId.get(id)?.parentId ?? null) !== target);
      const here = target ?? s.looseFolderId;
      const items = (load.items ?? []).filter((id) => s.assets.find((a) => a.id === id)?.folderId !== here);
      const n = folders.length + items.length;
      if (!n) return;
      const what = !folders.length ? 'file' : !items.length ? 'folder' : 'item';
      void s.run('move', { itemIds: items, folderIds: folders, targetId: target }, `Moved ${n} ${what}${n === 1 ? '' : 's'} to “${label}”`);
    },
  };
  return { over, dropProps };
}

/** Staff avatar: photo when set, otherwise the first letter of the name. */
export function UserAvatar({
  user,
  size = 'md',
  previewUrl,
}: {
  user: Pick<Me, 'name'> & { avatarKey?: string | null };
  size?: 'sm' | 'md' | 'lg';
  previewUrl?: string | null;
}) {
  const cls = size === 'lg' ? 'avatar lg' : size === 'sm' ? 'avatar sm' : 'avatar';
  const src = previewUrl || (user.avatarKey ? fileUrl(user.avatarKey) : '');
  if (src) {
    return (
      <span className={`${cls} has-photo`}>
        <img src={src} alt="" draggable={false} />
      </span>
    );
  }
  return <span className={cls}>{user.name.slice(0, 1).toUpperCase()}</span>;
}

/** Inline copy control: clipboard icon morphs into a check, then settles back. */
export function CopyButton({ value, label = 'Copy', toastText = 'Copied' }: { value: string; label?: string; toastText?: string }) {
  const s = useStore();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      s.toast(toastText, { tone: 'ok' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button
      type="button"
      className={`copy-btn${copied ? ' is-copied' : ''}`}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={copy}
    >
      <span className="copy-btn-icons" aria-hidden>
        <ICopy className="copy-icon" />
        <ICheck className="check-icon" />
      </span>
    </button>
  );
}

/** iOS-style segmented control with a sliding thumb. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="seg" role="radiogroup" aria-label={label} ref={ref}>
      {thumb && <span className="seg-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />}
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- popover menu ---------------- */

export type MenuItem = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean } | { heading: string } | 'sep';

/**
 * A "…" button with a menu. The menu is drawn on the page's top layer (a portal on <body>), placed by
 * the button and flipped above it when there's no room below — so cards, sticky bars and anything with
 * its own layer can never cover it.
 */
export function MenuButton({ items, label = 'More', icon = <IMore />, align = 'right' }: { items: MenuItem[]; label?: string; icon?: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; up: boolean } | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // the menu is pinned to the screen, so it closes when the page moves under it
    const away = (e: Event) => !menu.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);
  // place it under the button (or above, if it would run off the bottom), inside the window
  useLayoutEffect(() => {
    if (!open || !btn.current) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? 0;
    const w = menu.current?.offsetWidth ?? 200;
    const up = r.bottom + 4 + h > innerHeight - 8 && r.top - 4 - h > 8;
    const top = up ? r.top - 4 - h : Math.min(r.bottom + 4, innerHeight - 8 - h);
    setPos(
      align === 'right'
        ? { top, right: Math.max(8, Math.min(innerWidth - r.right, innerWidth - 8 - w)), up }
        : { top, left: Math.max(8, Math.min(r.left, innerWidth - 8 - w)), up },
    );
  }, [open, align]);
  const shown = items.filter((x, i, a) => x !== 'sep' || (i > 0 && i < a.length - 1 && a[i - 1] !== 'sep'));
  if (!shown.length) return null;
  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button ref={btn} type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className={`menu floating ${align}${pos?.up ? ' up' : ''}`}
            role="menu"
            style={pos ? { top: pos.top, left: pos.left ?? 'auto', right: pos.right ?? 'auto' } : { visibility: 'hidden', top: 0, left: 0, right: 'auto' }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {shown.map((x, i) =>
              x === 'sep' ? (
                <hr key={i} />
              ) : 'heading' in x ? (
                <div key={i} className="menu-heading">
                  {x.heading}
                </div>
              ) : (
                <button
                  key={i}
                  role={x.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={x.checked}
                  className={x.danger ? 'danger' : ''}
                  disabled={x.disabled}
                  onClick={() => (setOpen(false), x.onClick())}
                >
                  {x.icon}
                  <span>{x.label}</span>
                  {x.checked && <ICheck className="menu-check" />}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ---------------- dialogs ---------------- */

export function Dialog({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  const scrim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // with a dialog opened from inside another, Escape closes only the top one
    const esc = (e: KeyboardEvent) => {
      const all = document.querySelectorAll('.scrim');
      if (e.key === 'Escape' && all[all.length - 1] === scrim.current) onClose();
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  // on <body>, so a dialog opened from inside another isn't trapped in its box
  return createPortal(
    <div className="scrim" ref={scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IX />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function PromptDialog({ title, label, initial = '', action, onSubmit, onClose }: { title: string; label: string; initial?: string; action: string; onSubmit: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!v.trim()} onClick={() => onSubmit(v.trim())}>
            {action}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), v.trim() && onSubmit(v.trim()))}>
        <label className="field">
          <span>{label}</span>
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({ title, text, action, danger, onConfirm, onClose }: { title: string; text: ReactNode; action: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {action}
          </Button>
        </>
      }
    >
      <p className="muted">{text}</p>
    </Dialog>
  );
}

/** Pick a destination folder (folders being moved and their insides can't be chosen). */
const TOP = '__library__'; // the Library itself, as a choice in the folder picker

export function FolderPicker({ title, exclude = [], onPick, onClose }: { title: string; exclude?: string[]; onPick: (id: string | null) => void; onClose: () => void }) {
  const { children: kids } = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const blocked = new Set(exclude);
  const Row = ({ f, depth }: { f: Folder; depth: number }) => {
    const off = blocked.has(f.id);
    return (
      <>
        <button type="button" className={`pick-row${sel === f.id ? ' on' : ''}`} disabled={off} style={{ paddingLeft: 12 + depth * 18 }} onClick={() => setSel(f.id)}>
          <FolderGlyph f={f} small />
          <span>{nameOf(f)}</span>
          {sel === f.id && <ICheck className="pick-check" />}
        </button>
        {!off && kids(f.id).map((c) => <Row key={c.id} f={c} depth={depth + 1} />)}
      </>
    );
  };
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="primary" disabled={!sel} onClick={() => sel && onPick(sel === TOP ? null : sel)}>
            Move here
          </Button>
        </>
      }
    >
      <div className="pick-list">
        <button type="button" className={`pick-row${sel === TOP ? ' on' : ''}`} style={{ paddingLeft: 12 }} onClick={() => setSel(TOP)}>
          <IFolder />
          <span>Library (not in a folder)</span>
          {sel === TOP && <ICheck className="pick-check" />}
        </button>
        {kids(null).map((f) => (
          <Row key={f.id} f={f} depth={0} />
        ))}
      </div>
    </Dialog>
  );
}

/* ---------------- toasts + upload tray ---------------- */

export function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone ?? ''}`}>
          {t.tone === 'ok' && <ICheck />}
          <span>{t.text}</span>
          {t.undo && (
            <button onClick={() => (dismiss(t.id), t.undo!())}>Undo</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function UploadTray() {
  const { uploads, clearUploads } = useStore();
  const [open, setOpen] = useState(true);
  if (!uploads.length) return null;
  const busy = uploads.filter((u) => u.state === 'working' || u.state === 'waiting').length;
  const failed = uploads.filter((u) => u.state === 'failed').length;
  const pct = Math.round(uploads.reduce((n, u) => n + u.pct, 0) / uploads.length);
  return (
    <div className="tray">
      <header onClick={() => setOpen((v) => !v)}>
        <div className="tray-ring" style={{ ['--p' as string]: `${busy ? pct : 100}%` }}>{busy ? '' : <ICheck />}</div>
        <div>
          <strong>{busy ? `Uploading ${busy} ${busy === 1 ? 'file' : 'files'}…` : failed ? `${failed} upload${failed === 1 ? '' : 's'} failed` : 'Uploads complete'}</strong>
          <small>{busy ? `${pct}%` : `${uploads.length - failed} of ${uploads.length} done`}</small>
        </div>
        {!busy && (
          <button className="icon-btn" aria-label="Close" onClick={(e) => (e.stopPropagation(), clearUploads())}>
            <IX />
          </button>
        )}
      </header>
      {open && (
        <ul>
          {uploads.map((u) => (
            <li key={u.id} className={u.state}>
              <span className="tray-name" title={u.error || u.name}>
                {u.name}
              </span>
              <span className="tray-meta">{u.state === 'failed' ? 'Failed' : u.state === 'done' ? fmtSize(u.size) : `${u.pct}%`}</span>
              <span className="tray-bar">
                <i style={{ width: `${u.state === 'failed' ? 100 : u.pct}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- files and folders ---------------- */

export function TypeIcon({ name, kind }: { name: string; kind: string }) {
  if (isDesignFile(name)) return <IPen />;
  if (kind === 'image') return <IImage />;
  if (kind === 'video') return <IVideo />;
  if (kind === 'audio') return <IAudio />;
  if (kind === 'document') return <IDoc />;
  return <IFile />;
}

/** The picture for an asset: its thumbnail, or a tinted file-type tile. */
export function Thumb({ asset, fit = 'cover' }: { asset: Asset; fit?: 'cover' | 'contain' }) {
  const f = mainFile(asset);
  const src = f ? f.thumb ?? f.poster : null;
  const [failed, setFailed] = useState(false);
  if (f && src && !failed) return <img className={`thumb-img ${fit}`} src={fileUrl(src)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
  const color = f ? extColor(f.name) : '#a1a1a6';
  return (
    <div className="thumb-tile" style={{ ['--c' as string]: color }}>
      {f && <TypeIcon name={f.name} kind={f.kind} />}
      <b>{f ? extOf(f.name).toUpperCase() || 'FILE' : 'EMPTY'}</b>
    </div>
  );
}

export function AssetBadges({ asset }: { asset: Asset }) {
  const f = mainFile(asset);
  if (!f) return null;
  const fmt = f.kind === 'image' || f.kind === 'video' ? adFormat(f.w, f.h) : null;
  return (
    <span className="badges">
      {f.kind === 'video' && f.dur ? <span className="badge dark">{fmtDuration(f.dur)}</span> : null}
      {fmt && (
        <span className="badge" title={fmt.hint}>
          {fmt.ratio}
        </span>
      )}
      {typeOf(f) === 'design' && <span className="badge dark">{extOf(f.name).toUpperCase()}</span>}
      {f.status !== 'ready' && <span className="badge warn">Incomplete</span>}
    </span>
  );
}

export function AssetCard({
  asset,
  selected,
  selecting,
  onToggle,
  onOpen,
  menu,
  where,
  onDragStart,
}: {
  asset: Asset;
  selected: boolean;
  selecting: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onOpen: () => void;
  menu: MenuItem[];
  where?: string;
  /** set to let the card be dragged onto a folder */
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const f = mainFile(asset);
  const { tagById } = useStore();
  const tags = (asset.tags ?? []).map((id) => tagById.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  return (
    <div
      className={`card${selected ? ' selected' : ''}`}
      tabIndex={0}
      onClick={(e) => (selecting || e.metaKey || e.ctrlKey || e.shiftKey ? onToggle(e) : onOpen())}
      onKeyDown={(e) => (e.key === 'Enter' ? onOpen() : e.key === ' ' && (e.preventDefault(), onToggle(e as unknown as React.MouseEvent)))}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={endDrag}
    >
      <div className="card-media">
        <Thumb asset={asset} />
        <AssetBadges asset={asset} />
        <button
          type="button"
          className="check"
          aria-label={selected ? 'Deselect' : 'Select'}
          aria-pressed={selected}
          onClick={(e) => (e.stopPropagation(), onToggle(e))}
        >
          <ICheck />
        </button>
      </div>
      <div className="card-body">
        <div className="card-title" title={titleOf(asset)}>
          {titleOf(asset)}
        </div>
        <div className="card-meta">
          {where ? <span className="where">{where}</span> : <span>{f ? fmtSize(f.size) : '—'}</span>}
          {f?.w && f?.h ? <span>{f.w} × {f.h}</span> : null}
        </div>
        {tags.length > 0 && (
          <div className="card-tags">
            {tags.slice(0, 2).map((t) => (
              <span key={t.id} className="card-tag" style={{ ['--t' as string]: t.color || '#8e8e93' }}>
                {t.name}
              </span>
            ))}
            {tags.length > 2 && <span className="card-tag more">+{tags.length - 2}</span>}
          </div>
        )}
      </div>
      <div className="card-menu">
        <MenuButton items={menu} />
      </div>
    </div>
  );
}

export function FolderGlyph({ f, small }: { f: Folder; small?: boolean }) {
  const [theme] = useTheme();
  if (theme === '3d') {
    // the 3D theme draws every folder as the same 3D folder picture
    return (
      <span className={`glyph glyph-3d${small ? ' small' : ''}`}>
        <img src={`${import.meta.env.BASE_URL}nav/folder.webp`} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className={`glyph${small ? ' small' : ''}`} style={{ ['--c' as string]: f.iconBg || '#4aa3ff' }}>
      <IFolder />
    </span>
  );
}

export function FolderTile({ folder, count, onOpen, menu }: { folder: Folder; count: number; onOpen: () => void; menu: MenuItem[] }) {
  const s = useStore();
  const { over, dropProps } = useMoveDrop(folder.id, nameOf(folder));
  return (
    <div
      className={`folder${over ? ' drop-on' : ''}`}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      draggable={s.canEdit}
      onDragStart={(e) => startDrag(e, { items: [], folders: [folder.id] })}
      onDragEnd={endDrag}
      {...dropProps}
    >
      <FolderGlyph f={folder} />
      <div className="folder-text">
        <strong title={nameOf(folder)}>{nameOf(folder)}</strong>
        <small>{count === 1 ? '1 item' : `${count} items`}</small>
      </div>
      <MenuButton items={menu} />
    </div>
  );
}

function Crumb({ id, label }: { id: string | null; label: string }) {
  const { go } = useStore();
  const { over, dropProps } = useMoveDrop(id, label);
  return (
    <button className={over ? 'drop-on' : undefined} onClick={() => go({ page: 'folder', id })} {...dropProps}>
      {label}
    </button>
  );
}

export function Crumbs({ id }: { id: string | null }) {
  const { path } = useStore();
  const p = path(id);
  return (
    <nav className="crumbs" aria-label="Path">
      <Crumb id={null} label="Library" />
      {p.map((f, i) => (
        <span key={f.id}>
          <IChevR />
          {i === p.length - 1 ? <b aria-current="page">{nameOf(f)}</b> : <Crumb id={f.id} label={nameOf(f)} />}
        </span>
      ))}
    </nav>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      {children}
      <div className="page-head-row">
        <div>
          <h1>{title}</h1>
          {sub && <p className="muted">{sub}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}
