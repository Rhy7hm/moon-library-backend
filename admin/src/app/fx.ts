/*
 * Pointer-driven polish for the whole admin, set up once (see Shell):
 *   sidebar   the places near the pointer grow, like the macOS Dock, and a highlight glides between them
 *   cards     lift and tilt a little toward the pointer, with a soft light on the picture where it is
 *   buttons   the main (primary) button leans toward the pointer
 *
 * How it stays smooth: pointer events only record where the pointer is. One loop, in step with the
 * screen (requestAnimationFrame), eases every value toward its target and writes transforms only —
 * nothing here changes layout, and no CSS transition is restarted on each mouse move. Sizes are
 * measured once when the pointer enters something, not on every move.
 * Only with a mouse or trackpad, and never when the person asked their computer for less motion.
 */
import { motionOK } from './motion';

const REACH = 84; // px either side of the pointer that the sidebar magnifies
const EASE = 0.2; // how much of the remaining distance is covered each frame (higher = snappier)

type DockItem = { icon: HTMLElement | null; mid: number; k: number; to: number; amp: number };
type Dock = { nav: HTMLElement; top: number; items: DockItem[]; live: boolean };
type Tilt = { el: HTMLElement; glare: HTMLElement | null; r: DOMRect; x: number; y: number; tx: number; ty: number; lift: number; to: number; press: boolean };
type Magnet = { el: HTMLElement; r: DOMRect; x: number; y: number; tx: number; ty: number; live: boolean };

