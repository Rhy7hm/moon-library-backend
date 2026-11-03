/* GSAP set-up, shared easing, and a check for "reduce motion". */
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(Flip, ScrollTrigger, SplitText);
gsap.defaults({ ease: 'power3.out', duration: 0.6 });

// dev only: lets the browser console (and tests) drive the timeline
if (import.meta.env.DEV) (window as unknown as { gsap: typeof gsap }).gsap = gsap;

export const motionOK = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades and lifts cards in as they scroll into view, a few at a time. */
export function revealOnScroll(scope: Element, selector: string) {
  if (!motionOK()) return () => {};
  const els = scope.querySelectorAll(selector);
  gsap.set(els, { autoAlpha: 0, y: 28, scale: 0.98 });
  const triggers = ScrollTrigger.batch(els, {
    start: 'top 92%',
    onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, scale: 1, stagger: 0.06, duration: 0.7, overwrite: true }),
  });
  ScrollTrigger.refresh();
  return () => triggers.forEach((t) => t.kill());
}

export { gsap, Flip, ScrollTrigger, SplitText };
