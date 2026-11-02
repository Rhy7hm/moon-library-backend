/* The library: folder browser, Recent and search results, all built on one file grid. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { fileUrl, mainFile, nameOf, titleOf, type Asset, type Folder } from './api';
import { fmtDate, fmtSize, matchesType, typeOf, type TypeFilter } from './format';
import { IClock, IDownload, IFolder, IGrid, IList, IMove, IPencil, IPlus, ISearch, IShare, ITrash, IUpload, IX } from './icons';
import { ClientAvatar, ShareWithClients } from './clients';
import { useFileDrop, useStore } from './store';
import { AssetBadges, AssetCard, Button, Crumbs, Empty, FolderPicker, FolderTile, PageHeader, PromptDialog, Segmented, Thumb, TypeIcon, type MenuItem } from './ui';

type Sort = 'new' | 'old' | 'name' | 'size';
type View = 'grid' | 'list';

const pref = <T extends string>(k: string, d: T): T => {
  try {
    return (localStorage.getItem('moonlib.' + k) as T) || d;
  } catch {
    return d;
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem('moonlib.' + k, v);
  } catch {
    /* private mode */
  }
};

function download(asset: Asset) {
  const f = mainFile(asset);
  if (!f) return;
  const a = document.createElement('a');
  a.href = fileUrl(f.orig, f.name);
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Several files as one ZIP of the originals, streamed by the server. */
function downloadZip(assets: Asset[]) {
  const ids = assets.map((a) => mainFile(a)?.id).filter(Boolean).join(',');
  const name = `Moon Library ${new Date().toISOString().slice(0, 10)}`;
  window.location.href = `/zip?v=${ids}&o=1&name=${encodeURIComponent(name)}`;
}

/* ---------------- dialogs a page can open ---------------- */

type Ask =
  | { kind: 'rename-asset'; asset: Asset }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'new-folder'; parentId: string | null }
  | { kind: 'move'; itemIds: string[]; folderIds: string[] }
  | { kind: 'share'; target: 'folder' | 'item'; id: string; label: string }
  | null;

function useActions() {
  const s = useStore();
  const [ask, setAsk] = useState<Ask>(null);

  const trashAssets = (ids: string[]) =>
    s.run('trash', { folderIds: [], itemIds: ids }, ids.length === 1 ? 'Moved to Trash' : `Moved ${ids.length} files to Trash`, () =>
      s.run('restore', { folderIds: [], itemIds: ids }),
    );
  const trashFolder = (f: Folder) => s.run('trash', { folderIds: [f.id], itemIds: [] }, `“${nameOf(f)}” moved to Trash`, () => s.run('restore', { folderIds: [f.id], itemIds: [] }));

  const assetMenu = (a: Asset): MenuItem[] => [
    { label: 'Open', icon: <IFolder />, onClick: () => s.openSheet(a.id) },
    { label: 'Download', icon: <IDownload />, onClick: () => download(a) },
    ...(s.canEdit
      ? ([
          'sep',
          { label: 'Rename', icon: <IPencil />, onClick: () => setAsk({ kind: 'rename-asset', asset: a }) },
          { label: 'Move to…', icon: <IMove />, onClick: () => setAsk({ kind: 'move', itemIds: [a.id], folderIds: [] }) },
          { label: 'Share with client…', icon: <IShare />, onClick: () => setAsk({ kind: 'share', target: 'item', id: a.id, label: titleOf(a) }) },
          'sep',
          { label: 'Move to Trash', icon: <ITrash />, danger: true, onClick: () => trashAssets([a.id]) },
        ] as MenuItem[])
      : []),
  ];

  const folderMenu = (f: Folder): MenuItem[] =>
    s.canEdit
      ? [
          { label: 'Rename', icon: <IPencil />, onClick: () => setAsk({ kind: 'rename-folder', folder: f }) },
          { label: 'Move to…', icon: <IMove />, onClick: () => setAsk({ kind: 'move', itemIds: [], folderIds: [f.id] }) },
          { label: 'Share with client…', icon: <IShare />, onClick: () => setAsk({ kind: 'share', target: 'folder', id: f.id, label: nameOf(f) }) },
          'sep',
          { label: 'Move to Trash', icon: <ITrash />, danger: true, onClick: () => trashFolder(f) },
        ]
      : [];

  const dialogs =
    ask?.kind === 'rename-asset' ? (
      <PromptDialog
        title="Rename"
        label="Name"
        initial={titleOf(ask.asset)}
        action="Save"
        onClose={() => setAsk(null)}
        onSubmit={(v) => (setAsk(null), s.run('item.update', { id: ask.asset.id, title: { ...ask.asset.title, en: v } }, 'Renamed'))}
      />
    ) : ask?.kind === 'rename-folder' ? (
      <PromptDialog
        title="Rename folder"
        label="Folder name"
        initial={nameOf(ask.folder)}
        action="Save"
        onClose={() => setAsk(null)}
        onSubmit={(v) => (setAsk(null), s.run('folder.update', { id: ask.folder.id, name: { ...ask.folder.name, en: v } }, 'Folder renamed'))}
      />
    ) : ask?.kind === 'new-folder' ? (
      <PromptDialog
        title="New folder"
        label="Folder name"
        action="Create"
        onClose={() => setAsk(null)}
        onSubmit={async (v) => {
          setAsk(null);
          const r = await s.run<{ id: string }>('folder.create', { parentId: ask.parentId, name: { en: v } }, `Created “${v}”`);
          if (r?.id) s.go({ page: 'folder', id: r.id });
        }}
      />
    ) : ask?.kind === 'move' ? (
      <FolderPicker
        title={ask.itemIds.length + ask.folderIds.length === 1 ? 'Move to' : `Move ${ask.itemIds.length + ask.folderIds.length} items to`}
        exclude={ask.folderIds}
        onClose={() => setAsk(null)}
        onPick={(target) => (setAsk(null), s.run('move', { folderIds: ask.folderIds, itemIds: ask.itemIds, targetId: target }, 'Moved'))}
      />
    ) : ask?.kind === 'share' ? (
      <ShareWithClients kind={ask.target} id={ask.id} label={ask.label} onClose={() => setAsk(null)} />
    ) : null;

  return { assetMenu, folderMenu, setAsk, trashAssets, dialogs };
}

