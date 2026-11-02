/*
 * Languages — the shareholder page's five, plus Bengali, Vietnamese and Thai.
 * `short` is the pill (EN, BM, 简体, 繁体…), `native` the language's own name,
 * `name` what the language pickers show — "English (EN)", "中文 (简体)" —
 * and `locale` drives date and number formatting.
 */
const L = <C extends string>(code: C, short: string, native: string, locale: string) => ({ code, short, native, name: `${native} (${short})`, locale });
export const LANGS = [
  L('en', 'EN', 'English', 'en-GB'),
  L('ms', 'BM', 'Bahasa Melayu', 'ms-MY'),
  L('zh', '简体', '中文', 'zh-CN'),
  L('yue', '繁体', '中文', 'zh-HK'),
  L('ta', 'TA', 'தமிழ்', 'ta-MY'),
  L('bn', 'BN', 'বাংলা', 'bn-BD-u-nu-latn'),
  L('vi', 'VI', 'Tiếng Việt', 'vi-VN'),
  L('th', 'TH', 'ไทย', 'th-TH'),
] as const;

export type Lang = (typeof LANGS)[number]['code'];
/** A file's language. `all` = the graphic has no language-specific text. */
export type FileLang = Lang | 'all';

export const LANG_CODES = LANGS.map((l) => l.code) as Lang[];
export const DEFAULT_LANG: Lang = 'en';
export const FILE_LANGS: FileLang[] = [...LANG_CODES, 'all'];

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANG_CODES as string[]).includes(v);
}
export function isFileLang(v: unknown): v is FileLang {
  return v === 'all' || isLang(v);
}

export function langInfo(code: Lang) {
  return LANGS.find((l) => l.code === code)!;
}

/** The language pills (EN / BM / 简体 / 繁体 / TA / BN / VI / TH). */
export const FILE_LANG_LABEL = Object.fromEntries([...LANGS.map((l) => [l.code, l.short]), ['all', '']]) as Record<FileLang, string>;

/**
 * Which file version to show first for each interface language.
 * Cantonese readers can read the Simplified graphic; Tamil readers get
 * English when there is no Tamil version.
 */
export const VARIANT_PREFERENCE: Record<Lang, FileLang[]> = {
  en: ['en', 'all', 'ms', 'zh', 'yue', 'ta', 'bn', 'vi', 'th'],
  ms: ['ms', 'all', 'en', 'zh', 'yue', 'ta', 'bn', 'vi', 'th'],
  zh: ['zh', 'all', 'yue', 'en', 'ms', 'ta', 'bn', 'vi', 'th'],
  yue: ['yue', 'all', 'zh', 'en', 'ms', 'ta', 'bn', 'vi', 'th'],
  ta: ['ta', 'all', 'en', 'ms', 'zh', 'yue', 'bn', 'vi', 'th'],
  // Bengali, Vietnamese and Thai readers get English when there is no version in their language
  bn: ['bn', 'all', 'en', 'ms', 'zh', 'yue', 'ta', 'vi', 'th'],
  vi: ['vi', 'all', 'en', 'ms', 'zh', 'yue', 'ta', 'bn', 'th'],
  th: ['th', 'all', 'en', 'ms', 'zh', 'yue', 'ta', 'bn', 'vi'],
};

/** Translatable text: one string per language, any of which may be missing. */
export type I18nText = Partial<Record<Lang, string>>;

/** Fallback order when a folder name or title is missing in a language. */
const TEXT_FALLBACK: Record<Lang, Lang[]> = {
  en: ['en', 'ms', 'zh', 'yue', 'ta', 'bn', 'vi', 'th'],
  ms: ['ms', 'en', 'zh', 'yue', 'ta', 'bn', 'vi', 'th'],
  zh: ['zh', 'yue', 'en', 'ms', 'ta', 'bn', 'vi', 'th'],
  yue: ['yue', 'zh', 'en', 'ms', 'ta', 'bn', 'vi', 'th'],
  ta: ['ta', 'en', 'ms', 'zh', 'yue', 'bn', 'vi', 'th'],
  bn: ['bn', 'en', 'ms', 'zh', 'yue', 'ta', 'vi', 'th'],
  vi: ['vi', 'en', 'ms', 'zh', 'yue', 'ta', 'bn', 'th'],
  th: ['th', 'en', 'ms', 'zh', 'yue', 'ta', 'bn', 'vi'],
};

