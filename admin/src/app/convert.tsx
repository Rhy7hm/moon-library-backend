/*
 * "Convert…": download pictures in another format or size, or put pictures and PDFs together as one PDF.
 * Everything is done in the browser from the stored originals — nothing in the library changes.
 *   JPG / PNG / WebP   one file each (several → one ZIP)
 *   PDF                one PDF, a page per picture; PDFs in the selection are added whole, in order
 */
import { useMemo, useState } from 'react';
import { errText, extOf, fileUrl, mainFile, titleOf, type Asset, type FileRow } from './api';
import { IDownload } from './icons';
import { useStore } from './store';
import { Button, Dialog, Segmented } from './ui';

type Format = 'jpg' | 'png' | 'webp' | 'pdf';
type Size = 'full' | '2000' | '1200' | '800';
type Quality = 'high' | 'medium' | 'small';

const MIME: Record<Exclude<Format, 'pdf'>, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const Q: Record<Quality, number> = { high: 0.92, medium: 0.8, small: 0.62 };
/** pictures every browser can open as they are */
const DECODES = /^image\/(png|jpe?g|webp|gif|avif|bmp|svg\+xml)$/;
const isPdf = (f: FileRow) => f.mime === 'application/pdf' || extOf(f.name) === 'pdf';
/** the stored copy the browser can read: the original, or the light copy of one it can't (HEIC, TIFF…) */
const readable = (f: FileRow) => (f.kind !== 'image' ? null : DECODES.test(f.mime) ? f.orig : f.opt && f.optMime?.startsWith('image/') ? f.opt : null);

