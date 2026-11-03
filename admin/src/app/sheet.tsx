/* The file sheet: slides in from the right with a big preview, details, versions and actions. */
import { useEffect, useRef, useState } from 'react';
import { adFormat } from '@/lib/adformat';
import { errText, extOf, fileUrl, mainFile, nameOf, op, titleOf, type Asset, type Tag } from './api';
import { fmtDate, fmtDuration, fmtSize, typeOf } from './format';
import { IDownload, IMove, IReplace, IRestore, ITrash, IX, IShare } from './icons';
import { ClientAvatar, ShareWithClients } from './clients';
import { useStore } from './store';
import { TagChip, TagEditor, tagQuery } from './tags';
import { Button, FolderPicker, Thumb } from './ui';

type Version = { id: string; name: string; size: number; reason: string; replaced_at: number; replaced_by: string | null; key_thumb: string | null; key_orig: string };

const INLINE_IMAGE = /^image\/(jpeg|png|webp|gif|avif)$/;

function Preview({ asset }: { asset: Asset }) {
  const f = mainFile(asset);
  if (!f || f.status !== 'ready') return <Thumb asset={asset} fit="contain" />;
  if (f.kind === 'image' && (INLINE_IMAGE.test(f.mime) || f.opt)) return <img src={fileUrl(f.opt && f.optMime?.startsWith('image/') ? f.opt : f.orig)} alt="" />;
  if (f.kind === 'video') return <video src={fileUrl(f.opt && f.optMime?.startsWith('video/') ? f.opt : f.orig)} poster={fileUrl(f.poster) || undefined} controls playsInline preload="metadata" />;
  if (f.kind === 'audio') return <audio src={fileUrl(f.orig)} controls />;
  if (f.mime === 'application/pdf') return <iframe src={fileUrl(f.orig)} title="PDF preview" />;
  return <Thumb asset={asset} fit="contain" />;
}

