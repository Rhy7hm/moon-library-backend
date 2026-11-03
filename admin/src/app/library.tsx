/* The library: folder browser, Recent and search results, all built on one file grid. */
import { useCallback, useMemo, useRef, useState } from 'react';
import { fileUrl, mainFile, nameOf, titleOf, type Asset, type Folder } from './api';
import { fmtDate, fmtSize, matchesType, typeOf, type TypeFilter } from './format';
import { IClock, IDownload, IFolder, IGrid, IList, IMove, IPencil, IPin, IPinOff, IPlus, ISearch, IShare, ITag, ITrash, IUpload, IX } from './icons';
import { ClientAvatar, ShareWithClients } from './clients';
import { useFileDrop, useStore } from './store';
import { isEmpty, KIND_LABEL, KIND_QUERY, matches, parse, withFilter, without, type Token } from './search';
import { TagDialog, tagQuery } from './tags';
import { AssetBadges, AssetCard, Button, Crumbs, Empty, FolderPicker, FolderTile, PageHeader, PromptDialog, Segmented, Thumb, TypeIcon, endDrag, startDrag, type MenuItem } from './ui';

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

/** A whole folder (and its sub-folders, laid out the same way) as one ZIP of the originals. */
function downloadFolder(f: Folder) {
  window.location.href = `/zip?folder=${encodeURIComponent(f.id)}&o=1`;
}

/* ---------------- dialogs a page can open ---------------- */

type Ask =
  | { kind: 'rename-asset'; asset: Asset }
  | { kind: 'rename-folder'; folder: Folder }
  | { kind: 'new-folder'; parentId: string | null }
  | { kind: 'move'; itemIds: string[]; folderIds: string[] }
  | { kind: 'share'; target: 'folder' | 'item'; id: string; ids?: string[]; label: string }
  | { kind: 'tag'; itemIds: string[] }
  | null;

