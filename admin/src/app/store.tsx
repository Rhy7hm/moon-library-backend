/*
 * App-wide state: the library (folders + assets), where you are, toasts, the open file sheet
 * and the upload queue. One context keeps the pages simple.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { guessMime, kindOf, onSignedOut, uploadVersion } from '@/lib/upload-client';
import { errText, loadClients, loadTree, nameOf, op, type Asset, type Client, type Folder, type Me, type Powers, type Tag, type Tree } from './api';
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

/** The files of the list the open file was opened from, in order: ← and → in the file panel walk through it. */
export const sheetOrder: { ids: string[] } = { ids: [] };

/** Where a dropped file sat inside the folder that was dropped ("Raya/Posters"), so its folders can be made too. */
const relDirs = new WeakMap<File, string>();
const relDirOf = (f: File) => relDirs.get(f) || (f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(0, -1).join('/') : '');
/** Files this big go up in parts; only two of them at a time. */
const BIG_FILE = 20 * 1024 * 1024;

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
  /** tries the uploads that failed again */
  retryUploads: () => void;
  run: <T>(name: string, body: unknown, done?: string, undo?: () => Promise<unknown>) => Promise<T | null>;
  canEdit: boolean;
  isOwner: boolean;
  /** the Super admin's powers (an Owner has them too while there's no Super admin) */
  powers: Powers;
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

  // Progress arrives many times a second per file; it's gathered and shown a few times a second,
  // so a big batch doesn't redraw the whole library on every tick.
  const pending = useRef(new Map<string, Partial<UploadJob>>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushJobs = useCallback(() => {
    flushTimer.current = null;
    const p = pending.current;
    if (!p.size) return;
    pending.current = new Map();
    setUploads((u) => u.map((j) => (p.has(j.id) ? { ...j, ...p.get(j.id) } : j)));
  }, []);
  const patchJob = useCallback(
    (id: string, patch: Partial<UploadJob>) => {
      pending.current.set(id, { ...pending.current.get(id), ...patch });
      if (!flushTimer.current) flushTimer.current = setTimeout(flushJobs, 200);
    },
    [flushJobs],
  );
  const treeRef = useRef(tree);
  treeRef.current = tree;
  // what each upload was, so a failed one can be tried again
  const sources = useRef(new Map<string, { file: File; folderId: string }>());

  /** The folders a dropped folder had, made (or found) under `root` → where each "a/b" path goes. */
  const foldersFor = useCallback(async (root: string | null, files: File[]) => {
    const made = new Map<string, string | null>([['', root]]);
    const known = (treeRef.current?.folders ?? []).filter((f) => !f.deletedAt);
    for (const dir of [...new Set(files.map(relDirOf))].sort()) {
      let at = '';
      for (const part of dir.split('/').filter(Boolean)) {
        const parent = made.get(at) ?? null;
        at = at ? `${at}/${part}` : part;
        if (made.has(at)) continue;
        const have = known.find((f) => (f.parentId ?? null) === parent && nameOf(f).toLowerCase() === part.toLowerCase());
        made.set(at, have ? have.id : (await op<{ id: string }>('folder.create', { parentId: parent, name: { en: part } })).id);
      }
    }
    return made;
  }, []);

  /** Sends jobs that are already listed in the tray. */
  const runJobs = useCallback(
    async (ids: string[]) => {
      let ok = 0;
      let big = 0;
      const queue = [...ids];
      // the library fills in as files land, not only when the whole batch is done
      let last = Date.now();
      const refresh = () => {
        if (Date.now() - last < 4000) return;
        last = Date.now();
        void reload();
      };
      const one = async (jid: string) => {
        const src = sources.current.get(jid);
        if (!src) return;
        const { file, folderId } = src;
        patchJob(jid, { state: 'working', pct: 1, error: undefined });
        let created: string | null = null;
        try {
          const mime = file.type || guessMime(file.name);
          const kind = kindOf(file.name, mime);
          const d = await derive(file);
          await uploadVersion(
            { base: '' },
            { newItem: { folderId, title: { en: titleFromName(file.name) } }, lang: 'all', kind, name: file.name, mime, file, derived: d },
            (s, t) => patchJob(jid, { pct: Math.min(99, Math.max(2, Math.round((s / t) * 100))) }),
            { onCreated: (fid) => (created = fid) },
          );
          patchJob(jid, { state: 'done', pct: 100 });
          sources.current.delete(jid);
          ok++;
          refresh();
        } catch (e) {
          patchJob(jid, { state: 'failed', error: errText(e) });
          if (created) void op('file.delete', { id: created, dropEmptyItem: true }).catch(() => {});
        }
      };
      // Four files at a time (each sends its copies side by side); of the big ones, sent in parts, two at a time.
      const worker = async () => {
        for (;;) {
          let i = queue.findIndex((id) => (sources.current.get(id)?.file.size ?? 0) <= BIG_FILE || big < 2);
          if (i < 0) {
            if (!queue.length) return;
            await new Promise((r) => setTimeout(r, 300)); // only big files left, and two are already going
            continue;
          }
          const jid = queue.splice(i, 1)[0];
          const isBig = (sources.current.get(jid)?.file.size ?? 0) > BIG_FILE;
          if (isBig) big++;
          try {
            await one(jid);
          } finally {
            if (isBig) big--;
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      flushJobs();
      await reload();
      return ok;
    },
    [reload, patchJob, flushJobs],
  );

  const upload = useCallback(
    async (files: File[], folderId: string | null) => {
      let where: Map<string, string | null>;
      try {
        // a dropped folder keeps its folders (at the top of the Library when that's where it was dropped)
        where = await foldersFor(folderId, files);
        // files put straight into the Library go into "Unsorted", shown at the top of the Library
        if (!folderId && files.some((f) => !relDirOf(f))) where.set('', (await op<{ id: string }>('folder.loose', {})).id);
        if (where.size > 1) void reload();
      } catch (e) {
        toast(errText(e), { tone: 'err' });
        return;
      }
      const jobs = files.map((f) => ({ id: `u${++jobSeq}`, name: f.name, size: f.size, pct: 0, state: 'waiting' as const }));
      files.forEach((f, i) => sources.current.set(jobs[i].id, { file: f, folderId: where.get(relDirOf(f))! }));
      setUploads((u) => {
        for (const j of u) if (j.state === 'done') sources.current.delete(j.id);
        return [...u.filter((j) => j.state !== 'done'), ...jobs];
      });
      const ok = await runJobs(jobs.map((j) => j.id));
      if (ok) toast(ok === 1 ? 'Uploaded 1 file' : `Uploaded ${ok} files`, { tone: 'ok' });
    },
    [reload, toast, foldersFor, runJobs],
  );

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
  const retryUploads = useCallback(() => {
    const ids = uploadsRef.current.filter((j) => j.state === 'failed' && sources.current.has(j.id)).map((j) => j.id);
    if (!ids.length) return;
    setUploads((u) => u.map((j) => (ids.includes(j.id) ? { ...j, state: 'waiting', pct: 0, error: undefined } : j)));
    void runJobs(ids).then((ok) => ok && toast(ok === 1 ? 'Uploaded 1 file' : `Uploaded ${ok} files`, { tone: 'ok' }));
  }, [runJobs, toast]);

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
    [reload, toast, patchJob],
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
    clearUploads: () =>
      setUploads((u) => {
        for (const j of u) if (j.state !== 'working' && j.state !== 'waiting') sources.current.delete(j.id);
        return u.filter((j) => j.state === 'working' || j.state === 'waiting');
      }),
    retryUploads,
    run,
    canEdit: me.role !== 'viewer',
    isOwner: me.role === 'owner' || me.role === 'superadmin',
    powers: tree?.user.powers ?? me.powers ?? { super: false, manageOwners: false, deleteUsers: false, settings: false, securityLog: false },
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
      if (f.name.startsWith('.')) return;
      // "/Raya/Posters/a.jpg" → "Raya/Posters": the folders it came in are made too
      relDirs.set(f, e.fullPath.split('/').filter(Boolean).slice(0, -1).join('/'));
      out.push(f);
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
