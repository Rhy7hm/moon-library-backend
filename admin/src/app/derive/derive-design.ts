/*
 * Thumbnails for designers' source files, made in the browser before upload (no server work):
 *
 *   PSD / PSB         the flattened image Photoshop saves at the end of the file
 *                     ("maximize compatibility"), else the small preview in its resources
 *   AI / INDD / EPS   the preview picture Adobe apps embed in the file's XMP metadata
 *
 * The original file is always what downloads; only the thumbnail is derived.
 * Anything unexpected returns {} and the file uploads without a thumbnail.
 */
import type { Derived } from '@/lib/upload-client';
import { deriveImage } from './derive';

const THUMB_W = 720;
/** Above this, a PSD isn't read whole for its flattened image (the small preview is used instead). */
const MAX_PSD_READ = 600 * 1024 * 1024;
/** How much of an AI / INDD / EPS file is searched for its XMP preview. */
const XMP_SCAN = 24 * 1024 * 1024;

export const DESIGN_EXT = new Set(['psd', 'psb', 'ai', 'indd', 'idml', 'eps', 'fig', 'sketch', 'xd', 'afdesign', 'afphoto', 'cdr']);

export function extOfName(name: string) {
  return name.toLowerCase().split('.').pop() ?? '';
}

export function isDesignFile(name: string) {
  return DESIGN_EXT.has(extOfName(name));
}

export async function deriveDesign(file: File): Promise<Derived> {
  const ext = extOfName(file.name);
  try {
    if (ext === 'psd' || ext === 'psb') {
      const psd = await psdPreview(file);
      if (psd) return await thumbOnly(psd.png, psd.width, psd.height);
    }
    if (ext === 'ai' || ext === 'indd' || ext === 'eps' || ext === 'psd' || ext === 'psb') {
      const jpeg = await xmpThumbnail(file);
      if (jpeg) return await thumbOnly(jpeg, null, null);
    }
  } catch {
    // a preview is a nice-to-have: never block the upload
  }
  return {};
}

/** Thumbnail from a preview picture; the design file itself stays the download (no optimised copy). */
async function thumbOnly(preview: Blob, width: number | null, height: number | null): Promise<Derived> {
  const d = await deriveImage(preview);
  return { width: width ?? d.width ?? null, height: height ?? d.height ?? null, thumb: d.thumb ?? null, focusY: d.focusY ?? null };
}

/* ---------- XMP preview (Illustrator, InDesign, EPS, often Photoshop too) ---------- */