/** The ••• menus for files and folders, and the dialogs they open (also used on the client page). */
export function useActions() {
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

  const folderMenu = (f: Folder): MenuItem[] => [
    // pinning is personal, so everyone can, Viewers too
    s.pins.includes(f.id)
      ? { label: 'Unpin from sidebar', icon: <IPinOff />, onClick: () => s.togglePin(f.id) }
      : { label: 'Pin to sidebar', icon: <IPin />, onClick: () => s.togglePin(f.id) },
    { label: 'Download as ZIP', icon: <IDownload />, onClick: () => downloadFolder(f) },
    ...(s.canEdit
      ? ([
          'sep',
          { label: 'Rename', icon: <IPencil />, onClick: () => setAsk({ kind: 'rename-folder', folder: f }) },
          { label: 'Move to…', icon: <IMove />, onClick: () => setAsk({ kind: 'move', itemIds: [], folderIds: [f.id] }) },
          { label: 'Share with client…', icon: <IShare />, onClick: () => setAsk({ kind: 'share', target: 'folder', id: f.id, label: nameOf(f) }) },
          'sep',
          { label: 'Move to Trash', icon: <ITrash />, danger: true, onClick: () => trashFolder(f) },
        ] as MenuItem[])
      : []),
  ];

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
      <ShareWithClients kind={ask.target} id={ask.id} ids={ask.ids} label={ask.label} onClose={() => setAsk(null)} />
    ) : ask?.kind === 'tag' ? (
      <TagDialog itemIds={ask.itemIds} onClose={() => setAsk(null)} />
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
  const where = (a: Asset) => (showWhere ? s.path(a.folderId).map(nameOf).join(' › ') || 'Library' : undefined);
  // dragging a selected card takes the whole selection along
  const drag = (a: Asset) => (s.canEdit ? (e: React.DragEvent) => startDrag(e, { items: sel.has(a.id) ? selected.map((x) => x.id) : [a.id], folders: [] }) : undefined);

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
            <AssetCard key={a.id} asset={a} selected={sel.has(a.id)} selecting={sel.size > 0} onToggle={(e) => toggle(a.id, e)} onOpen={() => s.openSheet(a.id)} menu={assetMenu(a)} where={where(a)} onDragStart={drag(a)} />
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
              <div
                key={a.id}
                className={`tr${sel.has(a.id) ? ' selected' : ''}`}
                role="row"
                onClick={(e) => (sel.size || e.metaKey || e.ctrlKey || e.shiftKey ? toggle(a.id, e) : s.openSheet(a.id))}
                draggable={s.canEdit}
                onDragStart={drag(a)}
                onDragEnd={endDrag}
              >
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
              <Button size="sm" icon={<ITag />} onClick={() => setAsk({ kind: 'tag', itemIds: selected.map((a) => a.id) })}>
                Tag
              </Button>
              <Button
                size="sm"
                icon={<IShare />}
                onClick={() => setAsk({ kind: 'share', target: 'item', id: selected[0].id, ids: selected.map((a) => a.id), label: titleOf(selected[0]) })}
              >
                Share
              </Button>
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
  const over = useFileDrop(onFiles, s.canEdit);

  if (id && (!folder || folder.deletedAt)) {
    return <Empty icon={<IFolder />} title="Folder not found" text="It may have been moved to Trash." action={<Button onClick={() => s.go({ page: 'folder', id: null })}>Back to Library</Button>} />;
  }
  const count = (f: Folder) => s.children(f.id).length + s.assetsIn(f.id).length;

  return (
    <div className="page">
      <PageHeader
        title={folder ? nameOf(folder) : 'Library'}
        sub={folder ? `${sub.length ? `${sub.length} ${sub.length === 1 ? 'folder' : 'folders'} · ` : ''}${assets.length} ${assets.length === 1 ? 'file' : 'files'} · ${fmtSize(assets.reduce((n, a) => n + (mainFile(a)?.size ?? 0), 0))}` : s.canEdit ? 'Drop files anywhere to add them. Drag files onto a folder to sort them.' : 'All your folders and files.'}
        actions={
          (s.canEdit || (id && folder)) && (
            <>
              {id && folder && (assets.length > 0 || sub.length > 0) && (
                <Button icon={<IDownload />} onClick={() => downloadFolder(folder)} title="Download everything in this folder as one ZIP">
                  ZIP
                </Button>
              )}
              {s.canEdit && id && folder && (
                <Button icon={<IShare />} onClick={() => setAsk({ kind: 'share', target: 'folder', id, label: nameOf(folder) })}>
                  Share
                </Button>
              )}
              {s.canEdit && (
                <Button icon={<IPlus />} onClick={() => setAsk({ kind: 'new-folder', parentId: id })}>
                  New folder
                </Button>
              )}
              {s.canEdit && (
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

      {id || assets.length > 0 || s.canEdit ? (
        <section>
          {sub.length > 0 && (assets.length > 0 || !id) && <h2 className="section-title">Files</h2>}
          <FileGrid
            assets={assets}
            empty={
              id || !sub.length ? (
                <div className={`dropzone${s.canEdit ? '' : ' off'}`} onClick={() => s.canEdit && input.current?.click()}>
                  <IUpload />
                  <strong>{s.canEdit ? 'Drop files or folders here' : 'No files yet'}</strong>
                  <span>
                    {!s.canEdit
                      ? 'Files uploaded by your team will show here.'
                      : id
                        ? 'Images, videos, PDFs, Office files, PSD and AI — previews are made automatically.'
                        : 'Keep them here, or make a folder and drag them into it later.'}
                  </span>
                </div>
              ) : (
                <div className="dropzone slim" onClick={() => input.current?.click()}>
                  <IUpload />
                  <span>Drop files here to keep them in the Library — drag them onto a folder any time.</span>
                </div>
              )
            }
          />
        </section>
      ) : (
        !sub.length && <Empty icon={<IFolder />} title="Nothing here yet" text="Files and folders your team adds will show here." />
      )}

      {over && (
        <div className="drop-overlay">
          <div>
            <IUpload />
            <strong>Drop to upload to “{folder ? nameOf(folder) : 'Library'}”</strong>
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

const DATE_CHOICES = [
  { q: 'today', label: 'Today' },
  { q: 'yesterday', label: 'Yesterday' },
  { q: 'this week', label: 'This week' },
  { q: 'last week', label: 'Last week' },
  { q: 'this month', label: 'This month' },
  { q: 'last month', label: 'Last month' },
  { q: 'this year', label: 'This year' },
];

export function SearchPage({ q }: { q: string }) {
  const s = useStore();
  const p = useMemo(() => parse(q), [q]);
  const ctx = { path: s.path, tagById: s.tagById, clients: s.clients, sharedWith: s.sharedWith };
  const any = !isEmpty(p);
  const words = p.words.join(' ');
  // folders only match plain words (filters like "images" or "#approved" are about files)
  const folders = words && !p.kinds.length && !p.exts.length && !p.tags.length && !p.clients.length && !p.date ? s.folders.filter((f) => p.words.every((w) => nameOf(f).toLowerCase().includes(w))) : [];
  const list = any ? s.assets.filter((a) => matches(a, p, ctx)) : [];
  const { folderMenu, dialogs } = useActions();
  const go = (next: string) => s.go({ page: 'search', q: next });
  const kindNow: string = p.kinds[0] ?? (p.exts.length ? 'ext' : '');
  const tagNow = p.tags[0] ?? '';
  const clientNow = p.clients[0] ?? '';
  const dateNow = p.tokens.find((t) => t.type === 'date')?.text.toLowerCase() ?? '';
  const chipLabel = (t: Token) =>
    t.type === 'kind' ? KIND_LABEL[p.kinds[p.tokens.filter((x) => x.type === 'kind').indexOf(t)] ?? 'other']
    : t.type === 'ext' ? t.text.replace(/^(ext:)?\.?/i, '').toUpperCase() + ' files'
    : t.type === 'tag' ? `Tagged ${t.text.replace(/^(#|tag:)/i, '').replace(/"/g, '')}`
    : t.type === 'client' ? `Shared with ${t.text.replace(/^client:/i, '').replace(/"/g, '')}`
    : t.type === 'date' ? p.date?.label ?? t.text
    : `“${t.text.replace(/"/g, '')}”`;

  return (
    <div className="page">
      <PageHeader
        title={any ? 'Search results' : 'Search'}
        sub={any ? `${folders.length + list.length} ${folders.length + list.length === 1 ? 'result' : 'results'}` : 'Search names, file names, folders, tags and clients — or narrow it down below.'}
      />
      <div className="search-bar">
        <div className="search-chips">
          {p.tokens.map((t) => (
            <span key={t.text} className={`search-chip ${t.type}`}>
              {chipLabel(t)}
              <button type="button" aria-label={`Remove ${chipLabel(t)}`} onClick={() => go(without(q, t))}>
                <IX />
              </button>
            </span>
          ))}
          {!any && <span className="muted small">Try: <button className="link-btn" onClick={() => go('images this week')}>images this week</button> · <button className="link-btn" onClick={() => go('pdf')}>pdf</button>{s.tags[0] && <> · <button className="link-btn" onClick={() => go(tagQuery(s.tags[0].name))}>{tagQuery(s.tags[0].name)}</button></>}{s.clients[0] && <> · <button className="link-btn" onClick={() => go(`client:${s.clients[0].name.split(' ')[0].toLowerCase()}`)}>client:{s.clients[0].name.split(' ')[0].toLowerCase()}</button></>}</span>}
        </div>
        <div className="search-filters">
          <select className="select sm" aria-label="Type" value={kindNow === 'ext' ? '' : kindNow} onChange={(e) => go(withFilter(q, 'kind', e.target.value ? KIND_QUERY[e.target.value as keyof typeof KIND_QUERY] : null))}>
            <option value="">Any type</option>
            {(Object.keys(KIND_QUERY) as (keyof typeof KIND_QUERY)[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
          <select className="select sm" aria-label="Date" value={DATE_CHOICES.some((d) => d.q === dateNow) ? dateNow : ''} onChange={(e) => go(withFilter(q, 'date', e.target.value || null))}>
            <option value="">Any time</option>
            {DATE_CHOICES.map((d) => (
              <option key={d.q} value={d.q}>{d.label}</option>
            ))}
          </select>
          {s.tags.length > 0 && (
            <select className="select sm" aria-label="Tag" value={s.tags.find((t) => t.name.toLowerCase() === tagNow)?.id ?? ''} onChange={(e) => go(withFilter(q, 'tag', e.target.value ? tagQuery(s.tagById.get(e.target.value)!.name) : null))}>
              <option value="">Any tag</option>
              {s.tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {s.clients.length > 0 && (
            <select className="select sm" aria-label="Client" value={s.clients.find((c) => c.name.toLowerCase().includes(clientNow) && clientNow)?.id ?? ''} onChange={(e) => {
              const c = s.clients.find((x) => x.id === e.target.value);
              go(withFilter(q, 'client', c ? (/\s/.test(c.name) ? `client:"${c.name}"` : `client:${c.name}`) : null));
            }}>
              <option value="">Any client</option>
              {s.clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
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
      <FileGrid assets={list} showWhere empty={any && !folders.length ? <Empty icon={<ISearch />} title="Nothing matches" text="Take a filter off, or try another word." /> : null} />
      {dialogs}
    </div>
  );
}
