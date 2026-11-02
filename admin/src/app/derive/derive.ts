/*
 * Makes the thumbnail, optimised copy and video poster in the browser before
 * upload, so the server never has to process images. Mirrors what the import
 * script does with sharp/ffmpeg.
 */
import type { Derived } from '@/lib/upload-client';

const THUMB_W = 720;
const OPT_MAX_W = 2000;
const OPT_MIN_SAVING = 0.15;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((res) => c.toBlob((b) => res(b), type, q));
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file);
  } catch {
    // older Safari: fall back to an <img>
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

/** Background for thumbnails of transparent graphics (e.g. story overlays). */
const THUMB_BG = '#2b2522';

/**
 * Pictures: thumbnail + optimised copy. `cover` = the picture to make the thumbnail from
 * instead (a chosen GIF frame). GIFs on their own use their first frame that isn't blank.
 */
export async function deriveImage(file: Blob, cover?: Blob): Promise<Derived> {
  const isGif = file.type === 'image/gif';
  const src = await decode(cover ?? (isGif ? ((await gifFirstSolidFrame(file)) ?? file) : file));
  const w = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h = 'naturalHeight' in src ? src.naturalHeight : src.height;

  // Transparent? And if so, where does the visible content sit?
  const rows = 96;
  const cols = Math.max(1, Math.round((w / h) * rows));
  const probe = canvas(cols, rows).getContext('2d', { willReadFrequently: true })!;
  probe.drawImage(src, 0, 0, cols, rows);
  const px = probe.getImageData(0, 0, cols, rows).data;
  let alpha = false;
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < rows; y++) {
    let solid = 0;
    for (let x = 0; x < cols; x++) {
      const a = px[(y * cols + x) * 4 + 3];
      if (a < 250) alpha = true;
      if (a > 40) solid++;
    }
    if (solid > cols * 0.05) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  // Mostly-empty transparent graphics (story overlays) get a dark backdrop and
  // a crop focused on their content; ones that fill the frame are treated normally.
  const sparse = alpha && top >= 0 && (bottom - top + 1) / rows <= 0.85;
  const focusY = sparse ? Math.min(1, Math.max(0, ((top + bottom + 1) / 2 / rows - 0.5) * 1.6 + 0.5)) : null;

  // Thumbnail: 720 wide, at most 1.9× as tall, crop window over the content.
  const tw = Math.min(w, THUMB_W);
  const fullH = Math.round((h * tw) / w);
  const th = Math.min(fullH, Math.round(tw * 1.9));
  const offset = Math.round(Math.min(fullH - th, Math.max(0, (focusY ?? 0) * fullH - th / 2)));
  const tc = canvas(tw, th);
  const tctx = tc.getContext('2d')!;
  if (alpha) {
    tctx.fillStyle = sparse ? THUMB_BG : '#ffffff';
    tctx.fillRect(0, 0, tw, th);
  }
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(src, 0, -offset, tw, fullH);
  const thumb = await toBlob(tc, 'image/webp', 0.78);

  // Transparent graphics keep their PNG original as the download.
  let opt: Blob | null = null;
  if (!alpha && file.type !== 'image/gif') {
    const ow = Math.min(w, OPT_MAX_W);
    const oh = Math.round((h * ow) / w);
    const oc = canvas(ow, oh);
    const octx = oc.getContext('2d')!;
    octx.fillStyle = '#fff';
    octx.fillRect(0, 0, ow, oh);
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, ow, oh);
    opt = await toBlob(oc, 'image/jpeg', 0.86);
    if (opt && opt.size >= file.size * (1 - OPT_MIN_SAVING)) opt = null;
  }
  if ('close' in src) src.close();
  return { width: w, height: h, thumb, opt, optMime: opt ? 'image/jpeg' : null, focusY };
}

export function deriveVideo(file: Blob): Promise<Derived> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let settled = false;
    const done = (d: Derived) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      v.load();
      resolve(d);
    };
    const timer = setTimeout(() => done({}), 20000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 3) / 3);
    };
    v.onseeked = async () => {
      clearTimeout(timer);
      const w = v.videoWidth;
      const h = v.videoHeight;
      let poster: Blob | null = null;
      if (w && h) {
        const pw = Math.min(w, THUMB_W);
        const c = canvas(pw, Math.round((h * pw) / w));
        c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
        poster = await toBlob(c, 'image/webp', 0.8);
      }
      done({ width: w || null, height: h || null, duration: isFinite(v.duration) ? v.duration : null, poster });
    };
    v.onerror = () => {
      clearTimeout(timer);
      done({});
    };
    v.src = url;
  });
}

