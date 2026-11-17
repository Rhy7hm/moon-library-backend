/*
 * The dashboard comes in, instead of just appearing — once per page load, as soon as the library has loaded.
 * One GSAP master timeline.
 *
 *   after signing in   1  the sign-in's light is still on screen: your logo turns in, "Welcome back" and your name
 *                         rise out of a mask letter by letter, a thin rule draws
 *                      2  the welcome lifts away and the light recedes from the middle, like a hole opening
 *                      3  under it the dashboard builds: the sidebar glides in and its icons tilt into place, the top
 *                         bar follows, the page title sharpens out of a blur, the cards cascade in, the figures count
 *                         up from zero, the usage bar wipes across
 *                      Click or press a key at any time to skip ahead (three times the speed).
 *   any other load    the same dashboard build, shorter and smaller (so a refresh isn't slow)
 *
 * Only transforms, opacity, and (for the sharpening title, the bar and the iris) cheap paint effects; every tween
 * clears its inline styles when done, so nothing is left behind (a leftover transform would break the sticky
 * sidebar). The counters edit the text node React already holds, and are put back to the real numbers
 * however it ends. With "reduce motion" nothing moves.
 */
import { takeSheet } from './arrive';
import { gsap, motionOK } from './motion';

let played = false;

/** Builds the dashboard's parts into `tl`, starting at `at`. k: 1 = full, 0.5 = the short version. */
function dashboard(tl: gsap.core.Timeline, app: HTMLElement, at: number, k: number, full: boolean, counters: { node: Text; text: string }[]) {
  const q = gsap.utils.selector(app);
  const C = 'opacity,transform';
  const d = (n: number) => n * k + 0.2; // durations scale with k
  tl.from(q('.side'), { x: -60 * k, opacity: 0, duration: d(1.1), ease: 'expo.out', clearProps: C }, at + 0.05)
    .from(q('.side .brand-mark'), { rotation: -90 * k, scale: 0.5, duration: d(1), ease: 'back.out(2)', clearProps: C }, at + 0.15)
    .from(q('.side .brand span:last-child'), { x: -12 * k, opacity: 0, duration: d(0.8), ease: 'expo.out', clearProps: C }, at + 0.25)
    .from(q('.side .nav-item, .side .side-label, .side .tree-row'), { x: -22 * k, opacity: 0, stagger: 0.05 * k, duration: d(0.8), ease: 'expo.out', clearProps: C }, at + 0.3 * k)
    // the pictures tilt into place (rotation only: the current page's picture keeps the size it was given)
    .from(q('.side .nav-main .nav-icon'), { rotation: -30 * k, stagger: 0.05 * k, duration: d(1), ease: 'back.out(2.6)' }, at + 0.35 * k)
    .from(q('.topbar'), { y: -30 * k, opacity: 0, duration: d(0.9), ease: 'expo.out', clearProps: C }, at + 0.05)
    .from(q('.topbar .search-pill'), { scaleX: 0.7, opacity: 0, transformOrigin: 'left center', duration: d(1), ease: 'expo.out', clearProps: C }, at + 0.2 * k)
    .from(q('.topbar-right'), { x: 26 * k, opacity: 0, duration: d(0.8), ease: 'expo.out', clearProps: C }, at + 0.4 * k)
    .from(q('.page-head h1'), { y: 28 * k, opacity: 0, filter: full ? 'blur(10px)' : 'blur(0px)', duration: d(1), ease: 'expo.out', clearProps: `${C},filter` }, at + 0.35 * k)
    .from(q('.page-head .muted'), { y: 14 * k, opacity: 0, duration: d(0.8), ease: 'expo.out', clearProps: C }, at + 0.48 * k)
    .from(q('.page-actions'), { x: 20 * k, opacity: 0, duration: d(0.8), ease: 'expo.out', clearProps: C }, at + 0.55 * k)
    // the page's sections settle in; the cards and folder tiles inside them cascade a little later
    .from(q('.page > *:not(.page-head):not(.drop-overlay)'), { y: 26 * k, opacity: 0, stagger: 0.1 * k, duration: d(0.9), ease: 'expo.out', clearProps: C }, at + 0.5 * k)
    .from(q('.page .grid > *, .page .folders > *'), { y: 56 * k, scale: 1 - 0.07 * k, opacity: 0, stagger: { amount: 0.8 * k + 0.1, from: 'start' }, duration: d(1.1), ease: 'expo.out', clearProps: C }, at + 0.85 * k);
  if (!full) return;
  // the figures count up from zero; the usage bar wipes across; its legend follows
  for (const c of counters) {
    const end = Number(c.text.replace(/,/g, ''));
    const o = { v: 0 };
    c.node.nodeValue = '0';
    tl.to(o, { v: end, duration: 1.3, ease: 'power3.out', onUpdate: () => void (c.node.nodeValue = Math.round(o.v).toLocaleString()), onComplete: () => void (c.node.nodeValue = c.text) }, at + 0.8);
  }
  tl.from(q('.ov-bar'), { clipPath: 'inset(0 100% 0 0 round 999px)', duration: 1.2, ease: 'power3.inOut', clearProps: 'clipPath' }, at + 0.95)
    .from(q('.ov-legend li'), { y: 10, opacity: 0, stagger: 0.08, duration: 0.7, ease: 'expo.out', clearProps: C }, at + 1.3)
    .from(q('.ov-sub'), { opacity: 0, y: 6, stagger: 0.08, duration: 0.7, ease: 'expo.out', clearProps: C }, at + 1.1);
}