export function AssetSheet() {
  const s = useStore();
  const asset = s.sheet ? s.tree?.items.find((a) => a.id === s.sheet) : undefined;
  const [title, setTitle] = useState('');
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [moving, setMoving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!asset) return;
    setTitle(titleOf(asset));
    setVersions(null);
    op<{ versions: Version[] }>('versions.list', { itemId: asset.id })
      .then((r) => setVersions(r.versions))
      .catch(() => setVersions([]));
    // re-read when the file changes (replace / restore)
  }, [asset?.id, asset?.variants[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!s.sheet) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('input') && s.openSheet(null);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [s.sheet, s]);

  if (!s.sheet) return null;
  if (!asset) return null;
  const f = mainFile(asset);
  const fmt = f && (f.kind === 'image' || f.kind === 'video') ? adFormat(f.w, f.h) : null;
  const path = s.path(asset.folderId);
  const shared = s.sharedWith('item', asset.id);

  const saveTitle = () => {
    const v = title.trim();
    if (!v || v === titleOf(asset)) return setTitle(titleOf(asset));
    s.run('item.update', { id: asset.id, title: { ...asset.title, en: v } }, 'Renamed');
  };

  const rows: [string, React.ReactNode][] = f
    ? [
        ['Kind', typeOf(f) === 'design' ? `Design file (${extOf(f.name).toUpperCase()})` : `${f.kind[0].toUpperCase()}${f.kind.slice(1)} · ${extOf(f.name).toUpperCase()}`],
        ['Size', fmtSize(f.size)],
        ...(f.w && f.h ? ([['Dimensions', `${f.w} × ${f.h}`]] as [string, string][]) : []),
        ...(fmt ? ([['Format', <span key="f" title={fmt.hint}>{fmt.ratio} · {fmt.use}</span>]] as [string, React.ReactNode][]) : []),
        ...(f.dur ? ([['Length', fmtDuration(f.dur)]] as [string, string][]) : []),
        ['File name', <span key="n" className="wrap">{f.name}</span>],
        ['Folder', path.map(nameOf).join(' › ') || '—'],
        [
          'Tags',
          s.canEdit ? (
            <TagEditor key="tg" itemIds={[asset.id]} />
          ) : (asset.tags ?? []).length ? (
            <span key="tg" className="shared-chips">
              {(asset.tags ?? []).map((id) => s.tagById.get(id)).filter((t): t is Tag => !!t).map((t) => (
                <TagChip key={t.id} tag={t} onClick={() => (s.openSheet(null), s.go({ page: 'search', q: tagQuery(t.name) }))} />
              ))}
            </span>
          ) : (
            'None'
          ),
        ],
        ['Added', `${fmtDate(asset.date, true)}${asset.createdBy ? ` by ${asset.createdBy}` : ''}`],
        [
          'Shared with',
          shared.length ? (
            <span key="sw" className="shared-chips">
              {shared.map((c) => (
                <button key={c.id} className="shared-chip" onClick={() => s.go({ page: 'client', id: c.id })}>
                  <ClientAvatar c={c} size={18} />
                  {c.name}
                </button>
              ))}
            </span>
          ) : (
            'No clients'
          ),
        ],
      ]
    : [];

  return (
    <>
      <div className="sheet-scrim" onClick={() => s.openSheet(null)} />
      <aside className="sheet" aria-label="File details">
        <header className="sheet-head">
          <input
            className="sheet-title"
            value={title}
            disabled={!s.canEdit}
            aria-label="Name"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <button className="icon-btn" aria-label="Close" onClick={() => s.openSheet(null)}>
            <IX />
          </button>
        </header>
        <div className="sheet-body">
          <div className={`preview kind-${f?.kind ?? 'other'}`}>
            <Preview asset={asset} />
          </div>
          <div className="sheet-actions">
            {f && (
              <a className="btn primary" href={fileUrl(f.orig, f.name)} download={f.name}>
                <IDownload />
                <span>Download</span>
              </a>
            )}
            {s.canEdit && (
              <>
                <Button icon={<IReplace />} onClick={() => input.current?.click()}>
                  Replace
                </Button>
                <Button icon={<IMove />} onClick={() => setMoving(true)}>
                  Move
                </Button>
                <Button icon={<IShare />} aria-label="Share with client" title="Share with client" onClick={() => setSharing(true)} />
                <Button
                  kind="danger"
                  icon={<ITrash />}
                  aria-label="Move to Trash"
                  onClick={() => (s.openSheet(null), s.run('trash', { folderIds: [], itemIds: [asset.id] }, 'Moved to Trash', () => op('restore', { folderIds: [], itemIds: [asset.id] })))}
                />
              </>
            )}
            <input ref={input} type="file" hidden onChange={(e) => (e.target.files?.[0] && s.replaceFile(asset, e.target.files[0]), (e.target.value = ''))} />
          </div>

          <dl className="info">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <section className="versions">
            <h3>Versions</h3>
            {versions === null ? (
              <p className="muted small">Loading…</p>
            ) : !versions.length ? (
              <p className="muted small">Only this version. Use Replace to upload a new one — the old one is kept here for 90 days.</p>
            ) : (
              <ul>
                {versions.map((v) => (
                  <li key={v.id}>
                    <span className="v-thumb">{v.key_thumb ? <img src={fileUrl(v.key_thumb)} alt="" /> : <b>{extOf(v.name).toUpperCase()}</b>}</span>
                    <span className="v-text">
                      <strong>{v.name}</strong>
                      <small>
                        {v.reason === 'replaced' ? 'Replaced' : 'Removed'} {fmtDate(v.replaced_at, true)}
                        {v.replaced_by ? ` by ${v.replaced_by}` : ''} · {fmtSize(v.size)}
                      </small>
                    </span>
                    <a className="icon-btn" href={fileUrl(v.key_orig, v.name)} aria-label="Download this version" title="Download">
                      <IDownload />
                    </a>
                    {s.canEdit && (
                      <button
                        className="icon-btn"
                        aria-label="Restore this version"
                        title="Restore"
                        onClick={async () => {
                          try {
                            await op('versions.restore', { id: v.id });
                            await s.reload();
                            s.toast('Version restored', { tone: 'ok' });
                          } catch (e) {
                            s.toast(errText(e), { tone: 'err' });
                          }
                        }}
                      >
                        <IRestore />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </aside>
      {sharing && <ShareWithClients kind="item" id={asset.id} label={titleOf(asset)} onClose={() => setSharing(false)} />}
      {moving && (
        <FolderPicker
          title="Move to"
          onClose={() => setMoving(false)}
          onPick={(target) => (setMoving(false), s.run('move', { folderIds: [], itemIds: [asset.id], targetId: target }, 'Moved'))}
        />
      )}
    </>
  );
}