/* ---------- GIF frames (for the cover) ---------- */
/*
 * A small GIF reader of our own, so choosing a cover frame works in every browser
 * (Safari has no built-in way to step through GIF frames). Frames are put together
 * the way browsers play them (transparency, "disposal"), one at a time.
 */

type GifFrame = { x: number; y: number; w: number; h: number; palette: Uint8Array | null; interlaced: boolean; minCode: number; data: Uint8Array; disposal: number; trans: number };

function parseGif(buf: Uint8Array) {
  const sig = String.fromCharCode(...buf.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Not a GIF');
  const u16 = (o: number) => buf[o] | (buf[o + 1] << 8);
  const width = u16(6);
  const height = u16(8);
  const packed = buf[10];
  let p = 13;
  let global: Uint8Array | null = null;
  if (packed & 0x80) {
    const n = 3 * (1 << ((packed & 7) + 1));
    global = buf.subarray(p, p + n);
    p += n;
  }
  const frames: GifFrame[] = [];
  let disposal = 0;
  let trans = -1;
  const subBlocks = () => {
    const parts: Uint8Array[] = [];
    let len = 0;
    while (p < buf.length) {
      const size = buf[p++];
      if (!size) break;
      parts.push(buf.subarray(p, p + size));
      len += size;
      p += size;
    }
    const out = new Uint8Array(len);
    let o = 0;
    for (const part of parts) {
      out.set(part, o);
      o += part.length;
    }
    return out;
  };
  while (p < buf.length) {
    const b = buf[p++];
    if (b === 0x3b) break; // end
    if (b === 0x21) {
      const label = buf[p++];
      if (label === 0xf9) {
        // graphic control: how the next frame is drawn
        const f = buf[p + 1];
        disposal = (f >> 2) & 7;
        trans = f & 1 ? buf[p + 4] : -1;
        p += buf[p] + 1;
        subBlocks();
      } else subBlocks();
    } else if (b === 0x2c) {
      const x = u16(p);
      const y = u16(p + 2);
      const w = u16(p + 4);
      const h = u16(p + 6);
      const f = buf[p + 8];
      p += 9;
      let palette = global;
      if (f & 0x80) {
        const n = 3 * (1 << ((f & 7) + 1));
        palette = buf.subarray(p, p + n);
        p += n;
      }
      const minCode = buf[p++];
      frames.push({ x, y, w, h, palette, interlaced: !!(f & 0x40), minCode, data: subBlocks(), disposal, trans });
      disposal = 0;
      trans = -1;
    } else break; // unknown block: stop here, keep the frames read so far
  }
  return { width, height, frames };
}

/** LZW → colour indexes of one frame. */
function lzw(minCode: number, data: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minCode;
  const eoi = clear + 1;
  const prefix = new Int16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let size = minCode + 1;
  let next = eoi + 1;
  let old = -1;
  let first = 0;
  let datum = 0;
  let bits = 0;
  let pos = 0;
  let op = 0;
  while (op < count) {
    while (bits < size) {
      if (pos >= data.length) return out;
      datum |= data[pos++] << bits;
      bits += 8;
    }
    let code = datum & ((1 << size) - 1);
    datum >>>= size;
    bits -= size;
    if (code === clear) {
      size = minCode + 1;
      next = eoi + 1;
      old = -1;
      continue;
    }
    if (code === eoi) break;
    if (old === -1) {
      out[op++] = suffix[code];
      old = code;
      first = code;
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code >= next) {
      stack[sp++] = first;
      code = old;
    }
    while (code > eoi) {
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = old;
      suffix[next] = first;
      next++;
      if (next === 1 << size && size < 12) size++;
    }
    old = inCode;
    while (sp > 0 && op < count) out[op++] = stack[--sp];
  }
  return out;
}

export type GifReader = { count: number; width: number; height: number; draw(i: number, c: HTMLCanvasElement): Promise<void>; close(): void };

/** Opens a GIF frame by frame, or null when it can't be read. */
export async function openGif(file: Blob): Promise<GifReader | null> {
  let gif: ReturnType<typeof parseGif>;
  try {
    gif = parseGif(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
  const { width: W, height: H, frames } = gif;
  if (!frames.length || !W || !H) return null;

  // the picture so far, and where we are
  let pix = new Uint8ClampedArray(W * H * 4);
  let at = -1;
  let saved: Uint8ClampedArray | null = null; // for "restore to previous"
  // copies along the way, so going back doesn't start from the beginning
  const every = Math.max(8, Math.ceil(frames.length / 20));
  const marks = new Map<number, { pix: Uint8ClampedArray; saved: Uint8ClampedArray | null }>();

  const step = (k: number) => {
    // undo the previous frame first, as it asked
    if (k > 0) {
      const prev = frames[k - 1];
      if (prev.disposal === 2) {
        for (let y = Math.max(0, prev.y); y < Math.min(H, prev.y + prev.h); y++) pix.fill(0, (y * W + Math.max(0, prev.x)) * 4, (y * W + Math.min(W, prev.x + prev.w)) * 4);
      } else if (prev.disposal === 3 && saved) pix.set(saved);
    }
    const f = frames[k];
    saved = f.disposal === 3 ? pix.slice() : null;
    const idx = lzw(f.minCode, f.data, f.w * f.h);
    const pal = f.palette;
    if (pal) {
      // interlaced frames store their rows in four passes
      const rows: number[] = [];
      if (f.interlaced) for (const [s, d] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let r = s; r < f.h; r += d) rows.push(r);
      for (let r = 0; r < f.h; r++) {
        const yy = f.y + (f.interlaced ? rows[r] : r);
        if (yy < 0 || yy >= H) continue;
        for (let c = 0; c < f.w; c++) {
          const xx = f.x + c;
          if (xx < 0 || xx >= W) continue;
          const ci = idx[r * f.w + c];
          if (ci === f.trans) continue;
          const o = (yy * W + xx) * 4;
          pix[o] = pal[ci * 3];
          pix[o + 1] = pal[ci * 3 + 1];
          pix[o + 2] = pal[ci * 3 + 2];
          pix[o + 3] = 255;
        }
      }
    }
    at = k;
    if (k % every === 0 && !marks.has(k)) marks.set(k, { pix: pix.slice(), saved: saved ? (saved as Uint8ClampedArray).slice() : null });
  };

  const goTo = (i: number) => {
    if (i < at || at < 0) {
      // back to the nearest copy at or before i (or the very start)
      let best = -1;
      for (const k of marks.keys()) if (k <= i && k > best) best = k;
      if (best >= 0) {
        const m = marks.get(best)!;
        pix = m.pix.slice();
        saved = m.saved ? m.saved.slice() : null;
        at = best;
      } else {
        pix = new Uint8ClampedArray(W * H * 4);
        saved = null;
        at = -1;
      }
    }
    while (at < i) step(at + 1);
  };

  return {
    count: frames.length,
    width: W,
    height: H,
    async draw(i, c) {
      goTo(Math.max(0, Math.min(frames.length - 1, i)));
      c.width = W;
      c.height = H;
      c.getContext('2d')!.putImageData(new ImageData(pix.slice(), W, H), 0, 0);
    },
    close: () => marks.clear(),
  };
}

/** A frame that is (almost) one flat colour or see-through — e.g. the white first frame many GIFs start on. */
export function isBlankFrame(c: HTMLCanvasElement) {
  const s = canvas(24, 24);
  const ctx = s.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, 24, 24);
  const px = ctx.getImageData(0, 0, 24, 24).data;
  let n = 0;
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 40) continue;
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    n++;
    sum += l;
    sq += l * l;
  }
  if (n < 24) return true;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean)) < 6;
}

/** The first frame of a GIF that isn't blank, as a PNG — null when the first frame is fine or the browser can't tell. */
async function gifFirstSolidFrame(file: Blob): Promise<Blob | null> {
  const gif = await openGif(file);
  if (!gif) return null;
  try {
    const c = canvas(1, 1);
    for (let i = 0; i < Math.min(gif.count, 60); i++) {
      await gif.draw(i, c);
      if (!isBlankFrame(c)) return i === 0 ? null : await toBlob(c, 'image/png', 1);
    }
    return null;
  } finally {
    gif.close();
  }
}

/** Length of an audio file, read by the browser. */
export function deriveAudio(file: Blob): Promise<Derived> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('audio');
    a.preload = 'metadata';
    const done = (d: Derived) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const timer = setTimeout(() => done({}), 10000);
    a.onloadedmetadata = () => {
      clearTimeout(timer);
      done({ duration: isFinite(a.duration) ? a.duration : null });
    };
    a.onerror = () => {
      clearTimeout(timer);
      done({});
    };
    a.src = url;
  });
}
