/*
 * Talks to the Moon Library server's client API (/api/client, same origin). The sign-in page is shared
 * with staff, so it also knows the two staff sign-in calls (/api/auth) — staff then go on to /admin.
 */

export type Me = { user: { name: string; email: string }; client: { name: string; color: string | null } };
export type FileInfo = {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'other' | string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  hasThumb: boolean;
  hasPreview: boolean;
};
export type Item = { id: string; title: string; collectionId: string | null; date: number; files: FileInfo[] };
export type Collection = { id: string; parentId: string | null; name: string; sort: number; count: number; updatedAt: number };
export type Link = { id: string; title: string | null; url: string; createdAt: number };
export type Library = Me & { collections: Collection[]; items: Item[]; links: Link[] };
export type Upload = { id: string; title: string; date: number; fromTeam: boolean; files: FileInfo[] };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let signedOut: (() => void) | null = null;
export const onSignedOut = (fn: (() => void) | null) => void (signedOut = fn);

export async function check(res: Response) {
  if (res.ok) return res;
  if (res.status === 401) signedOut?.();
  let msg = res.status === 413 ? 'That file is too big.' : `Something went wrong (${res.status}).`;
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error) msg = j.error;
  } catch {
    /* not JSON */
  }
  throw new ApiError(res.status, msg);
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/client/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  await check(res);
  return (await res.json()) as T;
}

export const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof TypeError ? "Can't reach Moon Library. Check your connection." : 'Something went wrong.');

export const me = () => call<Me | { user: null }>('auth/me');
export const signIn = (email: string, password: string) => call<Me>('auth/login', { email, password });
export const signOut = () => call('auth/logout', {});

/** The admin panel, where staff go once signed in. */
export const ADMIN_URL = '/admin';

/** Staff (Owner / Editor / Viewer) sign in with an ID; clients with an email. IDs can't contain "@". */
export const isStaffId = (v: string) => !v.includes('@');

async function staff<T>(op: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${op}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  await check(res);
  return (await res.json()) as T;
}
export const staffMe = () => staff<{ user: { username: string } | null }>('me');
export const staffSignIn = (username: string, password: string) => staff<{ user: { username: string } }>('login', { username, password });
export const changePassword = (current: string, next: string) => call('auth/password', { current, next });
export const library = () => call<Library>('library');
export const uploads = () => call<{ uploads: Upload[] }>('uploads').then((r) => r.uploads);

export const fileUrl = (f: Pick<FileInfo, 'id'>, v: 'thumb' | 'preview' | 'download') => `/api/client/files/${encodeURIComponent(f.id)}/${v}`;
export const mainFile = (i: { files: FileInfo[] }) => i.files[0];
