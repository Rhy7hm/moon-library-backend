/* Small formatting helpers and the file-type groups the library filters by. */
import type { Asset, FileRow } from './api';
import { extOf, mainFile } from './api';
import { isDesignFile } from './derive/derive-design';

export type TypeFilter = 'all' | 'image' | 'video' | 'document' | 'design';

export function typeOf(f: FileRow | undefined): Exclude<TypeFilter, 'all'> | 'other' {
  if (!f) return 'other';
  if (isDesignFile(f.name)) return 'design';
  if (f.kind === 'image') return 'image';
  if (f.kind === 'video') return 'video';
  if (f.kind === 'document') return 'document';
  return 'other';
}

export const matchesType = (a: Asset, t: TypeFilter) => t === 'all' || typeOf(mainFile(a)) === t;

export function fmtSize(n: number) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtDate(ms: number, withTime = false) {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 864e5).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return withTime ? `Today, ${time}` : 'Today';
  if (yesterday) return withTime ? `Yesterday, ${time}` : 'Yesterday';
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  return withTime ? `${date}, ${time}` : date;
}

export function fmtAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(ms);
}

export function fmtDuration(s: number | null) {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

/** Brand colour for a file-type label (PSD blue, PDF red …). */
export function extColor(name: string) {
  const e = extOf(name);
  const map: Record<string, string> = {
    psd: '#31a8ff', psb: '#31a8ff', ai: '#ff9a00', eps: '#ff9a00', indd: '#ff3366', idml: '#ff3366', fig: '#a259ff', xd: '#ff61f6', sketch: '#f7b500',
    pdf: '#e0362c', xlsx: '#1d7f45', xls: '#1d7f45', csv: '#1d7f45', numbers: '#1d7f45', docx: '#2b5bd7', doc: '#2b5bd7', pages: '#2b5bd7',
    pptx: '#d24726', ppt: '#d24726', key: '#d24726', zip: '#6e6e73',
  };
  return map[e] ?? '#6e6e73';
}

export function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name.split(' ')[0]}`;
}
