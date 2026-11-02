/*
 * The social / ad placement a picture or video is shaped for, from its width and height,
 * so designers and marketers can tell an Instagram post from a Story or a Facebook link ad at a glance.
 */

export type AdFormat = {
  /** short badge, e.g. "4:5" */
  ratio: string;
  /** where it's used, e.g. "Feed portrait" */
  use: string;
  /** longer hint for the tooltip */
  hint: string;
};

const FORMATS: { r: number; ratio: string; use: string; hint: string }[] = [
  { r: 1, ratio: '1:1', use: 'Square', hint: 'Instagram / Facebook feed, carousel, square ads' },
  { r: 4 / 5, ratio: '4:5', use: 'Feed portrait', hint: 'Instagram / Facebook feed portrait (recommended for feed ads)' },
  { r: 9 / 16, ratio: '9:16', use: 'Story / Reel', hint: 'Instagram & Facebook Stories, Reels, TikTok, YouTube Shorts' },
  { r: 1.91, ratio: '1.91:1', use: 'Link ad', hint: 'Facebook link / landscape ads, Open Graph images' },
  { r: 16 / 9, ratio: '16:9', use: 'Landscape', hint: 'YouTube, landscape video, presentations' },
  { r: 2 / 3, ratio: '2:3', use: 'Pin / poster', hint: 'Pinterest pins, posters' },
  { r: 3 / 4, ratio: '3:4', use: 'Portrait', hint: 'Instagram grid portrait (3:4), RedNote' },
  { r: 4 / 3, ratio: '4:3', use: 'Classic', hint: 'Classic landscape' },
  { r: 820 / 312, ratio: 'Cover', use: 'Page cover', hint: 'Facebook page cover (820 × 312)' },
];

/** null when the size is unknown or doesn't match a common format (within 2%). */
export function adFormat(w?: number | null, h?: number | null): AdFormat | null {
  if (!w || !h) return null;
  const r = w / h;
  let best: (typeof FORMATS)[number] | null = null;
  let err = Infinity;
  for (const f of FORMATS) {
    const e = Math.abs(r - f.r) / f.r;
    if (e < err) {
      err = e;
      best = f;
    }
  }
  if (!best || err > 0.02) return null;
  return { ratio: best.ratio, use: best.use, hint: `${best.hint} · ${w} × ${h}` };
}
