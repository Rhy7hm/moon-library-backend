/*
 * Search that understands what people type. One query can mix plain words and filters:
 *
 *   poster acme              words: in the name, file names, folder path, tags, uploader, or a client it's shared with
 *   images · videos · docs · design · pdf · psd …   a kind of file, or an extension
 *   #approved · #"CNY 2027" · tag:approved          a tag
 *   client:acme              shared with that client (directly or through a folder)
 *   today · yesterday · this week · last week · this month · last month · this year
 *   october · oct 2026 · after:2026-10-01 · before:2026-11-01
 *
 * Everything has to match (AND). Used by Spotlight and the search page; the page also edits the query
 * through its filter menus, so the query text is always the one source of truth.
 */
import { mainFile, nameOf, titleOf, type Asset, type Client, type Folder, type Tag } from './api';
import { typeOf } from './format';

export type Kind = 'image' | 'video' | 'document' | 'design' | 'other';
export type DateRange = { from: number; to: number; label: string };
export type Token = { text: string; type: 'word' | 'kind' | 'ext' | 'tag' | 'client' | 'date' };
export type Parsed = { tokens: Token[]; words: string[]; kinds: Kind[]; exts: string[]; tags: string[]; clients: string[]; date: DateRange | null };

const KIND_WORDS: Record<string, Kind> = {
  image: 'image', images: 'image', photo: 'image', photos: 'image', picture: 'image', pictures: 'image', pic: 'image', pics: 'image',
  video: 'video', videos: 'video', clip: 'video', clips: 'video',
  doc: 'document', docs: 'document', document: 'document', documents: 'document',
  design: 'design', designs: 'design',
};
const EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'tif', 'tiff', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'psd', 'ai', 'indd', 'fig', 'sketch', 'xd', 'eps', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'zip']);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export const KIND_LABEL: Record<Kind, string> = { image: 'Images', video: 'Videos', document: 'Documents', design: 'Design files', other: 'Other' };
export const KIND_QUERY: Record<Exclude<Kind, 'other'>, string> = { image: 'images', video: 'videos', document: 'docs', design: 'design' };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 864e5;

/** Date words → a range. Weeks start on Monday. */
function dateRange(phrase: string, now = new Date()): DateRange | null {
  const today = startOfDay(now);
  const dow = (now.getDay() + 6) % 7;
  const m = now.getMonth();
  const y = now.getFullYear();
  switch (phrase) {
    case 'today': return { from: today, to: today + DAY, label: 'Today' };
    case 'yesterday': return { from: today - DAY, to: today, label: 'Yesterday' };
    case 'this week': return { from: today - dow * DAY, to: today + DAY, label: 'This week' };
    case 'last week': return { from: today - (dow + 7) * DAY, to: today - dow * DAY, label: 'Last week' };
    case 'this month': return { from: new Date(y, m, 1).getTime(), to: today + DAY, label: 'This month' };
    case 'last month': return { from: new Date(y, m - 1, 1).getTime(), to: new Date(y, m, 1).getTime(), label: 'Last month' };
    case 'this year': return { from: new Date(y, 0, 1).getTime(), to: today + DAY, label: 'This year' };
  }
  return null;
}

