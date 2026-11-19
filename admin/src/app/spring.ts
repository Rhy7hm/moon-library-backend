/*
 * Spring-loaded places, like Finder: while you drag files or folders, rest on a place for a moment and it opens,
 * so you can carry what you're dragging to where it needs to go and drop it there.
 *
 * Anything that can open this way carries data-spring:
 *   "folder:<id>"  a folder (tile, sidebar row, path crumb)      "folder:"  the Library itself
 *   "clients"      the Clients page                              "client:<id>"  one client's page
 *
 * One listener for the whole admin: it only reacts while one of our own drags is under way (body.is-moving), never
 * to files dragged in from the computer. The place blinks while it's about to open, like on a Mac.
 */
import type { Route } from './store';

const DELAY = 750; // ms of resting on a place before it opens

export function routeOf(spring: string): Route | null {
  if (spring === 'clients') return { page: 'clients' };
  if (spring.startsWith('client:')) return { page: 'client', id: spring.slice(7) };
  if (spring.startsWith('folder:')) return { page: 'folder', id: spring.slice(7) || null };
  return null;
}

const keyOf = (r: Route) =>
  r.page === 'folder' ? `folder:${r.id ?? ''}` : r.page === 'client' ? `client:${r.id}` : r.page === 'clients' ? 'clients' : r.page;

/** Starts listening; returns a function that stops. */
export function startSpring(go: (r: Route) => void, current: () => Route) {
  let el: HTMLElement | null = null;
  let timer = 0;

  const clear = () => {
    window.clearTimeout(timer);
    if (el) delete el.dataset.springing;
    el = null;
  };
  const moving = () => document.body.classList.contains('is-moving');
  const stopMoving = () => {
    clear();
    document.body.classList.remove('is-moving');
  };

  const over = (e: DragEvent) => {
    if (!moving()) return;
    const t = e.target instanceof Element ? (e.target.closest('[data-spring]') as HTMLElement | null) : null;
    if (t === el) return;
    clear();
    if (!t) return;
    const r = routeOf(t.dataset.spring ?? '');
    if (!r || keyOf(r) === keyOf(current())) return; // already there
    el = t;
    void t.offsetWidth; // restart the blink if it was just removed
    // a data attribute, not a class: React rewrites className when a drop target lights up, which would wipe it
    t.dataset.springing = '';
    timer = window.setTimeout(() => {
      const target = el;
      clear();
      if (target && moving()) go(r);
    }, DELAY);
  };
  // leaving the window, or letting go
  const leave = (e: DragEvent) => {
    if (!e.relatedTarget) clear();
  };
  // After a place opens, the card you started dragging is gone from the page, so its own "drag ended" never
  // arrives: the drop, or the first mouse move once the drag is over, tidies up instead.
  const after = (e: MouseEvent) => moving() && e.buttons === 0 && stopMoving();

  document.addEventListener('dragover', over, true);
  document.addEventListener('dragleave', leave, true);
  document.addEventListener('drop', stopMoving, true);
  document.addEventListener('dragend', stopMoving, true);
  window.addEventListener('mousemove', after, true);
  return () => {
    clear();
    document.removeEventListener('dragover', over, true);
    document.removeEventListener('dragleave', leave, true);
    document.removeEventListener('drop', stopMoving, true);
    document.removeEventListener('dragend', stopMoving, true);
    window.removeEventListener('mousemove', after, true);
  };
}
