/*
 * "Colour & logo…": give a folder its own colour, and/or a picture (for example a client's logo).
 * The picture is shrunk to fit a small square in the browser (see-through areas kept, nothing cropped) and
 * stored once; the folder shows it instead of the plain folder icon.
 */
import { useRef, useState } from 'react';
import { errText, fileUrl, nameOf, op, type Folder } from './api';
import { IFolder, IUpload, IX } from './icons';
import { useStore } from './store';
import { Button, Dialog } from './ui';

export const FOLDER_COLORS = ['#4aa3ff', '#9b7bff', '#ff5c8a', '#ff7a59', '#f5b83d', '#34c759', '#30b0c7', '#8e8e93', '#3a3a3c'];
const DEFAULT = FOLDER_COLORS[0];

/** The stored logo's file key, if the folder has one. */
export const logoKey = (f: Pick<Folder, 'icon'>) => (f.icon && f.icon.startsWith('img:') ? f.icon.slice(4) : null);

/** A picture shrunk to fit inside 256 × 256 (never cropped or stretched), as WEBP base64. */
async function encodeLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture (PNG, JPG, WebP or SVG)');
  if (file.size > 12_000_000) throw new Error('That picture is too large (max about 12 MB)');
  const bmp = await createImageBitmap(file);
  const box = 256;
  const k = Math.min(1, box / Math.max(bmp.width, bmp.height)) || 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  let blob: Blob | null = null;
  for (const q of [0.92, 0.8, 0.65]) {
    blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', q));
    if (blob && blob.type === 'image/webp' && blob.size < 400_000) break;
  }
  if (!blob || blob.type !== 'image/webp') throw new Error("This browser can't prepare that picture");
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function FolderLookDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const s = useStore();
  const pick = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(folder.iconBg || DEFAULT);
  const [logo, setLogo] = useState<{ data: string; url: string } | null>(null); // a new picture, not saved yet
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = removed ? null : logo?.url ?? (logoKey(folder) ? fileUrl(logoKey(folder)) : null);
  const dirty = color !== (folder.iconBg || DEFAULT) || !!logo || (removed && !!logoKey(folder));

  const choose = async (file?: File) => {
    if (!file) return;
    try {
      const data = await encodeLogo(file);
      setLogo({ data, url: `data:image/webp;base64,${data}` });
      setRemoved(false);
    } catch (e) {
      s.toast(errText(e), { tone: 'err' });
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { id: folder.id, iconBg: color === DEFAULT ? null : color };
      if (logo) body.icon = (await op<{ icon: string }>('folder.iconImage', { data: logo.data })).icon;
      else if (removed) body.icon = null;
      const r = await s.run('folder.update', body, 'Folder updated');
      if (r) onClose();
    } catch (e) {
      s.toast(errText(e), { tone: 'err' });
    }
    setBusy(false);
  };

  return (
    <Dialog
      title={`Colour & logo · ${nameOf(folder)}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button kind="primary" disabled={!dirty || busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="look">
        <div className="look-preview">
          <span className={`glyph look-glyph${current ? ' has-logo' : ''}`} style={{ ['--c' as string]: color }}>
            {current ? <img src={current} alt="" draggable={false} /> : <IFolder />}
          </span>
          <div>
            <strong>{nameOf(folder)}</strong>
            <small className="muted">{current ? 'Showing your logo' : 'Plain folder, in the colour below'}</small>
          </div>
        </div>

        <div className="field">
          <span>Colour</span>
          <div className="swatches" role="radiogroup" aria-label="Folder colour">
            {FOLDER_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={`swatch${color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
            <label className={`swatch custom${FOLDER_COLORS.includes(color) ? '' : ' on'}`} style={FOLDER_COLORS.includes(color) ? undefined : { background: color }} title="Pick any colour">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Pick any colour" />
            </label>
          </div>
        </div>

        <div className="field">
          <span>Logo</span>
          <div className="look-logo">
            <Button icon={<IUpload />} onClick={() => pick.current?.click()}>
              {current ? 'Choose another picture…' : 'Upload a picture…'}
            </Button>
            {current && (
              <Button icon={<IX />} onClick={() => (setLogo(null), setRemoved(true))}>
                Remove
              </Button>
            )}
            <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => (void choose(e.target.files?.[0]), (e.target.value = ''))} />
          </div>
          <small>Good for a client’s logo. It’s shrunk to fit, never cropped, and see-through backgrounds are kept.</small>
        </div>
      </div>
    </Dialog>
  );
}
