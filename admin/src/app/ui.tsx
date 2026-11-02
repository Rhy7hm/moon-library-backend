/* Building blocks shared by every page. Styles: app.css. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { adFormat } from '@/lib/adformat';
import { extOf, fileUrl, mainFile, nameOf, titleOf, type Asset, type Folder } from './api';
import { isDesignFile } from './derive/derive-design';
import { extColor, fmtDuration, fmtSize, typeOf } from './format';
import { IAudio, ICheck, IChevR, IDoc, IFile, IFolder, IImage, IMore, IPen, IVideo, IX } from './icons';
import { useStore } from './store';
import { useTheme } from './theme';

/* ---------------- buttons ---------------- */

export function Button({
  children,
  kind = 'secondary',
  size,
  icon,
  ...rest
}: { kind?: 'primary' | 'secondary' | 'plain' | 'danger'; size?: 'sm'; icon?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn ${kind}${size ? ' ' + size : ''}${children ? '' : ' icon-only'}`} {...rest}>
      {icon}
      {children && <span>{children}</span>}
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

export function MenuButton({ items, label = 'More', icon = <IMore />, align = 'right' }: { items: MenuItem[]; label?: string; icon?: ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const shown = items.filter((x, i, a) => x !== 'sep' || (i > 0 && i < a.length - 1 && a[i - 1] !== 'sep'));
  if (!shown.length) return null;
  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}
      </button>
      {open && (
        <div className={`menu ${align}`} role="menu">
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
        </div>
      )}
    </div>
  );
}

/* ---------------- dialogs ---------------- */

export function Dialog({ title, children, onClose, footer, wide }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
    </div>
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
export function FolderPicker({ title, exclude = [], onPick, onClose }: { title: string; exclude?: string[]; onPick: (id: string) => void; onClose: () => void }) {
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
          <Button kind="primary" disabled={!sel} onClick={() => sel && onPick(sel)}>
            Move here
          </Button>
        </>
      }
    >
      <div className="pick-list">
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
}: {
  asset: Asset;
  selected: boolean;
  selecting: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onOpen: () => void;
  menu: MenuItem[];
  where?: string;
}) {
  const f = mainFile(asset);
  return (
    <div
      className={`card${selected ? ' selected' : ''}`}
      tabIndex={0}
      onClick={(e) => (selecting || e.metaKey || e.ctrlKey || e.shiftKey ? onToggle(e) : onOpen())}
      onKeyDown={(e) => (e.key === 'Enter' ? onOpen() : e.key === ' ' && (e.preventDefault(), onToggle(e as unknown as React.MouseEvent)))}
      draggable={false}
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
  return (
    <div className="folder" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <FolderGlyph f={folder} />
      <div className="folder-text">
        <strong title={nameOf(folder)}>{nameOf(folder)}</strong>
        <small>{count === 1 ? '1 item' : `${count} items`}</small>
      </div>
      <MenuButton items={menu} />
    </div>
  );
}

export function Crumbs({ id }: { id: string | null }) {
  const { path, go } = useStore();
  const p = path(id);
  return (
    <nav className="crumbs" aria-label="Path">
      <button onClick={() => go({ page: 'folder', id: null })}>Library</button>
      {p.map((f, i) => (
        <span key={f.id}>
          <IChevR />
          {i === p.length - 1 ? <b aria-current="page">{nameOf(f)}</b> : <button onClick={() => go({ page: 'folder', id: f.id })}>{nameOf(f)}</button>}
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
