/*
 * Everything the admin asks the server, in one place. The backend is the same Flask API
 * (/api/auth/…, /api/admin/…); upload mechanics live in lib/upload-client.ts.
 */
import { api as call, ApiError, type ApiCtx } from '@/lib/upload-client';

export const ctx: ApiCtx = { base: '' };
export { ApiError };

export type Role = 'owner' | 'editor' | 'viewer';
export type Me = { id: string; username: string; name: string; role: Role; avatarKey?: string | null; lang?: string | null };

export type FileRow = {
  id: string;
  lang: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'other';
  name: string;
  mime: string;
  size: number;
  w: number | null;
  h: number | null;
  dur: number | null;
  orig: string;
  opt: string | null;
  optMime: string | null;
  thumb: string | null;
  poster: string | null;
  status: 'ready' | 'uploading';
};

export type Asset = {
  id: string;
  folderId: string;
  title: Record<string, string>;
  pinned: boolean;
  date: number;
  createdBy: string | null;
  deletedAt: number | null;
  status: 'live' | 'draft';
  variants: FileRow[];
  /** tag ids */
  tags?: string[];
};

export type Folder = {
  id: string;
  parentId: string | null;
  name: Record<string, string>;
  slug: string;
  sort: number;
  iconBg: string | null;
  hidden: boolean;
  deletedAt: number | null;
  createdAt: number;
};

export type Tag = { id: string; name: string; color: string | null };
export type Tree = { folders: Folder[]; items: Asset[]; tags?: Tag[]; user: Me & { pins?: string[] } };

export type Share = { id: string; kind: 'folder' | 'item' | 'link'; targetId: string | null; url: string | null; title: string | null; createdAt: number; createdBy: string | null; expiresAt?: number | null };
export type ClientLogin = { id: string; email: string; name: string; disabled: boolean; lastLoginAt: number | null; createdAt: number };
export type Client = { id: string; name: string; email: string | null; notes: string | null; color: string | null; avatarKey: string | null; createdAt: number; createdBy: string | null; shares: Share[]; logins: ClientLogin[]; inboxFolderId: string | null; homeFolderId: string | null };

export const op = <T = { ok: boolean }>(name: string, body: unknown = {}) => call<T>(ctx, name, body);
export const loadTree = () => call<Tree>(ctx, 'tree');
export type Check = {
  key: 'mysql' | 'r2' | 'drive';
  name: string;
  state: 'ok' | 'fail' | 'off';
  ms: number;
  summary?: string;
  error?: string;
  warning?: string;
  note?: string;
  link?: string;
  /** Google Drive only: "Connect Google Drive" is set up, an account is connected, and which one */
  canConnect?: boolean;
  connected?: boolean;
  account?: string | null;
  facts?: { label: string; value: string | number; kind?: 'time' }[];
};
export type BackupStatus = {
  configured: boolean;
  configError?: string;
  folderUrl?: string;
  running: boolean;
  lastRun: number | null;
  lastOk: number | null;
  lastError: { at: number; message: string } | null;
  verifiedAt: number | null;
  total: number;
  backedUp: number;
  waiting: number;
  failing: { name: string; error: string; attempts: number; nextTry: number | null }[];
  failed: number;
  old: number;
  /** remove Drive copies of things deleted for good */
  mirrorDeletes?: boolean;
};
export type BackupResult = { configured: boolean; ran: boolean; created: number; copied: number; updated: number; toOld: number; removed?: number; failed: number; remaining: boolean; error?: string };
export const backupStatus = () => call<BackupStatus>(ctx, 'backup');
export const backupNow = () => call<{ result: BackupResult; status: BackupStatus }>(ctx, 'backup', {});
export const backupSettings = (b: { mirrorDeletes: boolean }) => call<{ status: BackupStatus }>(ctx, 'backup/settings', b);
export const driveDisconnect = () => call<{ ok: boolean }>(ctx, 'drive/disconnect', {});
export const connectionStatus = () => call<{ checkedAt: number; checks: Check[] }>(ctx, 'status');
export const loadClients = () => call<{ clients: Client[] }>(ctx, 'clients.list', {}).then((r) => r.clients);

async function auth<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let j: unknown = null;
  try {
    j = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(res.status, (j as { error?: string } | null)?.error || `${res.status}`);
  return j as T;
}

export const getMe = () => auth<{ user: Me | null; needsSetup?: boolean; setupNeedsKey?: boolean }>('me');
export const login = (username: string, password: string) => auth<{ user: Me }>('login', { username, password });
export const logout = () => auth('logout', {});
export const setup = (b: { name: string; username: string; password: string; key?: string }) => auth<{ user: Me }>('setup', b);
export const changePassword = (current: string, next: string) => auth('password', { current, next });
export const setMyAvatar = (data: string) => auth<{ avatarKey: string }>('avatar', { data });
export const clearMyAvatar = () => auth<{ ok: boolean }>('avatar-clear', {});
export const sessions = () => auth<{ sessions: { id: string; created_at: number; last_seen: number; ip: string | null; ua: string | null; current: boolean }[] }>('sessions');
export const revokeSession = (id: string) => auth('revoke', { id });
export const revokeOtherSessions = () => auth('revoke', { others: true });

/** /f/<key> with each part of the key escaped. */
export function fileUrl(key: string | null | undefined, download?: string) {
  if (!key) return '';
  const path = '/f/' + key.split('/').map(encodeURIComponent).join('/');
  return download === undefined ? path : `${path}?dl=${encodeURIComponent(download)}`;
}

export const titleOf = (a: Asset) => a.title.en || Object.values(a.title).find(Boolean) || a.variants[0]?.name || 'Untitled';
export const nameOf = (f: Folder) => f.name.en || Object.values(f.name).find(Boolean) || 'Untitled';
export const mainFile = (a: Asset): FileRow | undefined => a.variants.find((v) => v.status === 'ready') ?? a.variants[0];
export const assetSize = (a: Asset) => a.variants.reduce((n, v) => n + (v.size || 0), 0);
export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

export function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