/** Can this file be converted (a picture the browser reads, or a PDF)? */
export function canConvert(a: Asset) {
  const f = mainFile(a);
  return !!f && f.status === 'ready' && (!!readable(f) || isPdf(f));
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'file';

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function fetchBlob(key: string) {
  const r = await fetch(fileUrl(key), { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`Couldn't read the file (${r.status})`);
  return r.blob();
}

/** One picture, redrawn at the chosen size in the chosen format. */
async function redraw(key: string, mime: string, max: number | null, quality: number) {
  const bmp = await createImageBitmap(await fetchBlob(key));
  try {
    const k = max ? Math.min(1, max / Math.max(bmp.width, bmp.height)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d')!;
    if (mime === 'image/jpeg') {
      // JPG has no see-through: a transparent picture gets a white background
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mime, quality));
    if (!blob || blob.type !== mime) throw new Error("This browser can't make that format");
    return { blob, w: c.width, h: c.height };
  } finally {
    bmp.close();
  }
}

export function ConvertDialog({ assets, onClose }: { assets: Asset[]; onClose: () => void }) {
  const s = useStore();
  const files = useMemo(() => assets.filter(canConvert).map((a) => ({ a, f: mainFile(a)! })), [assets]);
  const pictures = files.filter((x) => !isPdf(x.f));
  const pdfs = files.length - pictures.length;
  const skipped = assets.length - files.length;
  const [format, setFormat] = useState<Format>(pictures.length ? 'jpg' : 'pdf');
  const [size, setSize] = useState<Size>('full');
  const [quality, setQuality] = useState<Quality>('high');
  const [busy, setBusy] = useState<{ done: number; of: number } | null>(null);

  // PDFs only go into a PDF; pictures go into anything
  const use = format === 'pdf' ? files : pictures;
  const max = size === 'full' ? null : Number(size);
  const base = safeName(use.length === 1 ? titleOf(use[0].a) : `Moon Library ${new Date().toISOString().slice(0, 10)}`);
  const result =
    format === 'pdf'
      ? `One PDF · ${use.length} ${use.length === 1 ? 'file' : 'files'} in it`
      : use.length === 1
        ? `1 ${format.toUpperCase()} file`
        : `${use.length} ${format.toUpperCase()} files in one ZIP`;

  const go = async () => {
    if (!use.length || busy) return;
    setBusy({ done: 0, of: use.length });
    const failed: string[] = [];
    try {
      if (format === 'pdf') {
        const { PDFDocument } = await import('pdf-lib');
        const doc = await PDFDocument.create();
        let n = 0;
        for (const { a, f } of use) {
          try {
            if (isPdf(f)) {
              const src = await PDFDocument.load(await (await fetchBlob(f.orig)).arrayBuffer(), { ignoreEncryption: true });
              for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
            } else {
              // photos as JPG keep the PDF small; see-through pictures stay PNG
              const png = f.mime === 'image/png' || f.mime === 'image/gif' || f.mime === 'image/svg+xml';
              const { blob, w, h } = await redraw(readable(f)!, png ? 'image/png' : 'image/jpeg', max, Q[quality]);
              const bytes = await blob.arrayBuffer();
              const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
              doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
            }
          } catch {
            failed.push(titleOf(a));
          }
          setBusy({ done: ++n, of: use.length });
        }
        if (!doc.getPageCount()) throw new Error("None of these could be put into a PDF");
        save(new Blob([(await doc.save()) as BlobPart], { type: 'application/pdf' }), `${base}.pdf`);
      } else {
        const out: { name: string; blob: Blob }[] = [];
        const used = new Map<string, number>();
        let n = 0;
        for (const { a, f } of use) {
          try {
            const { blob } = await redraw(readable(f)!, MIME[format], max, Q[quality]);
            const stem = safeName(titleOf(a));
            const k = used.get(stem.toLowerCase()) ?? 0;
            used.set(stem.toLowerCase(), k + 1);
            out.push({ name: `${stem}${k ? ` (${k + 1})` : ''}.${format}`, blob });
          } catch {
            failed.push(titleOf(a));
          }
          setBusy({ done: ++n, of: use.length });
        }
        if (!out.length) throw new Error("None of these could be converted");
        if (out.length === 1) save(out[0].blob, out[0].name);
        else {
          const { zipSync } = await import('fflate');
          const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
          for (const o of out) entries[o.name] = [new Uint8Array(await o.blob.arrayBuffer()), { level: 0 }]; // already compressed
          save(new Blob([zipSync(entries) as BlobPart], { type: 'application/zip' }), `${base}.zip`);
        }
      }
      onClose();
      if (failed.length) s.toast(`Done, but ${failed.length} couldn't be converted: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`, { tone: 'err' });
      else s.toast(format === 'pdf' ? 'PDF downloaded' : use.length === 1 ? `Downloaded as ${format.toUpperCase()}` : `Downloaded ${use.length} files as ${format.toUpperCase()}`, { tone: 'ok' });
    } catch (e) {
      s.toast(errText(e), { tone: 'err' });
      setBusy(null);
    }
  };

  return (
    <Dialog
      title={assets.length === 1 ? 'Convert and download' : `Convert ${files.length} files`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <span className="upto-where" title={result}>
            {busy ? `Working… ${busy.done} of ${busy.of}` : use.length ? result : 'Nothing here fits this format'}
          </span>
          <Button onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button kind="primary" icon={<IDownload />} disabled={!use.length || !!busy} onClick={go}>
            Download
          </Button>
        </>
      }
    >
      <div className="convert">
        <div className="field">
          <span>Format</span>
          <Segmented
            label="Format"
            value={format}
            onChange={setFormat}
            options={[
              ...(pictures.length
                ? ([
                    { value: 'jpg', label: 'JPG', title: 'Smallest for photos; no see-through' },
                    { value: 'png', label: 'PNG', title: 'Keeps see-through; bigger files' },
                    { value: 'webp', label: 'WebP', title: 'Small, for websites' },
                  ] as const)
                : []),
              { value: 'pdf', label: files.length > 1 ? 'One PDF' : 'PDF', title: 'One PDF, a page per picture' },
            ]}
          />
          <small>
            {format === 'jpg' && 'Best for photos. See-through areas turn white.'}
            {format === 'png' && 'Keeps see-through areas. Files are bigger.'}
            {format === 'webp' && 'Small files, good for websites.'}
            {format === 'pdf' && (pdfs ? `One PDF: a page per picture, and the ${pdfs === 1 ? 'PDF' : `${pdfs} PDFs`} you chose added whole, in the order shown.` : 'One PDF with a page per picture, in the order shown.')}
          </small>
        </div>
        {(format !== 'pdf' || pictures.length > 0) && (
          <div className="field">
            <span>Size</span>
            <Segmented
              label="Size"
              value={size}
              onChange={setSize}
              options={[
                { value: 'full', label: 'Original' },
                { value: '2000', label: 'Large', title: 'Longest side 2000 px' },
                { value: '1200', label: 'Medium', title: 'Longest side 1200 px' },
                { value: '800', label: 'Small', title: 'Longest side 800 px' },
              ]}
            />
            <small>{max ? `Longest side at most ${max} px. Smaller pictures are left as they are.` : 'The same size as the stored picture.'}</small>
          </div>
        )}
        {format !== 'png' && (format !== 'pdf' || pictures.length > 0) && (
          <div className="field">
            <span>Quality</span>
            <Segmented
              label="Quality"
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'high', label: 'High' },
                { value: 'medium', label: 'Medium' },
                { value: 'small', label: 'Smallest file' },
              ]}
            />
          </div>
        )}
        {skipped > 0 && <p className="muted convert-note">{skipped === 1 ? "1 file can't be converted (only pictures and PDFs can) and is left out." : `${skipped} files can't be converted (only pictures and PDFs can) and are left out.`}</p>}
        <p className="muted convert-note">The files in the library stay as they are.</p>
      </div>
    </Dialog>
  );
}
