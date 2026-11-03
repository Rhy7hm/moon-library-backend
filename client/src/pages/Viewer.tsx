/*
 * Full-screen viewer. The picture grows out of the tile you clicked (FLIP) and shrinks back into it
 * on close. Arrow keys / swipe to move, Esc to close, a filmstrip to jump.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fileUrl } from '../api';
import { ext, fmtDate, fmtDuration, fmtSize } from '../format';
import { gsap, motionOK } from '../motion';
import { useStore } from '../store';
import { IChevL, IChevR, IDownload, IX } from '../ui/icons';
import { canShow, extColor } from '../ui/Tile';

export function Viewer() {
  const s = useStore();
  const v = s.viewer!;
  const [index, setIndex] = useState(v.index);
  const root = useRef<HTMLDivElement>(null);
  const media = useRef<HTMLElement | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const dir = useRef(0);
  const entry = v.entries[index];
  const f = entry.file;

  // open: grow from the tile
  useLayoutEffect(() => {
    const ok = motionOK();
    gsap.fromTo('.viewer-bg', { autoAlpha: 0 }, { autoAlpha: 1, duration: ok ? 0.4 : 0 });
    gsap.fromTo('.viewer-top, .viewer-foot', { autoAlpha: 0, y: (i) => (i ? 20 : -20) }, { autoAlpha: 1, y: 0, duration: ok ? 0.5 : 0, delay: ok ? 0.15 : 0 });
    const from = v.from?.getBoundingClientRect();
    const el = media.current;
    if (!ok || !from || !el) return;
    const grow = () => {
      const to = el.getBoundingClientRect();
      if (!to.width) return;
      gsap.fromTo(
        el,
        { x: from.left + from.width / 2 - (to.left + to.width / 2), y: from.top + from.height / 2 - (to.top + to.height / 2), scale: Math.max(from.width / to.width, from.height / to.height), borderRadius: 18 },
        { x: 0, y: 0, scale: 1, borderRadius: 6, duration: 0.65, ease: 'expo.out' },
      );
    };
    if (el instanceof HTMLImageElement && !el.complete) el.addEventListener('load', grow, { once: true });
    else grow();
    document.documentElement.style.overflow = 'hidden';
    return () => void (document.documentElement.style.overflow = '');
  }, []);

  useEffect(() => () => void (document.documentElement.style.overflow = ''), []);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const ok = motionOK();
    const from = index === v.index ? v.from?.getBoundingClientRect() : undefined;
    const el = media.current;
    const tl = gsap.timeline({ onComplete: s.closeViewer });
    tl.to('.viewer-top, .viewer-foot, .viewer-nav', { autoAlpha: 0, duration: ok ? 0.2 : 0 }, 0);
    tl.to('.viewer-bg', { autoAlpha: 0, duration: ok ? 0.4 : 0 }, ok ? 0.1 : 0);
    if (ok && el && from && from.width) {
      const to = el.getBoundingClientRect();
      tl.to(el, { x: from.left + from.width / 2 - (to.left + to.width / 2), y: from.top + from.height / 2 - (to.top + to.height / 2), scale: Math.max(from.width / to.width, from.height / to.height), borderRadius: 18, duration: 0.5, ease: 'expo.inOut' }, 0);
    } else if (el) tl.to(el, { autoAlpha: 0, scale: 0.94, duration: ok ? 0.3 : 0 }, 0);
  }, [index, v, s.closeViewer]);

  const move = useCallback(
    (d: number) => {
      const n = index + d;
      if (n < 0 || n >= v.entries.length) {
        if (motionOK() && media.current) gsap.fromTo(media.current, { x: 0 }, { keyframes: { x: [d * -18, 0] }, duration: 0.4, ease: 'power2.out' });
        return;
      }
      dir.current = d;
      setIndex(n);
    },
    [index, v.entries.length],
  );

  // slide the new one in
  useLayoutEffect(() => {
    if (!dir.current || !media.current || !motionOK()) return;
    gsap.fromTo(media.current, { x: dir.current * 80, autoAlpha: 0, scale: 0.97 }, { x: 0, autoAlpha: 1, scale: 1, duration: 0.5, ease: 'expo.out' });
    strip.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'ArrowLeft') move(-1);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [close, move]);

  // swipe on touch screens
  const touch = useRef<{ x: number; y: number } | null>(null);
  const setMedia = (el: HTMLElement | null) => void (media.current = el);

  const isPdf = f.mime === 'application/pdf';
  let body: React.ReactNode;
  if (f.kind === 'video') body = <video key={f.id} ref={setMedia} className="viewer-media" src={fileUrl(f, 'preview')} poster={f.hasThumb ? fileUrl(f, 'thumb') : undefined} controls autoPlay playsInline />;
  else if (f.kind === 'audio') body = <audio key={f.id} ref={setMedia} src={fileUrl(f, 'download')} controls autoPlay />;
  else if (canShow(f)) body = <img key={f.id} ref={setMedia} className="viewer-media" src={f.hasPreview || f.kind === 'image' ? fileUrl(f, 'preview') : fileUrl(f, 'thumb')} alt={entry.item.title} />;
  else if (isPdf) body = <iframe key={f.id} ref={setMedia} src={fileUrl(f, 'preview')} title={f.name} />;
  else
    body = (
      <div className="viewer-doc" ref={setMedia} key={f.id}>
        <span className="doc-ext" style={{ ['--e' as string]: extColor(f.name) }}>
          {ext(f.name) || 'FILE'}
        </span>
        <strong>{f.name}</strong>
        <span className="muted">{fmtSize(f.size)} · open it in the app it was made with</span>
        <a className="btn primary" href={fileUrl(f, 'download')} download>
          <IDownload /> Download
        </a>
      </div>
    );

  return (
    <div className="viewer" ref={root} role="dialog" aria-modal="true" aria-label={entry.item.title || f.name}>
      <div className="viewer-bg" onClick={close} />
      <div className="viewer-top">
        <div className="t">
          <strong>{entry.item.title || f.name}</strong>
          <small>
            {index + 1} of {v.entries.length} · {fmtDate(entry.item.date)}
          </small>
        </div>
        <a className="btn" href={fileUrl(f, 'download')} download>
          <IDownload /> <span>Download</span>
        </a>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <IX />
        </button>
      </div>
      <div
        className="viewer-stage"
        onClick={(e) => e.target === e.currentTarget && close()}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
          else if (dy > 90) close();
        }}
      >
        {body}
      </div>
      {v.entries.length > 1 && (
        <>
          <button className="icon-btn viewer-nav prev" onClick={() => move(-1)} aria-label="Previous" disabled={index === 0}>
            <IChevL />
          </button>
          <button className="icon-btn viewer-nav next" onClick={() => move(1)} aria-label="Next" disabled={index === v.entries.length - 1}>
            <IChevR />
          </button>
        </>
      )}
      <div className="viewer-foot">
        {v.entries.length > 1 && v.entries.length <= 80 ? (
          <div className="filmstrip" ref={strip}>
            {v.entries.map((e, i) => (
              <button key={e.file.id} className={i === index ? 'on' : ''} onClick={() => ((dir.current = i > index ? 1 : -1), setIndex(i))} aria-label={`Show ${e.item.title || e.file.name}`}>
                {canShow(e.file) ? <img src={fileUrl(e.file, e.file.hasThumb ? 'thumb' : 'preview')} alt="" loading="lazy" /> : <span className="fs-doc">{ext(e.file.name) || 'FILE'}</span>}
              </button>
            ))}
          </div>
        ) : (
          <span>
            {f.name} · {fmtSize(f.size)}
            {f.width && f.height ? ` · ${f.width}×${f.height}` : ''}
            {f.duration ? ` · ${fmtDuration(f.duration)}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
