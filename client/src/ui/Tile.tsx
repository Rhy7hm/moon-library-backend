/* One file in the gallery: picture, video (with length), or a document card. */
import { useState } from 'react';
import { fileUrl, type FileInfo, type Item } from '../api';
import { ext, fmtDuration, fmtSize } from '../format';
import { IDoc, IMusic, IPlay } from './icons';

const EXT_COLOR: Record<string, string> = { PDF: '#e5484d', PSD: '#31a8ff', AI: '#ff9a00', DOC: '#2b6cd9', DOCX: '#2b6cd9', XLS: '#1d9b46', XLSX: '#1d9b46', PPT: '#d9542b', PPTX: '#d9542b', ZIP: '#8e8e93', FIG: '#a259ff' };
export const extColor = (name: string) => EXT_COLOR[ext(name)] ?? 'var(--accent)';

export const canShow = (f: FileInfo) => f.hasThumb || (f.kind === 'image' && f.mime !== 'image/svg+xml' && f.mime.startsWith('image/'));

export function Thumb({ f, className }: { f: FileInfo; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  const src = f.hasThumb ? fileUrl(f, 'thumb') : fileUrl(f, 'preview');
  const ratio = f.width && f.height ? `${f.width} / ${f.height}` : undefined;
  return <img className={`${className ?? ''}${loaded ? '' : ' loading'}`} src={src} alt="" loading="lazy" decoding="async" style={{ aspectRatio: ratio }} onLoad={() => setLoaded(true)} />;
}

export function Tile({ item, file, onOpen, note }: { item: Item; file: FileInfo; onOpen: (el: HTMLElement) => void; note?: string }) {
  const more = item.files.length > 1 && item.files[0].id === file.id ? item.files.length : 0;
  return (
    <button className="tile" onClick={(e) => onOpen(e.currentTarget.querySelector('img') ?? e.currentTarget)} aria-label={`Open ${item.title || file.name}`}>
      {canShow(file) ? (
        <Thumb f={file} />
      ) : (
        <span className="doc">
          <span className="doc-ext" style={{ ['--e' as string]: extColor(file.name) }}>
            {file.kind === 'audio' ? <IMusic /> : ext(file.name) || <IDoc />}
          </span>
          <strong>{item.title || file.name}</strong>
          <small>{fmtSize(file.size)}</small>
        </span>
      )}
      {file.kind === 'video' && (
        <span className="badge">
          <IPlay /> {fmtDuration(file.duration) || 'Video'}
        </span>
      )}
      {more > 1 && <span className="badge right">{more} files</span>}
      <span className="tile-shade">
        <strong>{item.title || file.name}</strong>
        <small>{note ?? `${ext(file.name) || file.kind} · ${fmtSize(file.size)}`}</small>
      </span>
    </button>
  );
}
