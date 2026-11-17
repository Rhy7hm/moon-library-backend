/*
 * The hand-off after signing in. The sign-in page ends with the moon's light filling the screen; the
 * next page then fades in from that same colour, so there is no cut between them.
 *   client  (stays on this site)   arrive(colour) as the library takes over
 *   staff   (goes on to /admin)    markArrival(colour) before leaving; the admin's own copy of this
 *                                  file (admin/src/app/arrive.ts) picks it up when it loads
 */
import { gsap, motionOK } from './motion';

const KEY = 'moonlib.arrive';

/** Tells the next page (same tab) to fade in from this colour. */
export function markArrival(bg: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ bg, t: Date.now() }));
  } catch {
    /* private mode: the next page just appears */
  }
}

/** A sheet of `bg` over everything, with a soft-edged hole that opens from the middle until it is gone (the page's own entrance plays under it). */
export function arrive(bg: string, delay = 0.25) {
  const el = document.createElement('div');
  const mask = 'radial-gradient(circle at 50% 42%, transparent var(--r), #000 calc(var(--r) + 170px))';
  el.style.cssText = `position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:${bg};--r:-170px;-webkit-mask-image:${mask};mask-image:${mask}`;
  document.body.appendChild(el);
  const done = () => el.remove();
  if (!motionOK()) return void setTimeout(done, 200);
  gsap.to(el, { '--r': `${Math.ceil(Math.hypot(innerWidth, innerHeight))}px`, duration: 1.5, delay, ease: 'power2.inOut', onComplete: done });
  setTimeout(done, (delay + 1.5) * 1000 + 1500); // however it ends, the sheet never stays (a tab opened in the background, say)
}
