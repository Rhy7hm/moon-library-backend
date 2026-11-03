/* App state: who's signed in, their library, the page (in the URL hash), the viewer, toasts. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errText, library as loadLibrary, type FileInfo, type Item, type Library, type Me } from './api';

export type Route = { page: 'library' } | { page: 'collection'; id: string } | { page: 'send' } | { page: 'account' };

export function parseHash(h = location.hash): Route {
  const p = h.replace(/^#\/?/, '').split('/');
  if (p[0] === 'c' && p[1]) return { page: 'collection', id: decodeURIComponent(p[1]) };
  if (p[0] === 'send') return { page: 'send' };
  if (p[0] === 'account') return { page: 'account' };
  return { page: 'library' };
}
const toHash = (r: Route) => (r.page === 'collection' ? `#/c/${encodeURIComponent(r.id)}` : r.page === 'library' ? '#/' : `#/${r.page}`);

export type Entry = { item: Item; file: FileInfo };
export type ViewerState = { entries: Entry[]; index: number; from: HTMLElement | null };
export type Toast = { id: number; text: string; tone?: 'ok' | 'err' };

type Store = {
  me: Me;
  lib: Library | null;
  libError: string | null;
  reload: () => Promise<void>;
  route: Route;
  go: (r: Route) => void;
  viewer: ViewerState | null;
  view: (entries: Entry[], index: number, from: HTMLElement | null) => void;
  closeViewer: () => void;
  toasts: Toast[];
  toast: (text: string, tone?: 'ok' | 'err') => void;
  signOut: () => void;
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => useContext(Ctx)!;

export function StoreProvider({ me, onSignOut, children }: { me: Me; onSignOut: () => void; children: ReactNode }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>(parseHash);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const tid = useRef(0);

  const reload = useCallback(async () => {
    try {
      setLib(await loadLibrary());
      setLibError(null);
    } catch (e) {
      setLibError(errText(e));
    }
  }, []);

  useEffect(() => {
    reload();
    const onHash = () => setRoute(parseHash());
    const onFocus = () => document.visibilityState === 'visible' && reload();
    addEventListener('hashchange', onHash);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      removeEventListener('hashchange', onHash);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reload]);

  const go = useCallback((r: Route) => {
    if (location.hash !== toHash(r)) location.hash = toHash(r);
    setRoute(r);
  }, []);

  const toast = useCallback((text: string, tone?: 'ok' | 'err') => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const value = useMemo<Store>(
    () => ({
      me,
      lib,
      libError,
      reload,
      route,
      go,
      viewer,
      view: (entries, index, from) => setViewer({ entries, index, from }),
      closeViewer: () => setViewer(null),
      toasts,
      toast,
      signOut: onSignOut,
    }),
    [me, lib, libError, reload, route, go, viewer, toasts, toast, onSignOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Every file of these cards, in order (a card can hold several files). */
export const entriesOf = (items: Item[]): Entry[] => items.flatMap((item) => item.files.map((file) => ({ item, file })));
