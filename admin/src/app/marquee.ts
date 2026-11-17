/*
 * Drag-to-select, like Finder and Photos: press on empty space in a file grid or list and drag — a box
 * follows the pointer and every file it touches is selected, live, as you go.
 *
 *   plain drag      the box's files become the selection
 *   Shift + drag    adds them to what was selected
 *   ⌘ / Ctrl + drag flips them (selected ones drop out, others come in)
 *   click on empty space   clears the selection
 *   near the top or bottom edge   the page scrolls on its own, the box keeps growing (and a long folder keeps loading in)
 *   Esc during a drag   puts the selection back the way it was
 *
 * Starting on a file, a folder, a button or a bar does what it always did (click, or drag the file to move it).
 * Mouse and pen only: on a touch screen a drag is for scrolling.
 *
 * How it stays smooth: the files' positions are measured once when the drag starts (and again only if more
 * files appear), the box is one element whose styles are written straight to the DOM, and everything runs in
 * one requestAnimationFrame loop — React is told only when the set of selected files actually changes.
 */
import { useEffect, useRef } from 'react';

/** Where a press does NOT start a box: things that have their own click / drag behaviour. */
const SKIP =
  'a, button, input, select, textarea, label, [role="button"], [contenteditable], .card, .tr, .folder, .menu, .scrim, .tagpop, .tagbar, .sheet, .selbar, .tray, .toasts, .topbar, .side, .spotlight, .drop-overlay, .toolbar, .page-head, .crumbs, .arrive-sheet';
const THRESHOLD = 5; // px of movement before a press becomes a drag
const EDGE = 64; // px from the top / bottom where the page starts to scroll
const MAX_SPEED = 22; // px per frame

type Item = { id: string; l: number; t: number; r: number; b: number };
type Drag = {
  x0: number; // where it started, in page coordinates
  y0: number;
  cx: number; // where the pointer is now, in window coordinates
  cy: number;
  base: Set<string>;
  mode: 'replace' | 'add' | 'toggle';
  started: boolean;
  items: Item[];
  last: Set<string>;
  el: HTMLElement | null;
  raf: number;
};

const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export function useMarquee(sel: Set<string>, setSel: (s: Set<string>) => void, enabled = true) {
  const live = useRef({ sel, setSel });
  live.current = { sel, setSel };

  useEffect(() => {
    if (!enabled) return;
    let d: Drag | null = null;

    const measure = (): Item[] =>
      [...document.querySelectorAll<HTMLElement>('[data-asset]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.asset!, l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY };
      });

    /** Redraws the box and re-selects from it. */
    const update = () => {
      if (!d?.started) return;
      const x1 = d.cx + scrollX;
      const y1 = d.cy + scrollY;
      const left = Math.min(d.x0, x1);
      const top = Math.min(d.y0, y1);
      const right = Math.max(d.x0, x1);
      const bottom = Math.max(d.y0, y1);
      if (d.el) {
        d.el.style.transform = `translate(${left - scrollX}px, ${top - scrollY}px)`;
        d.el.style.width = `${right - left}px`;
        d.el.style.height = `${bottom - top}px`;
      }
      // more files may have appeared (a long folder draws more as it scrolls)
      if (document.querySelectorAll('[data-asset]').length !== d.items.length) d.items = measure();
      const hit = new Set<string>();
      for (const it of d.items) if (it.r > left && it.l < right && it.b > top && it.t < bottom) hit.add(it.id);
      let next: Set<string>;
      if (d.mode === 'replace') next = hit;
      else if (d.mode === 'add') next = new Set([...d.base, ...hit]);
      else {
        next = new Set(d.base);
        for (const id of hit) next.has(id) ? next.delete(id) : next.add(id);
      }
      if (!same(next, d.last)) {
        d.last = next;
        live.current.setSel(next);
        if (d.el) next.size ? d.el.setAttribute('data-n', String(hit.size)) : d.el.removeAttribute('data-n');
      }
    };

    /** The frame loop: scrolls the page when the pointer is near an edge, and keeps the box in step. */
    const loop = () => {
      if (!d?.started) return;
      const top0 = document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0;
      let dy = 0;
      if (d.cy < top0 + EDGE) dy = -Math.min(1, (top0 + EDGE - d.cy) / EDGE) * MAX_SPEED;
      else if (d.cy > innerHeight - EDGE) dy = Math.min(1, (d.cy - (innerHeight - EDGE)) / EDGE) * MAX_SPEED;
      if (dy) {
        const before = scrollY;
        scrollBy(0, dy);
        if (scrollY !== before) update();
      }
      d.raf = requestAnimationFrame(loop);
    };

    const end = (cancel: boolean) => {
      if (!d) return;
      const cur = d;
      d = null;
      cancelAnimationFrame(cur.raf);
      document.body.classList.remove('no-select');
      if (cur.el) {
        // the box fades away rather than vanishing
        const el = cur.el;
        el.style.transition = 'opacity 0.18s ease';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 220);
      }
      if (cancel && cur.started) live.current.setSel(cur.base);
    };

    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch' || d) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest(SKIP) || document.querySelector('.scrim')) return;
      // only in the area to the right of the sidebar
      if (e.clientX < (document.querySelector('.side')?.getBoundingClientRect().right ?? 0)) return;
      document.body.classList.add('no-select'); // set before the browser would begin selecting text
      d = {
        x0: e.clientX + scrollX,
        y0: e.clientY + scrollY,
        cx: e.clientX,
        cy: e.clientY,
        base: e.shiftKey || e.metaKey || e.ctrlKey ? new Set(live.current.sel) : new Set(),
        mode: e.shiftKey ? 'add' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace',
        started: false,
        items: [],
        last: new Set(live.current.sel),
        el: null,
        raf: 0,
      };
    };

    const move = (e: PointerEvent) => {
      if (!d) return;
      d.cx = e.clientX;
      d.cy = e.clientY;
      if (!d.started) {
        if (Math.hypot(e.clientX + scrollX - d.x0, e.clientY + scrollY - d.y0) < THRESHOLD) return;
        d.started = true;
        d.items = measure();
        getSelection()?.removeAllRanges();
        const el = document.createElement('div');
        el.className = 'marquee';
        document.body.appendChild(el);
        d.el = el;
        d.raf = requestAnimationFrame(loop);
      }
      update();
    };

    const up = () => {
      if (!d) return;
      if (d.started) {
        // the click that follows a drag isn't a click on anything
        const stop = (ev: Event) => ev.stopPropagation();
        window.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', stop, true), 0);
      } else if (d.mode === 'replace' && live.current.sel.size) {
        live.current.setSel(new Set()); // a click on empty space clears the selection
      }
      end(false);
    };

    const key = (e: KeyboardEvent) => e.key === 'Escape' && d?.started && end(true);
    const scrolled = () => update();

    document.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', () => end(true));
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scrolled);
      end(true);
    };
  }, [enabled]);
}