export function enter(app: HTMLElement, name: string) {
  if (played || !motionOK()) return;
  played = true;
  const sheet = takeSheet();
  const full = !!sheet;
  // things slide in from past the edge of the window: no scrollbars flashing up while they do
  const root = document.documentElement;
  root.classList.add('entering');

  // the figures on the page, to count up (only whole numbers, in the one text node React holds)
  const counters = full
    ? [...app.querySelectorAll<HTMLElement>('.ov-value')]
        .filter((el) => el.childNodes.length === 1 && el.firstChild?.nodeType === 3 && /^[\d,]+$/.test(el.textContent ?? ''))
        .map((el) => ({ node: el.firstChild as Text, text: el.textContent as string }))
    : [];

  let tl: gsap.core.Timeline;
  let timer = 0;
  const skip = () => tl.timeScale(3);
  const finish = () => {
    clearTimeout(timer);
    root.classList.remove('entering');
    for (const c of counters) c.node.nodeValue = c.text;
    sheet?.remove();
    document.removeEventListener('pointerdown', skip);
    document.removeEventListener('keydown', skip);
  };
  tl = gsap.timeline({ onComplete: finish });
  timer = window.setTimeout(finish, (full ? 9 : 4.5) * 1000); // never left on

  if (!sheet) {
    dashboard(tl, app, 0, 0.5, false, counters);
    return;
  }

  // 1. the welcome, on the light
  const nameEl = sheet.querySelector<HTMLElement>('.arrive-name')!;
  nameEl.setAttribute('aria-label', name);
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const w = document.createElement('span');
    w.className = 'arrive-word';
    for (const ch of word) {
      const c = document.createElement('span');
      c.className = 'arrive-char';
      c.textContent = ch;
      w.appendChild(c);
    }
    nameEl.append(w, ' ');
  }
  const wl = sheet.querySelector('.arrive-welcome')!;
  const part = (s: string) => wl.querySelector(s);
  const OPEN = 1.85; // when the light starts to recede
  tl.fromTo(part('.arrive-mark'), { opacity: 0, scale: 0.55, rotation: -40 }, { opacity: 1, scale: 1, rotation: 0, duration: 1, ease: 'back.out(2)' }, 0)
    .fromTo(part('.arrive-eyebrow'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' }, 0.15)
    .fromTo(wl.querySelectorAll('.arrive-char'), { yPercent: 118 }, { yPercent: 0, stagger: 0.04, duration: 1, ease: 'expo.out' }, 0.25)
    .fromTo(part('.arrive-rule'), { opacity: 1, scaleX: 0 }, { scaleX: 1, duration: 1, ease: 'power3.inOut' }, 0.5)
    // 2. the welcome lifts away and the light recedes from the middle
    .to(wl, { y: -30, scale: 1.05, opacity: 0, duration: 0.6, ease: 'power2.in' }, OPEN - 0.15)
    .to(sheet, { '--r': `${Math.ceil(Math.hypot(innerWidth, innerHeight))}px`, duration: 1.55, ease: 'power2.inOut', onComplete: () => sheet.remove() }, OPEN);
  // 3. under it, the dashboard builds
  dashboard(tl, app, OPEN, 1, true, counters);
  document.addEventListener('pointerdown', skip, { passive: true });
  document.addEventListener('keydown', skip);
}