export function startFx(): () => void {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  const root = document.documentElement;
  root.classList.add('fx');

  const docks = new Map<HTMLElement, Dock>();
  const tilts = new Map<HTMLElement, Tilt>();
  const magnets = new Map<HTMLElement, Magnet>();
  let dock: Dock | null = null;
  let tilt: Tilt | null = null;
  let magnet: Magnet | null = null;
  let px = 0;
  let py = 0;
  let frame = 0;

  const step = () => {
    frame = 0;
    let busy = false;

    for (const d of docks.values()) {
      let moving = false;
      for (const it of d.items) {
        it.to = d.live ? ease(Math.max(0, 1 - Math.abs(py - it.mid) / REACH)) : 0;
        it.k += (it.to - it.k) * EASE;
        if (Math.abs(it.to - it.k) < 0.002) it.k = it.to;
        else moving = true;
        // the icon alone grows; the labels stay put so their left edges line up
        if (it.icon) it.icon.style.scale = it.k ? (1 + it.k * it.amp).toFixed(3) : '';
      }
      if (moving || d.live) busy = busy || moving;
      if (!moving && !d.live) docks.delete(d.nav);
    }

    for (const t of tilts.values()) {
      t.x += (t.tx - t.x) * EASE;
      t.y += (t.ty - t.y) * EASE;
      t.lift += (t.to - t.lift) * EASE;
      const rest = Math.abs(t.tx - t.x) < 0.002 && Math.abs(t.ty - t.y) < 0.002 && Math.abs(t.to - t.lift) < 0.004;
      if (rest && !t.to) {
        t.el.style.transform = '';
        t.el.style.willChange = '';
        if (t.glare) t.glare.style.cssText = '';
        tilts.delete(t.el);
        continue;
      }
      if (!rest) busy = true;
      // x, y: -0.5 … 0.5 across the card. It leans toward the pointer and lifts off the page.
      const s = t.press ? 0.985 : 1 + t.lift * 0.012;
      t.el.style.transform = `perspective(900px) translate3d(0,${(-4 * t.lift).toFixed(2)}px,0) rotateX(${(-t.y * 7 * t.lift).toFixed(2)}deg) rotateY(${(t.x * 7 * t.lift).toFixed(2)}deg) scale(${s.toFixed(4)})`;
      if (t.glare) {
        t.glare.style.opacity = t.lift.toFixed(3);
        t.glare.style.transform = `translate3d(${(t.x * 50).toFixed(2)}%,${(t.y * 50).toFixed(2)}%,0)`;
      }
    }

    for (const m of magnets.values()) {
      m.x += (m.tx - m.x) * EASE;
      m.y += (m.ty - m.y) * EASE;
      const rest = Math.abs(m.tx - m.x) < 0.05 && Math.abs(m.ty - m.y) < 0.05;
      if (rest && !m.live) {
        m.el.style.translate = '';
        magnets.delete(m.el);
        continue;
      }
      if (!rest) busy = true;
      m.el.style.translate = `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`;
    }

    if (busy) kick();
  };
  const kick = () => {
    if (!frame) frame = requestAnimationFrame(step);
  };

  const leaveDock = () => {
    if (!dock) return;
    dock.live = false;
    dock.nav.style.setProperty('--go', '0');
    dock = null;
  };
  const leaveTilt = () => {
    if (!tilt) return;
    tilt.to = tilt.tx = tilt.ty = 0;
    tilt.press = false;
    tilt = null;
  };
  const leaveMagnet = () => {
    if (!magnet) return;
    magnet.live = false;
    magnet.tx = magnet.ty = 0;
    magnet = null;
  };
  const leaveAll = () => (leaveDock(), leaveTilt(), leaveMagnet(), kick());

  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !motionOK() || document.body.classList.contains('is-moving')) return leaveAll();
    px = e.clientX;
    py = e.clientY;
    const t = e.target instanceof Element ? e.target : null;

    // ---- sidebar: magnify around the pointer; the highlight glides to the place under it
    const n = t?.closest<HTMLElement>('.side .nav') ?? null;
    if (n !== dock?.nav) leaveDock();
    if (n) {
      if (!dock) {
        const had = docks.get(n);
        const top = n.getBoundingClientRect().top;
        const items = [...n.querySelectorAll<HTMLElement>('.nav-item')].map((el, i) => {
          const r = el.getBoundingClientRect();
          return {
            icon: el.querySelector<HTMLElement>(':scope > .nav-icon, :scope > svg:first-child'),
            mid: r.top + r.height / 2,
            k: had?.items[i]?.k ?? 0,
            to: 0,
            // the 3D pictures are already big (and the current page's is bigger still), so they grow least
            amp: el.classList.contains('nav-3d') ? 0.14 : 0.28,
          };
        });
        dock = { nav: n, top, items, live: true };
        docks.set(n, dock);
      }
      const over = t!.closest<HTMLElement>('.nav-item');
      if (over && n.contains(over)) {
        const r = over.getBoundingClientRect();
        n.style.setProperty('--gy', `${(r.top - dock.top).toFixed(1)}px`);
        n.style.setProperty('--gh', `${r.height.toFixed(1)}px`);
        n.style.setProperty('--go', '1');
      }
    }

    // ---- cards: lift, lean toward the pointer, light on the picture
    const c = t?.closest<HTMLElement>('.card') ?? null;
    if (c !== tilt?.el) leaveTilt();
    if (c) {
      if (!tilt) {
        const had = tilts.get(c);
        tilt = had ?? { el: c, glare: c.querySelector<HTMLElement>('.card-glare'), r: c.getBoundingClientRect(), x: 0, y: 0, tx: 0, ty: 0, lift: 0, to: 1, press: false };
        tilt.to = 1;
        tilt.r = c.getBoundingClientRect();
        c.style.willChange = 'transform';
        tilts.set(c, tilt);
      }
      tilt.tx = clamp((px - tilt.r.left) / tilt.r.width - 0.5);
      tilt.ty = clamp((py - tilt.r.top) / tilt.r.height - 0.5);
    }

    // ---- the main button leans toward the pointer
    const b = t?.closest<HTMLElement>('.btn.primary:not(:disabled)') ?? null;
    if (b !== magnet?.el) leaveMagnet();
    if (b) {
      if (!magnet) {
        const had = magnets.get(b);
        magnet = had ?? { el: b, r: b.getBoundingClientRect(), x: 0, y: 0, tx: 0, ty: 0, live: true };
        magnet.live = true;
        if (had) magnet.r = b.getBoundingClientRect();
        magnets.set(b, magnet);
      }
      magnet.tx = clamp((px - magnet.r.left) / magnet.r.width - 0.5) * 6;
      magnet.ty = clamp((py - magnet.r.top) / magnet.r.height - 0.5) * 5;
    }
    kick();
  };
  const down = () => {
    if (tilt) tilt.press = true;
    leaveMagnet();
    kick();
  };
  const up = () => {
    if (tilt) tilt.press = false;
    kick();
  };
  // sizes measured on entering are stale once the page scrolls or the window changes
  const stale = () => leaveAll();

  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', down, { passive: true });
  document.addEventListener('pointerup', up, { passive: true });
  document.documentElement.addEventListener('pointerleave', leaveAll);
  window.addEventListener('blur', leaveAll);
  window.addEventListener('scroll', stale, { passive: true, capture: true });
  window.addEventListener('resize', stale);
  return () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerdown', down);
    document.removeEventListener('pointerup', up);
    document.documentElement.removeEventListener('pointerleave', leaveAll);
    window.removeEventListener('blur', leaveAll);
    window.removeEventListener('scroll', stale, true);
    window.removeEventListener('resize', stale);
    if (frame) cancelAnimationFrame(frame);
    root.classList.remove('fx');
  };
}

const clamp = (v: number) => Math.min(0.5, Math.max(-0.5, v));
/** 0…1 → 0…1, gentle at both ends: full size under the pointer, fading to the sides */
const ease = (k: number) => k * k * (3 - 2 * k);
