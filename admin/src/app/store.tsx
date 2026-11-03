/*
 * App-wide state: the library (folders + assets), where you are, toasts, the open file sheet
 * and the upload queue. One context keeps the pages simple.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createItem, guessMime, kindOf, onSignedOut, uploadVersion } from '@/lib/upload-client';
import { errText, loadClients, loadTree, op, type Asset, type Client, type Folder, type Me, type Tag, type Tree } from './api';
import { deriveAudio, deriveImage, deriveVideo } from './derive/derive';
import { deriveDesign, isDesignFile } from './derive/derive-design';

/* ---------------- routes (in the URL hash, so reload and back work) ---------------- */

export type Route =
  | { page: 'home' }
  | { page: 'folder'; id: string | null }
  | { page: 'recent' }
  | { page: 'trash' }
  | { page: 'clients' }
  | { page: 'client'; id: string }
  | { page: 'search'; q: string }
  | { page: 'insights' }
  | { page: 'activity' }
  | { page: 'team' }
  | { page: 'settings'; tab: 'account' | 'appearance' | 'devices' | 'connections' };

export function parseRoute(hash: string): Route {
  const [path, query] = hash.replace(/^#\/?/, '').split('?');
  const [a, b] = path.split('/');
  switch (a) {
    case 'library':
      return { page: 'folder', id: b || null };
    case 'clients':
      return b ? { page: 'client', id: b } : { page: 'clients' };
    case 'recent':
    case 'trash':
    case 'insights':
    case 'activity':
    case 'team':
      return { page: a };
    case 'settings':
      return { page: 'settings', tab: b === 'appearance' || b === 'devices' || b === 'connections' ? b : 'account' };
    case 'search':
      return { page: 'search', q: new URLSearchParams(query).get('q') ?? '' };
    default:
      return { page: 'home' };
  }
}

export function routeHash(r: Route) {
  if (r.page === 'folder') return `#/library${r.id ? '/' + r.id : ''}`;
  if (r.page === 'search') return `#/search?q=${encodeURIComponent(r.q)}`;
  if (r.page === 'client') return `#/clients/${r.id}`;
  if (r.page === 'settings') return r.tab === 'account' ? '#/settings' : `#/settings/${r.tab}`;
  return r.page === 'home' ? '#/' : `#/${r.page}`;
}

/* ---------------- uploads ---------------- */

export type UploadJob = { id: string; name: string; size: number; pct: number; state: 'waiting' | 'working' | 'done' | 'failed'; error?: string };

/* ---------------- context ---------------- */

type Toast = { id: number; text: string; tone?: 'ok' | 'err'; undo?: () => void };

type Store = {
  me: Me;
  setMe: (patch: Partial<Me> | ((m: Me) => Me)) => void;
  tree: Tree | null;
  clients: Client[];
  /** clients a folder or file is shared with (directly, or through a folder above it) */
  sharedWith: (kind: 'folder' | 'item', id: string) => Client[];
  folders: Folder[];
  assets: Asset[];
  trashFolders: Folder[];
  trashClients: Client[];
  trashAssets: Asset[];
  byId: Map<string, Folder>;
  /** every tag, by name; and a quick lookup by id */
  tags: Tag[];
  tagById: Map<string, Tag>;
  children: (id: string | null) => Folder[];
  /** a folder's files; null = the files at the top of the Library (kept in "Unsorted") */
  assetsIn: (id: string | null) => Asset[];
  looseFolderId: string | null;
  path: (id: string | null) => Folder[];
  reload: () => Promise<void>;
  route: Route;
  go: (r: Route) => void;
  toast: (text: string, opts?: { tone?: 'ok' | 'err'; undo?: () => void }) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  sheet: string | null;
  openSheet: (assetId: string | null) => void;
  uploads: UploadJob[];
  upload: (files: File[], folderId: string | null) => Promise<void>;
  replaceFile: (asset: Asset, file: File) => Promise<void>;
  clearUploads: () => void;
  run: <T>(name: string, body: unknown, done?: string, undo?: () => Promise<unknown>) => Promise<T | null>;
  canEdit: boolean;
  isOwner: boolean;
  /** folders this person pinned to their sidebar, in their order (saved on the server, per person) */
  pins: string[];
  setPins: (ids: string[]) => void;
  togglePin: (id: string) => void;
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

let toastSeq = 0;
let jobSeq = 0;

function derive(file: File) {
  const kind = kindOf(file.name, file.type || guessMime(file.name));
  const p =
    kind === 'image' ? deriveImage(file) : kind === 'video' ? deriveVideo(file) : kind === 'audio' ? deriveAudio(file) : isDesignFile(file.name) ? deriveDesign(file) : Promise.resolve({});
  // a file the browser can't read for a preview (HEIC, TIFF …) still uploads, just without one
  return p.catch(() => ({}));
}

/** "summer-sale_IG-post.final.jpg" → "summer sale IG post.final" */
const titleFromName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || name;

export function StoreProvider({ me: meProp, onSignOut, children }: { me: Me; onSignOut: () => void; children: ReactNode }) {
  const [me, setMeState] = useState(meProp);
  const [tree, setTree] = useState<Tree | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [trashClients, setTrashClients] = useState<Client[]>([]); // removed clients, in the Trash
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadJob[]>([]);

  useEffect(() => setMeState(meProp), [meProp]);
  const setMe = useCallback((patch: Partial<Me> | ((m: Me) => Me)) => {
    setMeState((m) => (typeof patch === 'function' ? patch(m) : { ...m, ...patch }));
  }, []);

  useEffect(() => {
    onSignedOut(onSignOut);
    return () => onSignedOut(null);
  }, [onSignOut]);

  const toast = useCallback((text: string, opts: { tone?: 'ok' | 'err'; undo?: () => void } = {}) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.undo ? 7000 : 3800);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const [pins, setPinsState] = useState<string[]>([]);
  const reload = useCallback(async () => {
    try {
      // the library must open even if the client list can't load
      const [t, c] = await Promise.all([loadTree(), loadClients().catch(() => [])]);
      setTree(t);
      setPinsState(t.user.pins ?? []);
      setClients(c.filter((x) => !x.deletedAt));
      setTrashClients(c.filter((x) => !!x.deletedAt));
    } catch (e) {
      toast(errText(e), { tone: 'err' });
    }
  }, [toast]);

  useEffect(() => {
    reload();
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onHash);
    // keep in step when colleagues change things (and when the tab comes back)
    const onFocus = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reload]);

  const go = useCallback((r: Route) => {
    const h = routeHash(r);
    if (location.hash !== h) location.hash = h;
    setRoute(r);
    setSheet(null);
    window.scrollTo({ top: 0 });
  }, []);

  const derived = useMemo(() => {
    const all = tree?.folders ?? [];
    const byId = new Map(all.map((f) => [f.id, f]));
    // "Unsorted" holds the files put straight into the Library: they show at the top of the Library, not as a folder
    const loose = tree?.looseFolderId ?? null;
    const folders = all.filter((f) => !f.deletedAt && f.id !== loose);
    const kids = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const k = f.parentId ?? null;
      kids.set(k, [...(kids.get(k) ?? []), f]);
    }
    for (const l of kids.values()) l.sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt);
    const deletedUp = (id: string | null): boolean => {
      for (let cur = id, guard = 0; cur && guard < 50; cur = byId.get(cur)?.parentId ?? null, guard++) if (byId.get(cur)?.deletedAt) return true;
      return false;
    };
    const items = tree?.items ?? [];
    const assets = items.filter((a) => !a.deletedAt && !deletedUp(a.folderId)).sort((a, b) => b.date - a.date);
    const trashFolders = all.filter((f) => f.deletedAt && !deletedUp(f.parentId));
    const trashAssets = items.filter((a) => a.deletedAt && !deletedUp(a.folderId));
    const inFolder = new Map<string, Asset[]>();
    for (const a of assets) inFolder.set(a.folderId, [...(inFolder.get(a.folderId) ?? []), a]);
    const path = (id: string | null) => {
      const out: Folder[] = [];
      for (let cur = id, guard = 0; cur && guard < 50; cur = byId.get(cur)?.parentId ?? null, guard++) {
        const f = byId.get(cur);
        if (f && f.id !== loose) out.unshift(f);
      }
      return out;
    };
    return {
      folders,
      assets,
      trashFolders,
      trashAssets,
      byId,
      tags: tree?.tags ?? [],
      tagById: new Map((tree?.tags ?? []).map((t) => [t.id, t])),
      children: (id: string | null) => kids.get(id) ?? [],
      assetsIn: (id: string | null) => inFolder.get(id ?? loose ?? '') ?? [],
      looseFolderId: loose,
      path,
    };
  }, [tree]);

  const run = useCallback(
    async <T,>(name: string, body: unknown, done?: string, undo?: () => Promise<unknown>): Promise<T | null> => {
      try {
        const r = await op<T>(name, body);
        await reload();
        if (done) toast(done, { tone: 'ok', undo: undo ? () => void undo().then(reload).then(() => toast('Undone')) : undefined });
        return r;
      } catch (e) {
        toast(errText(e), { tone: 'err' });
        return null;
      }
    },
    [reload, toast],
  );

  const patchJob = (id: string, p: Partial<UploadJob>) => setUploads((u) => u.map((j) => (j.id === id ? { ...j, ...p } : j)));

  const upload = useCallback(
    async (files: File[], folderId: string | null) => {
      if (!folderId) {
        // straight into the Library: the files go into "Unsorted", shown at the top of the Library
        try {
          folderId = (await op<{ id: string }>('folder.loose', {})).id;
        } catch (e) {
          toast(errText(e), { tone: 'err' });
          return;
        }
      }
      const target = folderId;
      const jobs = files.map((f) => ({ id: `u${++jobSeq}`, name: f.name, size: f.size, pct: 0, state: 'waiting' as const }));
      setUploads((u) => [...u.filter((j) => j.state !== 'done'), ...jobs]);
      let ok = 0;
      // three at a time: quick for many small files, gentle for big videos
      const queue = files.map((f, i) => [f, jobs[i].id] as const);
      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const [file, jid] = next;
          patchJob(jid, { state: 'working', pct: 1 });
          try {
            const mime = file.type || guessMime(file.name);
            const kind = kindOf(file.name, mime);
            const d = await derive(file);
            const itemId = await createItem({ base: '' }, target, { en: titleFromName(file.name) });
            await uploadVersion({ base: '' }, { itemId, lang: 'all', kind, name: file.name, mime, file, derived: d }, (s, t) => patchJob(jid, { pct: Math.max(2, Math.round((s / t) * 100)) }));
            patchJob(jid, { state: 'done', pct: 100 });
            ok++;
          } catch (e) {
            patchJob(jid, { state: 'failed', error: errText(e) });
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      await reload();
      if (ok) toast(ok === 1 ? 'Uploaded 1 file' : `Uploaded ${ok} files`, { tone: 'ok' });
    },
    [reload, toast],
  );

  const replaceFile = useCallback(
    async (asset: Asset, file: File) => {
      const old = asset.variants.find((v) => v.status === 'ready') ?? asset.variants[0];
      const jid = `u${++jobSeq}`;
      setUploads((u) => [...u.filter((j) => j.state !== 'done'), { id: jid, name: file.name, size: file.size, pct: 0, state: 'working' }]);
      try {
        const mime = file.type || guessMime(file.name);
        const d = await derive(file);
        await uploadVersion(
          { base: '' },
          { itemId: asset.id, lang: (old?.lang as 'all') ?? 'all', kind: kindOf(file.name, mime), name: file.name, mime, file, derived: d },
          (s, t) => patchJob(jid, { pct: Math.max(2, Math.round((s / t) * 100)) }),
          { replaces: old?.id },
        );
        patchJob(jid, { state: 'done', pct: 100 });
        await reload();
        toast('Replaced — the old file is kept in Versions', { tone: 'ok' });
      } catch (e) {
        patchJob(jid, { state: 'failed', error: errText(e) });
        toast(errText(e), { tone: 'err' });
      }
    },
    [reload, toast],
  );

  const sharedWith = useCallback(
    (kind: 'folder' | 'item', id: string) => {
      // a file is shared through its own share or any folder above it; a folder through itself or a parent
      const folderId = kind === 'item' ? tree?.items.find((a) => a.id === id)?.folderId ?? null : id;
      const up = new Set(derived.path(folderId).map((f) => f.id));
      return clients.filter((c) => c.shares.some((s) => (kind === 'item' && s.kind === 'item' && s.targetId === id) || (s.kind === 'folder' && s.targetId && up.has(s.targetId))));
    },
    [clients, tree, derived],
  );

  // shown at once, saved in the background; if saving fails, the list goes back and says so
  const setPins = useCallback(
    (ids: string[]) => {
      let before: string[] = [];
      setPinsState((cur) => ((before = cur), ids));
      op<{ pins: string[] }>('pins.set', { folderIds: ids }).then(
        (r) => setPinsState(r.pins),
        (e) => {
          setPinsState(before);
          toast(errText(e), { tone: 'err' });
        },
      );
    },
    [toast],
  );
  const togglePin = useCallback(
    (id: string) => {
      const on = pins.includes(id);
      setPins(on ? pins.filter((x) => x !== id) : [...pins, id]);
      toast(on ? 'Unpinned from the sidebar' : 'Pinned to the sidebar', { tone: 'ok' });
    },
    [pins, setPins, toast],
  );

  const value: Store = {
    me,
    setMe,
    tree,
    clients,
    trashClients,
    sharedWith,
    ...derived,
    reload,
    route,
    go,
    toast,
    toasts,
    dismiss,
    sheet,
    openSheet: setSheet,
    uploads,
    upload,
    replaceFile,
    clearUploads: () => setUploads((u) => u.filter((j) => j.state === 'working' || j.state === 'waiting')),
    run,
    canEdit: me.role !== 'viewer',
    isOwner: me.role === 'owner',
    // a pinned folder that's in Trash (or inside one that is) drops out until it's restored
    pins: pins.filter((id) => derived.byId.has(id) && !derived.path(id).some((f) => f.deletedAt)),
    setPins,
    togglePin,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Files dropped on the window (folders included, via the entries API). */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const overFn = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      onFiles(await filesFrom(e.dataTransfer!));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, [onFiles, enabled]);
  return over;
}

async function filesFrom(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      if (!f.name.startsWith('.')) out.push(f);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const x of batch) await walk(x);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
