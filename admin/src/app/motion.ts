/*
 * GSAP, set up once for the whole admin. Import from here (not from 'gsap' directly) so every
 * animation respects "reduce motion" and shares the same feel.
 *
 *   import { gsap, motionOK, pop } from './motion';
 */
import { gsap } from 'gsap';

export { gsap };

/** false when the person asked their computer for less motion; animations then jump straight to the end. */
export const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

// the springy Apple-like curve used across the app
gsap.defaults({ ease: 'power3.out', duration: 0.45 });

/** A quick squash-and-pop, e.g. when something is pressed. */
export function pop(el: Element | null, to = 1) {
  if (!el) return;
  gsap.killTweensOf(el, 'scale'); // a new press always wins over one still playing
  if (!motionOK()) return void gsap.set(el, { scale: to });
  gsap
    .timeline()
    .to(el, { scale: to * 0.82, duration: 0.09, ease: 'power2.in' })
    .to(el, { scale: to, duration: 0.55, ease: 'elastic.out(1.1, 0.45)' });
}

/** Smoothly settles an element at a scale (e.g. bigger while selected). */
export function settle(el: Element | null, scale: number) {
  if (!el) return;
  // stop anything still playing on it first (e.g. the end of a pop), so it can't finish afterwards at the wrong size
  gsap.killTweensOf(el, 'scale');
  if (!motionOK()) return void gsap.set(el, { scale });
  gsap.to(el, { scale, duration: 0.5, ease: 'back.out(2.4)' });
}