/* ---------------- the file grid ---------------- */

function FileGrid({ assets, showWhere, empty }: { assets: Asset[]; showWhere?: boolean; empty: React.ReactNode }) {
  const s = useStore();
  const { assetMenu, setAsk, trashAssets, dialogs } = useActions();
  const [type, setType] = useState<TypeFilter>(() => pref('type', 'all'));
  const [sort, setSort] = useState<Sort>(() => pref('sort', 'new'));
  const [view, setView] = useState<View>(() => pref('view', 'grid'));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);

  const shown = useMemo(() => {
    const list = assets.filter((a) => matchesType(a, type));
    const by = {
      new: (a: Asset, b: Asset) => b.date - a.date,
      old: (a: Asset, b: Asset) => a.date - b.date,
      name: (a: Asset, b: Asset) => titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true }),
      size: (a: Asset, b: Asset) => (mainFile(b)?.size ?? 0) - (mainFile(a)?.size ?? 0),
    }[sort];
    return [...list].sort(by);
  }, [assets, type, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: assets.length, image: 0, video: 0, document: 0, design: 0 };
    for (const a of assets) {
      const t = typeOf(mainFile(a));
      if (t in c) c[t]++;
    }
    return c;
  }, [assets]);

  const toggle = (id: string, e?: React.MouseEvent) => {
    setSel((cur) => {
      const next = new Set(cur);
      if (e?.shiftKey && anchor.current) {
        const ids = shown.map((a) => a.id);
        const [i, j] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
        if (i >= 0) ids.slice(i, j + 1).forEach((x) => next.add(x));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  };
  const selected = shown.filter((a) => sel.has(a.id));
  const where = (a: Asset) => (showWhere ? s.path(a.folderId).map(nameOf).join(' › ') : undefined);

  const typeOpts: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: `All` },
    { value: 'image', label: 'Images' },
    { value: 'video', label: 'Videos' },
    { value: 'document', label: 'Docs' },
    { value: 'design', label: 'Design' },
  ];

  return (
    <>
      {assets.length > 0 && (
        <div className="toolbar">
          <Segmented
            label="File type"
            value={type}
            onChange={(v) => (setType(v), save('type', v), setSel(new Set()))}
            options={typeOpts.map((o) => ({ value: o.value, label: <>{o.label} <i className="count">{counts[o.value]}</i></> }))}
          />
          <div className="toolbar-right">
            <select className="select" value={sort} aria-label="Sort" onChange={(e) => (setSort(e.target.value as Sort), save('sort', e.target.value))}>
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
              <option value="name">Name</option>
              <option value="size">Largest first</option>
            </select>
            <Segmented
              label="View"
              value={view}
              onChange={(v) => (setView(v), save('view', v))}
              options={[
                { value: 'grid', label: <IGrid />, title: 'Grid' },
                { value: 'list', label: <IList />, title: 'List' },
              ]}
            />
          </div>
        </div>
      )}

      {!shown.length ? (
        assets.length ? <p className="muted pad">No {typeOpts.find((o) => o.value === type)!.label.toLowerCase()} here.</p> : empty
      ) : view === 'grid' ? (
        <div className="grid" key={type + sort}>
          {shown.map((a) => (
            <AssetCard key={a.id} asset={a} selected={sel.has(a.id)} selecting={sel.size > 0} onToggle={(e) => toggle(a.id, e)} onOpen={() => s.openSheet(a.id)} menu={assetMenu(a)} where={where(a)} />
          ))}
        </div>
      ) : (
        <div className="table" role="table" key={type + sort}>
          <div className="tr th" role="row">
            <span />
            <span>Name</span>
            <span>Type</span>
            <span>Size</span>
            <span>Added</span>
          </div>
          {shown.map((a) => {
            const f = mainFile(a);
            return (
              <div key={a.id} className={`tr${sel.has(a.id) ? ' selected' : ''}`} role="row" onClick={(e) => (sel.size || e.metaKey || e.ctrlKey || e.shiftKey ? toggle(a.id, e) : s.openSheet(a.id))}>
                <span className="tr-thumb">
                  <Thumb asset={a} />
                </span>
                <span className="tr-name">
                  <strong>{titleOf(a)}</strong>
                  <small>{where(a) || f?.name}</small>
                </span>
                <span className="tr-type">
                  {f && <TypeIcon name={f.name} kind={f.kind} />}
                  <AssetBadges asset={a} />
                </span>
                <span>{f ? fmtSize(f.size) : '—'}</span>
                <span>{fmtDate(a.date)}</span>
              </div>
            );
          })}
        </div>
      )}

      {selected.length > 0 && (
        <div className="selbar" role="toolbar" aria-label="Selection">
          <button className="icon-btn" aria-label="Clear selection" onClick={() => setSel(new Set())}>
            <IX />
          </button>
          <strong>{selected.length} selected</strong>
          <Button size="sm" kind="plain" onClick={() => setSel(new Set(shown.map((a) => a.id)))}>
            Select all
          </Button>
          <span className="selbar-gap" />
          <Button size="sm" icon={<IDownload />} onClick={() => (selected.length === 1 ? download(selected[0]) : downloadZip(selected))}>
            {selected.length === 1 ? 'Download' : 'Download ZIP'}
          </Button>
          {s.canEdit && (
            <>
              <Button size="sm" icon={<IMove />} onClick={() => setAsk({ kind: 'move', itemIds: selected.map((a) => a.id), folderIds: [] })}>
                Move
              </Button>
              <Button size="sm" kind="danger" icon={<ITrash />} onClick={() => (trashAssets(selected.map((a) => a.id)), setSel(new Set()))}>
                Delete
              </Button>
            </>
          )}
        </div>
      )}
      {dialogs}
    </>
  );
}

