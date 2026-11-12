/*
 * Talks to /api/admin. Shared by the admin panel (browser) and the import
 * script (Node), so both upload files in exactly the same way.
 */
import type { FileLang, I18nText } from './langs';
import type { FileKind } from './types';

export type ApiCtx = {
  /** '' in the browser (same origin), 'https://library.example.com' from Node */
  base: string;
  /** extra headers when calling from a script, e.g. Authorization: Bearer <ADMIN_API_TOKEN> */
  headers?: Record<string, string>;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Called when the server says the sign-in has ended (the admin panel shows the sign-in page). */
let signedOut: (() => void) | null = null;
export function onSignedOut(fn: (() => void) | null) {
  signedOut = fn;
}

async function check(res: Response) {
  if (res.ok) return res;
  if (res.status === 401) signedOut?.();
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = (await res.json()) as { error?: string };
    if (j.error) msg = j.error;
  } catch {
    /* not JSON */
  }
  throw new ApiError(res.status, msg);
}

export async function api<T = unknown>(ctx: ApiCtx, op: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ctx.base}/api/admin/${op}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...ctx.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  await check(res);
  return (await res.json()) as T;
}

/** R2 multipart needs equal-sized parts (except the last), at least 5 MB. */
export const PART_SIZE = 10 * 1024 * 1024;
const SINGLE_LIMIT = 20 * 1024 * 1024;

type PutMeta = { contentType: string; downloadName?: string };

const retryable = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 408 || e.status === 429;

/** One PUT. In the browser it reports bytes as they leave (fetch can't), so small files show real progress too. */
function putOnce(ctx: ApiCtx, url: string, blob: Blob, onBytes: (n: number) => void): Promise<void> {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', ...ctx.headers }, body: blob, credentials: 'same-origin' })
      .then(check)
      .then(() => undefined);
  }
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.withCredentials = true;
    x.setRequestHeader('content-type', 'application/octet-stream');
    for (const [k, v] of Object.entries(ctx.headers ?? {})) x.setRequestHeader(k, v);
    let seen = 0;
    x.upload.onprogress = (e) => {
      onBytes(e.loaded - seen);
      seen = e.loaded;
    };
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) return resolve();
      if (x.status === 401) signedOut?.();
      let msg = `${x.status} ${x.statusText}`;
      try {
        const j = JSON.parse(x.responseText) as { error?: string };
        if (j.error) msg = j.error;
      } catch {
        /* not JSON */
      }
      reject(new ApiError(x.status, msg));
    };
    x.onerror = () => reject(new TypeError('The connection dropped'));
    x.onabort = () => reject(new TypeError('Upload stopped'));
    x.send(blob);
  });
}

