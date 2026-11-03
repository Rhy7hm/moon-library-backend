/*
 * "Delete for good", the physical way: the file sits on a card above a paper shredder. Drag it down
 * into the slit — once the rollers bite they pull it through, the part that's gone through comes out
 * as strips that curl, and when it's all through the strips drop away and the file is deleted.
 * "Shred it" does the same without dragging (keyboard, touch), and with reduced motion it just deletes.
 *
 * The strips are copies of the card, each clipped to a thin vertical band below the slit, so whatever
 * the card shows (thumbnail, name, size) is what gets cut up.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ICheck, ITrash, IX } from './icons';
import { gsap, motionOK } from './motion';
import { Button } from './ui';

export type ShredItem = { title: string; meta: string; thumb: ReactNode; stack?: number };

const W = 300; // card width
const H = 76; // card height
const TOP = 18; // card's resting place
const SLIT = 196; // where the rollers are
const STAGE = SLIT + 170; // room below for the strips to fall into
const STRIP = 10; // strip width
const N = Math.ceil(W / STRIP);
const FEED = 150; // px per second once the rollers have it
const BITE = 8; // how far past the slit the card has to reach before the rollers grab it

function Card({ item }: { item: ShredItem }) {
  return (
    <div className={`shred-card${item.stack ? ' stack' : ''}`}>
      <span className="shred-thumb">{item.thumb}</span>
      <span className="shred-text">
        <strong>{item.title}</strong>
        <small>{item.meta}</small>
      </span>
    </div>
  );
}

export function ShredDialog({ item, title, onShred, onClose }: { item: ShredItem; title: string; onShred: () => Promise<boolean>; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const strips = useRef<HTMLDivElement>(null);
  const housing = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: TOP, tilt: 0 });
  const curl = useRef(Array.from({ length: N }, () => ({ r: (Math.random() - 0.5) * 2, s: 0.6 + Math.random() * 0.8 })));
  const [phase, setPhase] = useState<'idle' | 'drag' | 'feeding' | 'done' | 'failed'>('idle');
  const busy = phase === 'feeding' || phase === 'done';
  const left = useRef(0); // card's x when centred in the stage

  // draw the card and the strips for the current position
  const render = () => {
    const { x, y, tilt } = pos.current;
    const fed = Math.max(0, y + H - SLIT); // how much has gone through
    const cx = left.current + x;
    if (card.current) {
      gsap.set(card.current, { x: cx, y, rotation: tilt });
      card.current.style.clipPath = `inset(0 0 ${Math.min(H, fed)}px 0)`;
    }
    const kids = strips.current?.children;
    if (!kids) return;
    const cut = SLIT - y; // where the slit falls on the card
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i] as HTMLElement;
      const c = curl.current[i];
      const depth = Math.min(1, fed / H);
      el.style.clipPath = `inset(${Math.max(0, cut)}px ${W - (i + 1) * STRIP}px 0 ${i * STRIP}px)`;
      gsap.set(el, {
        x: cx + (i - N / 2) * depth * 0.9 * c.s,
        y,
        rotation: c.r * depth * 9 * c.s,
        transformOrigin: `${(i + 0.5) * STRIP}px ${cut}px`,
      });
    }
  };

  useLayoutEffect(() => {
    left.current = ((stage.current?.clientWidth ?? W) - W) / 2;
    render();
    if (motionOK()) gsap.from(card.current, { y: -30, opacity: 0, duration: 0.6, ease: 'back.out(1.6)' });
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [busy, onClose]);

  // the rollers have it: pull the card through, curl the strips, drop them, then delete for real
  const feed = async () => {
    setPhase('feeding');
    const p = pos.current;
    const hum = gsap.to(housing.current, { x: 0.8, duration: 0.04, repeat: -1, yoyo: true, ease: 'none' });
    await gsap.to(p, { x: 0, tilt: 0, y: SLIT + 2, duration: Math.max(0.4, (SLIT + 2 - p.y) / FEED), ease: 'none', onUpdate: render });
    hum.kill();
    gsap.set(housing.current, { x: 0 });
    const ok = await onShred();
    if (!ok) {
      setPhase('failed');
      return;
    }
    setPhase('done');
    await gsap.to(strips.current!.children, {
      y: `+=${150 + Math.random() * 30}`,
      rotation: () => `+=${(Math.random() - 0.5) * 70}`,
      opacity: 0,
      duration: 0.9,
      ease: 'power2.in',
      stagger: { each: 0.012, from: 'random' },
    });
    setTimeout(onClose, 650);
  };

  const shredNow = async () => {
    if (busy) return;
    if (!motionOK()) {
      setPhase('feeding');
      if (await onShred()) onClose();
      else setPhase('failed');
      return;
    }
    // walk the card to the slit, then let the rollers take it
    await gsap.to(pos.current, { y: SLIT - H + BITE, x: 0, tilt: 0, duration: 0.45, ease: 'power2.in', onUpdate: render });
    feed();
  };

  // dragging: down towards the slit; once it bites, it's the shredder's
  const drag = useRef<{ id: number; sx: number; sy: number; y0: number } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (busy) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, y0: pos.current.y };
    gsap.killTweensOf(pos.current);
    setPhase('drag');
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const p = pos.current;
    p.y = Math.max(0, Math.min(SLIT - H + BITE, d.y0 + e.clientY - d.sy));
    p.x = Math.max(-40, Math.min(40, dx * 0.4));
    p.tilt = Math.max(-6, Math.min(6, dx * 0.04));
    render();
    if (p.y >= SLIT - H + BITE) {
      drag.current = null;
      feed();
    }
  };
  const up = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    setPhase('idle');
    // not far enough: it springs back
    gsap.to(pos.current, { x: 0, y: TOP, tilt: 0, duration: 0.7, ease: 'elastic.out(1, 0.6)', onUpdate: render });
  };

  const near = phase === 'drag';
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog shred-dialog" role="dialog" aria-modal aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <IX />
          </button>
        </header>
        <div className="dialog-body">
          <p className="muted shred-lead">
            {phase === 'done' ? 'Gone for good.' : phase === 'failed' ? 'That didn’t work — nothing was deleted.' : 'Drag it into the shredder to delete it forever. This can’t be undone.'}
          </p>
          <div className={`shred-stage${near ? ' near' : ''}${busy ? ' busy' : ''}`} ref={stage} style={{ height: STAGE }}>
            <div className="shred-strips" ref={strips} aria-hidden>
              {Array.from({ length: N }, (_, i) => (
                <div key={i} className="shred-strip">
                  <Card item={item} />
                </div>
              ))}
            </div>
            <div
              ref={card}
              className={`shred-grab${phase === 'drag' ? ' held' : ''}`}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              role="img"
              aria-label={`${item.title}, ready to shred`}
            >
              <Card item={item} />
            </div>
            <div className="shred-guide" aria-hidden style={{ top: TOP + H + 10, height: SLIT - TOP - H - 30 }}>
              <span>Drag down</span>
            </div>
            <div className="shredder" ref={housing} style={{ top: SLIT - 22 }} aria-hidden>
              <span className="shredder-slit" />
              <span className="shredder-teeth" />
            </div>
            {phase === 'done' && (
              <span className="shred-done" aria-live="polite">
                <ICheck /> Deleted
              </span>
            )}
          </div>
        </div>
        <footer>
          <Button onClick={onClose} disabled={busy}>
            {phase === 'failed' ? 'Close' : 'Keep it'}
          </Button>
          <Button kind="danger" icon={<ITrash />} onClick={shredNow} disabled={busy || phase === 'failed'}>
            Shred it
          </Button>
        </footer>
      </div>
    </div>
  );
}
