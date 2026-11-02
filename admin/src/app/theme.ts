/*
 * Appearance, chosen in Settings → Appearance and stored per browser:
 *   theme   "system" follows the computer; light, dark and 3d override it → <html data-theme="…">
 *           (3d has its own fixed colours and 3D icons in the sidebar; the accent doesn't apply)
 *   accent  the highlight colour (selection, links, focus)                → <html data-accent="…">
 * app.css reads both attributes.
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark' | '3d';
export type Accent = 'blue' | 'purple' | 'pink' | 'orange' | 'green' | 'graphite';

export const ACCENTS: { value: Accent; label: string; light: string; dark: string }[] = [
  { value: 'blue', label: 'Blue', light: '#0071e3', dark: '#0a84ff' },
  { value: 'purple', label: 'Purple', light: '#8e44ad', dark: '#bf5af2' },
  { value: 'pink', label: 'Pink', light: '#e0245e', dark: '#ff375f' },
  { value: 'orange', label: 'Orange', light: '#d96d00', dark: '#ff9f0a' },
  { value: 'green', label: 'Green', light: '#1f8a3c', dark: '#30d158' },
  { value: 'graphite', label: 'Graphite', light: '#636366', dark: '#98989d' },
];

const THEME_KEY = 'moonlib.theme';
const ACCENT_KEY = 'moonlib.accent';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* private mode: still applies for this visit */
  }
}

export function savedTheme(): Theme {
  const v = read(THEME_KEY);
  return v === 'light' || v === 'dark' || v === '3d' ? v : 'system';
}
export function savedAccent(): Accent {
  const v = read(ACCENT_KEY);
  return ACCENTS.some((a) => a.value === v) ? (v as Accent) : 'blue';
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  // the browser's own bits (scrollbars, form controls, the address bar on phones) follow too
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#111113' : t === '3d' ? '#f3f1ee' : '#f2f2f4'));
}
export function applyAccent(a: Accent) {
  const root = document.documentElement;
  if (a === 'blue') delete root.dataset.accent;
  else root.dataset.accent = a;
}

/* one shared copy, so every screen that shows the choice agrees */
let current = { theme: savedTheme(), accent: savedAccent() };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));
const set = (next: Partial<typeof current>) => {
  current = { ...current, ...next };
  listeners.forEach((fn) => fn());
};

/** Applies the saved appearance before the first paint, and follows the computer in Automatic (called from main.tsx). */
export function applySaved() {
  applyTheme(current.theme);
  applyAccent(current.accent);
  // e.g. the Mac switches to dark at sunset
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => current.theme === 'system' && applyTheme('system'));
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => current.theme);
  return [
    theme,
    (t) => {
      write(THEME_KEY, t === 'system' ? null : t);
      applyTheme(t);
      set({ theme: t });
    },
  ];
}

export function useAccent(): [Accent, (a: Accent) => void] {
  const accent = useSyncExternalStore(subscribe, () => current.accent);
  return [
    accent,
    (a) => {
      write(ACCENT_KEY, a === 'blue' ? null : a);
      applyAccent(a);
      set({ accent: a });
    },
  ];
}