async function xmpThumbnail(file: Blob): Promise<Blob | null> {
  const text = await file.slice(0, Math.min(file.size, XMP_SCAN)).text();
  // <xmpGImg:image>base64 JPEG</xmpGImg:image>; the largest one is the best preview
  let best = '';
  for (const m of text.matchAll(/<xmpGImg:image>([\s\S]*?)<\/xmpGImg:image>/g)) {
    if (m[1].length > best.length) best = m[1];
  }
  if (!best) {
    // the attribute form: xmpGImg:image="…"
    for (const m of text.matchAll(/xmpGImg:image="([^"]+)"/g)) if (m[1].length > best.length) best = m[1];
  }
  if (!best) return null;
  const b64 = best.replace(/&#xA;|&#10;|\s/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

/* ---------- Photoshop ---------- */

type PsdResult = { png: Blob; width: number; height: number };

async function psdPreview(file: Blob): Promise<PsdResult | null> {
  if (file.size > MAX_PSD_READ) return psdResourceThumb(file);
  const buf = await file.arrayBuffer();
  const r = new Reader(buf);
  if (r.str(4) !== '8BPS') return null;
  const version = r.u16(); // 1 = PSD, 2 = PSB (large document)
  if (version !== 1 && version !== 2) return null;
  const psb = version === 2;
  r.skip(6);
  const channels = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const mode = r.u16(); // 1 grey, 3 RGB, 4 CMYK
  r.skip(r.u32()); // colour mode data
  const resStart = r.pos;
  const resLen = r.u32();
  const resourceThumb = () => findResourceThumb(new DataView(buf, resStart + 4, resLen));
  r.skip(resLen);
  r.skip(psb ? r.u64() : r.u32()); // layers and masks

  if (depth !== 8 || ![1, 3, 4].includes(mode) || !width || !height || r.pos + 2 > buf.byteLength) {
    const jpeg = resourceThumb();
    return jpeg ? { png: jpeg, width, height } : null;
  }

  const compression = r.u16(); // 0 raw, 1 RLE (PackBits)
  if (compression !== 0 && compression !== 1) {
    const jpeg = resourceThumb();
    return jpeg ? { png: jpeg, width, height } : null;
  }

  // decode straight into a small picture: each source row is read, but only sampled rows / columns are kept
  const tw = Math.min(width, THUMB_W);
  const th = Math.max(1, Math.round((height * tw) / width));
  const colAt = new Uint32Array(tw);
  for (let x = 0; x < tw; x++) colAt[x] = Math.min(width - 1, Math.floor(((x + 0.5) * width) / tw));
  const keep = Math.min(channels, mode === 4 ? 5 : mode === 3 ? 4 : 2);
  const planes = Array.from({ length: keep }, () => new Uint8Array(tw * th));

  let counts: number[] | null = null;
  if (compression === 1) {
    counts = new Array(channels * height);
    for (let i = 0; i < counts.length; i++) counts[i] = psb ? r.u32() : r.u16();
  }
  const row = new Uint8Array(width);
  for (let c = 0; c < channels; c++) {
    let ty = 0;
    for (let y = 0; y < height; y++) {
      const wanted = ty < th && Math.floor(((ty + 0.5) * height) / th) === y;
      if (compression === 0) {
        if (wanted && c < keep) row.set(new Uint8Array(buf, r.pos, width));
        r.skip(width);
      } else {
        const n = counts![c * height + y];
        if (wanted && c < keep) unpackBits(new Uint8Array(buf, r.pos, n), row);
        r.skip(n);
      }
      if (wanted) {
        if (c < keep) {
          const out = planes[c];
          const o = ty * tw;
          for (let x = 0; x < tw; x++) out[o + x] = row[colAt[x]];
        }
        ty++;
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(tw, th);
  const px = img.data;
  for (let i = 0; i < tw * th; i++) {
    let rr: number, gg: number, bb: number, aa = 255;
    if (mode === 3) {
      rr = planes[0][i]; gg = planes[1]?.[i] ?? rr; bb = planes[2]?.[i] ?? rr;
      if (keep > 3) aa = planes[3][i];
    } else if (mode === 1) {
      rr = gg = bb = planes[0][i];
      if (keep > 1) aa = planes[1][i];
    } else {
      // Photoshop stores CMYK inverted (255 = no ink)
      const k = planes[3]?.[i] ?? 255;
      rr = (planes[0][i] * k) / 255; gg = (planes[1][i] * k) / 255; bb = (planes[2][i] * k) / 255;
      if (keep > 4) aa = planes[4][i];
    }
    px[i * 4] = rr; px[i * 4 + 1] = gg; px[i * 4 + 2] = bb; px[i * 4 + 3] = aa;
  }
  ctx.putImageData(img, 0, 0);
  const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  return png ? { png, width, height } : null;
}

/** The small JPEG preview in the image resources (ids 1036 / 1033), for files too big or unusual to decode. */
async function psdResourceThumb(file: Blob): Promise<PsdResult | null> {
  const head = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer();
  const r = new Reader(head);
  if (r.str(4) !== '8BPS') return null;
  r.skip(2 + 6 + 2);
  const height = r.u32();
  const width = r.u32();
  r.skip(4);
  r.skip(r.u32());
  const len = r.u32();
  if (r.pos + len > head.byteLength) return null;
  const jpeg = findResourceThumb(new DataView(head, r.pos, len));
  return jpeg ? { png: jpeg, width, height } : null;
}

function findResourceThumb(v: DataView): Blob | null {
  let p = 0;
  let found: Blob | null = null;
  while (p + 12 <= v.byteLength) {
    if (v.getUint32(p) !== 0x3842494d) break; // '8BIM'
    const id = v.getUint16(p + 4);
    const nameLen = v.getUint8(p + 6);
    p += 6 + ((nameLen + 2) & ~1);
    const size = v.getUint32(p);
    p += 4;
    if ((id === 1036 || id === 1033) && size > 28) {
      // 28-byte header, then a JFIF file
      found = new Blob([new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset + p + 28, size - 28).slice()], { type: 'image/jpeg' });
      if (id === 1036) return found;
    }
    p += (size + 1) & ~1;
  }
  return found;
}

function unpackBits(src: Uint8Array, out: Uint8Array) {
  let i = 0;
  let o = 0;
  while (i < src.length && o < out.length) {
    const n = (src[i++] << 24) >> 24;
    if (n >= 0) {
      const end = Math.min(i + n + 1, src.length);
      while (i < end && o < out.length) out[o++] = src[i++];
    } else if (n > -128) {
      const v = src[i++];
      for (let k = 0; k < 1 - n && o < out.length; k++) out[o++] = v;
    }
  }
}

class Reader {
  pos = 0;
  private v: DataView;
  constructor(buf: ArrayBuffer) {
    this.v = new DataView(buf);
  }
  skip(n: number) {
    this.pos += n;
  }
  u16() {
    const x = this.v.getUint16(this.pos);
    this.pos += 2;
    return x;
  }
  u32() {
    const x = this.v.getUint32(this.pos);
    this.pos += 4;
    return x;
  }
  u64() {
    const hi = this.u32();
    const lo = this.u32();
    return hi * 2 ** 32 + lo;
  }
  str(n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.v.getUint8(this.pos + i));
    this.pos += n;
    return s;
  }
}