/** Splits into tokens, keeping "quoted phrases" and #"quoted tags" together. */
function split(q: string): string[] {
  const out: string[] = [];
  const re = /(\w+:|#)?"([^"]*)"?|(\S+)/g;
  for (let m; (m = re.exec(q)); ) out.push(m[2] !== undefined ? `${m[1] ?? ''}"${m[2]}"` : m[3]);
  return out;
}
const unquote = (s: string) => s.replace(/^"|"$/g, '');

export function parse(q: string, now = new Date()): Parsed {
  const p: Parsed = { tokens: [], words: [], kinds: [], exts: [], tags: [], clients: [], date: null };
  let text = ` ${q} `;
  // multi-word date phrases first
  const phrase = /\b(today|yesterday|this week|last week|this month|last month|this year)\b/i.exec(text);
  if (phrase) {
    p.date = dateRange(phrase[1].toLowerCase(), now);
    p.tokens.push({ text: phrase[1], type: 'date' });
    text = text.replace(phrase[0], ' ');
  }
  // a month, optionally with a year: "october", "oct 2026"
  // full month names, or a short one with a year ("oct 2026") — so words like "decor" aren't months
  const month = /\b(january|february|march|april|may|june|july|august|september|october|november|december|(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?=\s+20\d\d))(?:\s+(20\d\d))?\b/i.exec(text);
  if (month && !p.date) {
    const mi = MONTHS.indexOf(month[1].slice(0, 3).toLowerCase());
    const yr = month[2] ? Number(month[2]) : now.getMonth() >= mi ? now.getFullYear() : now.getFullYear() - 1;
    const label = new Date(yr, mi, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    p.date = { from: new Date(yr, mi, 1).getTime(), to: new Date(yr, mi + 1, 1).getTime(), label };
    p.tokens.push({ text: month[0], type: 'date' });
    text = text.replace(month[0], ' ');
  }
  for (const raw of split(text)) {
    const low = raw.toLowerCase();
    let m: RegExpMatchArray | null;
    if ((m = /^#(.+)$/.exec(raw)) || (m = /^tag:(.+)$/i.exec(raw))) {
      p.tags.push(unquote(m[1]).toLowerCase());
      p.tokens.push({ text: raw, type: 'tag' });
    } else if ((m = /^client:(.+)$/i.exec(raw))) {
      p.clients.push(unquote(m[1]).toLowerCase());
      p.tokens.push({ text: raw, type: 'client' });
    } else if ((m = /^(after|before):(\d{4}-\d{2}-\d{2})$/i.exec(raw))) {
      const t = new Date(m[2] + 'T00:00:00').getTime();
      const cur = p.date ?? { from: 0, to: Infinity, label: '' };
      p.date = m[1].toLowerCase() === 'after' ? { ...cur, from: t, label: `${cur.label ? cur.label + ' · ' : ''}after ${m[2]}` } : { ...cur, to: t, label: `${cur.label ? cur.label + ' · ' : ''}before ${m[2]}` };
      p.tokens.push({ text: raw, type: 'date' });
    } else if ((m = /^type:(.+)$/i.exec(raw)) && KIND_WORDS[m[1].toLowerCase()]) {
      p.kinds.push(KIND_WORDS[m[1].toLowerCase()]);
      p.tokens.push({ text: raw, type: 'kind' });
    } else if (KIND_WORDS[low]) {
      p.kinds.push(KIND_WORDS[low]);
      p.tokens.push({ text: raw, type: 'kind' });
    } else if (EXTS.has(low.replace(/^\./, '')) || (m = /^ext:(\w+)$/i.exec(raw))) {
      p.exts.push(m ? m[1].toLowerCase() : low.replace(/^\./, ''));
      p.tokens.push({ text: raw, type: 'ext' });
    } else {
      p.words.push(unquote(low));
      p.tokens.push({ text: raw, type: 'word' });
    }
  }
  return p;
}

export const isEmpty = (p: Parsed) => !p.tokens.length;

export type Ctx = {
  path: (id: string | null) => Folder[];
  tagById: Map<string, Tag>;
  clients: Client[];
  sharedWith: (kind: 'folder' | 'item', id: string) => Client[];
};

/** Does this file match everything in the query? */
export function matches(a: Asset, p: Parsed, c: Ctx): boolean {
  if (p.date && (a.date < p.date.from || a.date >= p.date.to)) return false;
  const f = mainFile(a);
  if (p.kinds.length && !p.kinds.includes(typeOf(f) as Kind)) return false;
  if (p.exts.length) {
    const exts = a.variants.map((v) => v.name.split('.').pop()?.toLowerCase() ?? '');
    if (!p.exts.some((e) => exts.includes(e) || (e === 'jpg' && exts.includes('jpeg')))) return false;
  }
  const tagNames = (a.tags ?? []).map((id) => c.tagById.get(id)?.name.toLowerCase() ?? '');
  if (p.tags.length && !p.tags.every((t) => tagNames.some((n) => n === t || n.includes(t)))) return false;
  const clients = p.clients.length || p.words.length ? c.sharedWith('item', a.id) : [];
  if (p.clients.length && !p.clients.every((q) => clients.some((cl) => cl.name.toLowerCase().includes(q)))) return false;
  if (!p.words.length) return true;
  const hay = [titleOf(a), ...a.variants.map((v) => v.name), ...c.path(a.folderId).map(nameOf), ...tagNames, a.createdBy ?? '', ...clients.map((cl) => cl.name)]
    .join('  ')
    .toLowerCase();
  return p.words.every((w) => hay.includes(w));
}

/** The query with one token taken out, or one kind of filter replaced (for the page's menus and chips). */
export function without(q: string, token: Token): string {
  return q.replace(token.text, ' ').replace(/\s+/g, ' ').trim();
}
export function withFilter(q: string, type: Token['type'], value: string | null): string {
  const p = parse(q);
  let out = q;
  for (const t of p.tokens) if (t.type === type || (type === 'kind' && t.type === 'ext')) out = without(out, t);
  return value ? `${out} ${value}`.trim() : out;
}
