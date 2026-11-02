import type { FileLang, I18nText } from './langs';

export type FileKind = 'image' | 'video' | 'audio' | 'document' | 'other';

/** One language version of an item. Keys are R2 object keys. */
export type Variant = {
  id: string;
  /** main language */
  lang: FileLang;
  /** every language in this file, main one first — only set when there's more than one */
  langs?: FileLang[];
  kind: FileKind;
  name: string;
  mime: string;
  size: number;
  w: number | null;
  h: number | null;
  dur: number | null;
  orig: string;
  opt: string | null;
  optMime: string | null;
  optSize: number | null;
  thumb: string | null;
  poster: string | null;
  caption: string | null;
  /** Vertical focus for cropped thumbnails, 0 top … 1 bottom (null = top). */
  focusY: number | null;
  /** admin only */
  status?: 'uploading' | 'ready';
};

/** One card on the page. */
export type Item = {
  id: string;
  folderId: string;
  title: I18nText;
  pinned: boolean;
  /** Upload date, ms since epoch. */
  date: number;
  /** position set in /admin (null = not placed: shown first, newest first) */
  sort?: number | null;
  variants: Variant[];
  /** admin only */
  deletedAt?: number | null;
  createdBy?: string | null;
  /** admin only: 'draft' = hidden from the library until published */
  status?: 'live' | 'draft';
  /** admin only: shown on the library from / hidden after (ms; null = no limit) */
  publishAt?: number | null;
  hideAt?: number | null;
};

export type Folder = {
  id: string;
  parentId: string | null;
  slug: string;
  name: I18nText;
  sort: number;
  coverItemId: string | null;
  /** Icon name for the folder card (null = picked from the folder's link name). */
  icon: string | null;
  /** badge background colour (#rrggbb); null = the category colour */
  iconBg?: string | null;
  /** SVG / line icon colour (#rrggbb); null = white */
  iconFg?: string | null;
  /** admin only: hidden from the library page (the folder, everything in it and its sub-folders); files stay in admin */
  hidden?: boolean;
  /** admin only */
  deletedAt?: number | null;
  createdAt?: number;
};

export type LibraryData = {
  folders: Folder[];
  items: Item[];
  /** Public base URL for files; empty = served by this backend at /f/. */
  assetBase: string;
  generatedAt: number;
};