export function pickText(t: I18nText | undefined | null, lang: Lang): string {
  if (!t) return '';
  for (const l of TEXT_FALLBACK[lang]) {
    const v = t[l];
    if (v && v.trim()) return v;
  }
  return '';
}

/* ---------- files in several languages ---------- */
type Versioned = { lang: FileLang; langs?: FileLang[] };
/** Every language a file version is in — the main one first (one graphic can have EN and 中文 text). */
export const versionLangs = (v: Versioned): FileLang[] => (v.langs?.length ? v.langs : [v.lang]);
export const versionCovers = (v: Versioned, l: FileLang) => versionLangs(v).includes(l);
/**
 * Two versions are "the same version" only when they're in exactly the same languages
 * (EN + 中文 = 中文 + EN). Overlaps are fine: "EN + 中文" and "BM + 中文" are two versions of one card.
 */
export const sameLangs = (a: FileLang[], b: FileLang[]) => a.length === b.length && a.every((l) => b.includes(l));
/** "EN", or "EN · 中文" for a file in two languages ('' for no language). */
export const versionLabel = (v: Versioned) =>
  versionLangs(v)
    .filter((l) => l !== 'all')
    .map((l) => FILE_LANG_LABEL[l])
    .join(' · ');
/** The languages' own names beside the pill, e.g. "English · 中文". */
export const versionNames = (v: Versioned) =>
  versionLangs(v)
    .filter((l): l is Lang => l !== 'all')
    .map((l) => langInfo(l).native)
    .join(' · ');
/** Tidies a list of languages: known codes only, no repeats, 'all' only on its own. */
export function cleanLangs(v: unknown): FileLang[] {
  const list = (Array.isArray(v) ? v : []).filter(isFileLang);
  const out = [...new Set(list)];
  return out.includes('all') ? ['all'] : out;
}

/* ---------- the visitor's language on a first visit ---------- */

/** Where the language someone picked is kept, so the server can open the page in it straight away. */
export const LANG_COOKIE = 'm2lang';

/**
 * One phone / browser language code → one of ours, or null when we don't have it.
 * Handles every spelling browsers and in-app browsers use: zh-CN, zh-Hans-MY, zh_TW, ZH-hk, ms-MY, en-US…
 * Chinese: Taiwan / Hong Kong / Macau / "Hant" → 繁体, every other Chinese → 简体. Indonesian is not Malay → null.
 */
export function langFromTag(tag: string): Lang | null {
  const t = tag.trim().toLowerCase().replace(/_/g, '-');
  const parts = t.split('-');
  const base = parts[0];
  if (base === 'zh') return parts.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo') ? 'yue' : 'zh';
  if (base === 'yue') return 'yue';
  if (base === 'en' || base === 'ms' || base === 'ta' || base === 'bn' || base === 'vi' || base === 'th') return base;
  return null;
}

/** The device's languages, most preferred first → the first one we have (English-first phones stay English). */
export function langFromTags(tags: readonly string[]): Lang | null {
  for (const t of tags) {
    const l = langFromTag(t);
    if (l) return l;
  }
  return null;
}

/** The Accept-Language header every browser sends ("en-MY,en;q=0.9,zh-CN;q=0.8") → one of ours, or null. */
export function langFromAcceptLanguage(header: string | null | undefined): Lang | null {
  if (!header) return null;
  const tags = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
      return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((x) => x.tag && x.tag !== '*' && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((x) => x.tag);
  return langFromTags(tags);
}