/** Uploads one blob to an R2 key, in parts if it's large. Reports bytes sent. */
export async function putBlob(ctx: ApiCtx, key: string, blob: Blob, meta: PutMeta, onBytes?: (n: number) => void) {
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ key, contentType: meta.contentType, ...(meta.downloadName ? { downloadName: meta.downloadName } : {}), ...extra }).toString();

  if (blob.size <= SINGLE_LIMIT) {
    // a dropped connection or a busy server is tried again; anything the server refuses is not
    let attempt = 0;
    let counted = 0;
    for (;;) {
      try {
        await putOnce(ctx, `${ctx.base}/api/admin/upload?${qs({})}`, blob, (n) => {
          counted += n;
          onBytes?.(n);
        });
        if (counted < blob.size) onBytes?.(blob.size - counted);
        return;
      } catch (e) {
        onBytes?.(-counted); // the bar goes back for the part being sent again
        counted = 0;
        if (!retryable(e) || ++attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }

  const { uploadId } = await api<{ uploadId: string }>(ctx, 'mpu.create', { key, ...meta });
  const count = Math.ceil(blob.size / PART_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      const chunk = blob.slice(i * PART_SIZE, Math.min(blob.size, (i + 1) * PART_SIZE));
      let attempt = 0;
      for (;;) {
        try {
          const res = await fetch(`${ctx.base}/api/admin/upload?${qs({ uploadId, part: String(i + 1) })}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream', ...ctx.headers },
            body: chunk,
            credentials: 'same-origin',
          });
          await check(res);
          parts.push((await res.json()) as { partNumber: number; etag: string });
          onBytes?.(chunk.size);
          break;
        } catch (e) {
          if (++attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) {
    await api(ctx, 'mpu.abort', { key, uploadId }).catch(() => {});
    throw e;
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  await api(ctx, 'mpu.complete', { key, uploadId, parts });
}

export type Derived = {
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  thumb?: Blob | null;
  poster?: Blob | null;
  opt?: Blob | null;
  optMime?: string | null;
  /** 0 top … 1 bottom: where the content sits (transparent overlays) */
  focusY?: number | null;
};

export type VersionInput = {
  /** the card this file belongs to — or leave out and give `newItem` to make the card in the same call */
  itemId?: string;
  newItem?: { folderId: string; title: I18nText };
  lang: FileLang;
  /** a design in several languages: all of them, main one first */
  langs?: FileLang[];
  kind: FileKind;
  name: string;
  mime: string;
  file: Blob;
  caption?: string | null;
  derived: Derived;
};

/** Registers a file, uploads the original and its derived copies, then marks it ready. */
export type UploadOptions = {
  /** Set the item's date to now (default true). The import keeps the original file dates. */
  touch?: boolean;
  /** Id of an older version this upload replaces; it is deleted once this one is ready. */
  replaces?: string;
  /** Told as soon as the file is registered (before its bytes go up), e.g. to tidy up if the upload fails. */
  onCreated?: (fileId: string, itemId: string) => void;
};

export async function uploadVersion(
  ctx: ApiCtx,
  input: VersionInput,
  onProgress?: (sent: number, total: number) => void,
  opts: UploadOptions = {},
) {
  const d = input.derived;
  const { id, itemId, keys } = await api<{ id: string; itemId: string; keys: { orig: string; opt: string | null; thumb: string | null; poster: string | null } }>(
    ctx,
    'file.create',
    {
      ...(input.itemId ? { itemId: input.itemId } : { folderId: input.newItem!.folderId, title: input.newItem!.title }),
      lang: input.lang,
      langs: input.langs ?? null,
      kind: input.kind,
      name: input.name,
      mime: input.mime,
      size: input.file.size,
      width: d.width ?? null,
      height: d.height ?? null,
      duration: d.duration ?? null,
      caption: input.caption ?? null,
      hasOpt: !!d.opt,
      optMime: d.optMime ?? null,
      hasThumb: !!d.thumb,
      hasPoster: !!d.poster,
      focusY: d.focusY ?? null,
    },
  );
  opts.onCreated?.(id, itemId);
  const total = input.file.size + (d.opt?.size ?? 0) + (d.thumb?.size ?? 0) + (d.poster?.size ?? 0);
  let sent = 0;
  const tick = (n: number) => {
    sent += n;
    onProgress?.(sent, total);
  };
  // the original and its small copies go up side by side (one wait instead of four)
  const puts: Promise<void>[] = [];
  if (keys.thumb && d.thumb) puts.push(putBlob(ctx, keys.thumb, d.thumb, { contentType: 'image/webp' }, tick));
  if (keys.poster && d.poster) puts.push(putBlob(ctx, keys.poster, d.poster, { contentType: 'image/webp' }, tick));
  if (keys.opt && d.opt) {
    const optName = input.name.replace(/\.[^.]+$/, '') + (d.optMime === 'image/webp' ? '.webp' : d.optMime === 'video/mp4' ? '.mp4' : '.jpg');
    puts.push(putBlob(ctx, keys.opt, d.opt, { contentType: d.optMime ?? 'image/jpeg', downloadName: optName }, tick));
  }
  puts.push(putBlob(ctx, keys.orig, input.file, { contentType: input.mime || 'application/octet-stream', downloadName: input.name }, tick));
  await Promise.all(puts);
  await api(ctx, 'file.ready', { id, touch: opts.touch !== false, replaces: opts.replaces });
  return id;
}

export async function createItem(ctx: ApiCtx, folderId: string, title: I18nText, date?: number) {
  return (await api<{ id: string }>(ctx, 'item.create', { folderId, title, date })).id;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  heic: 'image/heic', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', rtf: 'application/rtf', key: 'application/vnd.apple.keynote',
  pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
  // designers' source files (never shown in the browser; downloaded as they are)
  psd: 'image/vnd.adobe.photoshop', psb: 'image/vnd.adobe.photoshop', ai: 'application/postscript', eps: 'application/postscript',
  indd: 'application/x-indesign', idml: 'application/vnd.adobe.indesign-idml-package', fig: 'application/octet-stream',
  sketch: 'application/octet-stream', xd: 'application/octet-stream', afdesign: 'application/octet-stream', afphoto: 'application/octet-stream',
};

export function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

const DESIGN_EXT = new Set(['psd', 'psb', 'ai', 'indd', 'idml', 'eps', 'fig', 'sketch', 'xd', 'afdesign', 'afphoto', 'cdr']);
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'key', 'pages', 'numbers', 'rtf']);

/** Which of the five file types a file is, from its MIME type and name. */
export function kindOf(name: string, mime?: string): FileKind {
  const m = mime || guessMime(name);
  const ext = name.toLowerCase().split('.').pop() ?? '';
  // design source files: 'other' (downloaded as they are), with a thumbnail made from their embedded preview
  if (DESIGN_EXT.has(ext)) return 'other';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (DOC_EXT.has(ext) || m === 'application/pdf' || m.startsWith('text/')) return 'document';
  return 'other';
}
