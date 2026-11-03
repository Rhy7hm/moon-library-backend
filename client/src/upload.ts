/*
 * Sends a file to the team: register it, upload a small preview (images and videos) and the file
 * itself (in 10 MB parts when it's big), then mark it ready. Lands in "From <client>" in the library.
 */
import { check } from './api';

const PART = 10 * 1024 * 1024;
const SINGLE = 20 * 1024 * 1024;
const THUMB_W = 720;

export const kindOf = (f: File) =>
  f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : /pdf|word|sheet|excel|presentation|text|rtf/.test(f.type) ? 'document' : 'other';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/client/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  await check(res);
  return (await res.json()) as T;
}

function canvasBlob(src: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const scale = Math.min(1, THUMB_W / w);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/webp', 0.82));
}

type Meta = { width?: number; height?: number; duration?: number; thumb?: Blob | null };

async function describe(file: File): Promise<Meta> {
  try {
    if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') {
      const bmp = await createImageBitmap(file);
      return { width: bmp.width, height: bmp.height, thumb: await canvasBlob(bmp, bmp.width, bmp.height) };
    }
    if (file.type.startsWith('video/')) {
      const url = URL.createObjectURL(file);
      try {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'metadata';
        v.src = url;
        await new Promise((ok, no) => ((v.onloadeddata = ok), (v.onerror = no), setTimeout(no, 8000)));
        v.currentTime = Math.min(1, v.duration / 3 || 0);
        await new Promise((ok) => ((v.onseeked = ok), setTimeout(ok, 3000)));
        return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, thumb: await canvasBlob(v, v.videoWidth, v.videoHeight) };
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  } catch {
    /* no preview — the file still uploads */
  }
  return {};
}

async function put(key: string, blob: Blob, type: string, name: string | undefined, onBytes: (n: number) => void) {
  const qs = (extra: Record<string, string> = {}) => new URLSearchParams({ key, contentType: type, ...(name ? { downloadName: name } : {}), ...extra }).toString();
  if (blob.size <= SINGLE) {
    await check(await fetch(`/api/client/upload?${qs()}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob, credentials: 'same-origin' }));
    onBytes(blob.size);
    return;
  }
  const { uploadId } = await post<{ uploadId: string }>('uploads/mpu', { action: 'create', key, contentType: type, downloadName: name });
  const count = Math.ceil(blob.size / PART);
  const parts: { partNumber: number; etag: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      const chunk = blob.slice(i * PART, Math.min(blob.size, (i + 1) * PART));
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(`/api/client/upload?${qs({ uploadId, part: String(i + 1) })}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: chunk, credentials: 'same-origin' });
          await check(res);
          parts.push(await res.json());
          onBytes(chunk.size);
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } catch (e) {
    await post('uploads/mpu', { action: 'abort', key, uploadId }).catch(() => {});
    throw e;
  }
  parts.sort((a, b) => a.partNumber - b.partNumber);
  await post('uploads/mpu', { action: 'complete', key, uploadId, parts });
}

export async function sendFile(file: File, onProgress: (pct: number) => void) {
  const m = await describe(file);
  const { id, keys } = await post<{ id: string; keys: { orig: string; thumb: string | null; poster: string | null } }>('uploads/start', {
    name: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: kindOf(file),
    width: m.width ?? null,
    height: m.height ?? null,
    duration: m.duration ?? null,
    hasThumb: !!m.thumb && !file.type.startsWith('video/'),
    hasPoster: !!m.thumb && file.type.startsWith('video/'),
  });
  const total = file.size + (m.thumb?.size ?? 0);
  let sent = 0;
  const tick = (n: number) => onProgress(Math.min(99, Math.round(((sent += n) / total) * 100)));
  const thumbKey = keys.thumb ?? keys.poster;
  if (thumbKey && m.thumb) await put(thumbKey, m.thumb, 'image/webp', undefined, tick);
  await put(keys.orig, file, file.type || 'application/octet-stream', file.name, tick);
  await post('uploads/ready', { id });
  onProgress(100);
  return id;
}
