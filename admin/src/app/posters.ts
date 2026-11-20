/*
 * Previews for videos that don't have one (their upload couldn't make a still): made in the browser from the
 * stored video, one at a time, and saved for everyone. Only the start of each video is read, not the whole file.
 */
import { fileUrl, mainFile, op, type Asset } from './api';
import { deriveVideo } from './derive/derive';
import { putBlob } from '../lib/upload-client';

/** Ready videos whose main file has no still yet. */
export const missingStill = (assets: Asset[]) =>
  assets.filter((a) => {
    const f = mainFile(a);
    return !!f && f.kind === 'video' && f.status === 'ready' && !f.poster && !f.thumb;
  });

/** Makes the missing stills; reports progress; returns how many were made and how many this browser couldn't read. */
export async function makeStills(assets: Asset[], onStep: (done: number, of: number) => void) {
  let made = 0;
  let failed = 0;
  for (const [i, a] of assets.entries()) {
    const f = mainFile(a)!;
    try {
      const d = await deriveVideo(fileUrl(f.orig));
      if (!d.poster) throw new Error('no frame');
      const { key } = await op<{ key: string }>('file.setposter', { id: f.id, width: d.width, height: d.height, duration: d.duration });
      await putBlob({ base: '' }, key, d.poster, { contentType: 'image/webp' });
      made++;
    } catch {
      failed++;
    }
    onStep(i + 1, assets.length);
  }
  return { made, failed };
}