/* ---------------- pages ---------------- */

export function FolderPage({ id }: { id: string | null }) {
  const s = useStore();
  const { folderMenu, setAsk, dialogs } = useActions();
  const input = useRef<HTMLInputElement>(null);
  const folder = id ? s.byId.get(id) : null;
  const sub = s.children(id);
  const assets = s.assetsIn(id);
  const shared = id ? s.sharedWith('folder', id) : [];

  const onFiles = useCallback((files: File[]) => files.length && s.upload(files, id), [s, id]);
  const over = useFileDrop(onFiles, s.canEdit && !!id);

  if (id && (!folder || folder.deletedAt)) {
    return <Empty icon={<IFolder />} title="Folder not found" text="It may have been moved to Trash." action={<Button onClick={() => s.go({ page: 'folder', id: null })}>Back to Library</Button>} />;
  }
  const count = (f: Folder) => s.children(f.id).length + s.assetsIn(f.id).length;

  return (
    <div className="page">
      <PageHeader
        title={folder ? nameOf(folder) : 'Library'}
        sub={folder ? `${sub.length ? `${sub.length} ${sub.length === 1 ? 'folder' : 'folders'} · ` : ''}${assets.length} ${assets.length === 1 ? 'file' : 'files'} · ${fmtSize(assets.reduce((n, a) => n + (mainFile(a)?.size ?? 0), 0))}` : 'All your folders. Open one to upload and manage its files.'}
        actions={
          s.canEdit && (
            <>
              {id && folder && (
                <Button icon={<IShare />} onClick={() => setAsk({ kind: 'share', target: 'folder', id, label: nameOf(folder) })}>
                  Share
                </Button>
              )}
              <Button icon={<IPlus />} onClick={() => setAsk({ kind: 'new-folder', parentId: id })}>
                New folder
              </Button>
              {id && (
                <Button kind="primary" icon={<IUpload />} onClick={() => input.current?.click()}>
                  Upload
                </Button>
              )}
            </>
          )
        }
      >
        {id && <Crumbs id={id} />}
      </PageHeader>
      <input ref={input} type="file" multiple hidden onChange={(e) => (onFiles(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
      {id && shared.length > 0 && (
        <div className="shared-strip">
          <IShare />
          <span>Visible to</span>
          {shared.map((c) => (
            <button key={c.id} className="shared-chip" onClick={() => s.go({ page: 'client', id: c.id })}>
              <ClientAvatar c={c} size={18} />
              {c.name}
            </button>
          ))}
        </div>
      )}

      {sub.length > 0 && (
        <section>
          <h2 className="section-title">Folders</h2>
          <div className="folders">
            {sub.map((f) => (
              <FolderTile key={f.id} folder={f} count={count(f)} onOpen={() => s.go({ page: 'folder', id: f.id })} menu={folderMenu(f)} />
            ))}
          </div>
        </section>
      )}

      {id ? (
        <section>
          {sub.length > 0 && assets.length > 0 && <h2 className="section-title">Files</h2>}
          <FileGrid
            assets={assets}
            empty={
              <div className={`dropzone${s.canEdit ? '' : ' off'}`} onClick={() => s.canEdit && input.current?.click()}>
                <IUpload />
                <strong>{s.canEdit ? 'Drop files or folders here' : 'No files yet'}</strong>
                <span>{s.canEdit ? 'Images, videos, PDFs, Office files, PSD and AI — previews are made automatically.' : 'Files uploaded by your team will show here.'}</span>
              </div>
            }
          />
        </section>
      ) : (
        !sub.length && (
          <Empty
            icon={<IFolder />}
            title="Create your first folder"
            text="Organise by client, campaign or brand — for example “Client A / CNY 2027”."
            action={s.canEdit && <Button kind="primary" icon={<IPlus />} onClick={() => setAsk({ kind: 'new-folder', parentId: null })}>New folder</Button>}
          />
        )
      )}

      {over && (
        <div className="drop-overlay">
          <div>
            <IUpload />
            <strong>Drop to upload to “{folder ? nameOf(folder) : ''}”</strong>
          </div>
        </div>
      )}
      {dialogs}
    </div>
  );
}

export function RecentPage() {
  const s = useStore();
  const week = Date.now() - 14 * 864e5;
  const list = s.assets.filter((a) => a.date >= week);
  return (
    <div className="page">
      <PageHeader title="Recent" sub="Everything added in the last 14 days, newest first." />
      <FileGrid assets={list} showWhere empty={<Empty icon={<IClock />} title="Nothing new" text="Files uploaded in the last 14 days show here." />} />
    </div>
  );
}

export function SearchPage({ q }: { q: string }) {
  const s = useStore();
  const needle = q.trim().toLowerCase();
  const folders = needle ? s.folders.filter((f) => nameOf(f).toLowerCase().includes(needle)) : [];
  const list = needle
    ? s.assets.filter((a) => titleOf(a).toLowerCase().includes(needle) || a.variants.some((v) => v.name.toLowerCase().includes(needle)) || (a.createdBy ?? '').toLowerCase().includes(needle))
    : [];
  const { folderMenu, dialogs } = useActions();
  return (
    <div className="page">
      <PageHeader title={needle ? `Results for “${q.trim()}”` : 'Search'} sub={needle ? `${folders.length + list.length} found` : 'Type in the search box above.'} />
      {folders.length > 0 && (
        <section>
          <h2 className="section-title">Folders</h2>
          <div className="folders">
            {folders.map((f) => (
              <FolderTile key={f.id} folder={f} count={s.children(f.id).length + s.assetsIn(f.id).length} onOpen={() => s.go({ page: 'folder', id: f.id })} menu={folderMenu(f)} />
            ))}
          </div>
        </section>
      )}
      <FileGrid assets={list} showWhere empty={needle && !folders.length ? <Empty icon={<ISearch />} title="No results" text="Try another word — names, file names and uploaders are searched." /> : null} />
      {dialogs}
    </div>
  );
}
