/*
 * The hand-off after signing in (the sign-in page is part of the client site, client/src/arrive.ts).
 * It ends with the moon's light filling the screen and leaves a note for this page. Here that light is
 * put back up at once (a "sheet", with a welcome on it), and enter.ts takes it over: the welcome plays,
 * the light recedes from the middle like a hole opening, and the dashboard builds itself underneath.
 * Call consumeArrival() once, before the first render.
 */
import { motionOK } from './motion';

const KEY = 'moonlib.arrive';
let sheet: HTMLElement | null = null;
let fallback = 0;

const brandMark = `${import.meta.env.BASE_URL}brand-mark.png`;

/** The light sheet left by the sign-in page (null on any other load). enter.ts takes it over and removes it. */
export function takeSheet(): HTMLElement | null {
  const s = sheet;
  sheet = null;
  clearTimeout(fallback);
  return s;
}

function makeSheet(bg: string) {
  const el = document.createElement('div');
  el.className = 'arrive-sheet';
  const mask = 'radial-gradient(circle at 50% 42%, transparent var(--r), #000 calc(var(--r) + 170px))';
  el.style.cssText = `background:${bg};--r:-170px;-webkit-mask-image:${mask};mask-image:${mask}`;
  el.innerHTML = `<div class="arrive-welcome" aria-hidden="true"><img class="arrive-mark" src="${brandMark}" alt="" width="54" height="54" draggable="false"><span class="arrive-eyebrow">Welcome back</span><span class="arrive-name"></span><i class="arrive-rule"></i></div>`;
  document.body.appendChild(el);
  sheet = el;
  // however it ends, the sheet never stays (a library that fails to load, a tab opened in the background)
  fallback = window.setTimeout(() => el.remove(), 9000);
}

/** If the sign-in page just sent us here, put its light back up (only for a few seconds after). */
export function consumeArrival() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return;
    sessionStorage.removeItem(KEY);
    const { bg, t } = JSON.parse(raw) as { bg: string; t: number };
    if (typeof bg === 'string' && Date.now() - t < 20000 && motionOK()) makeSheet(bg);
  } catch {
    /* nothing to do */
  }
}
