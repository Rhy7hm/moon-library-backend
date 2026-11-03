/** Square-crop a photo and encode it as WEBP (or JPEG) base64 for avatar upload. */
export async function encodeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or WEBP)');
  if (file.size > 12_000_000) throw new Error('Photo is too large (max about 12 MB)');
  const bmp = await createImageBitmap(file);
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    throw new Error('Could not process that photo');
  }
  const scale = Math.max(size / bmp.width, size / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
  bmp.close();
  const blob =
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.88))) ??
    (await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9)));
  if (!blob) throw new Error('Could not process that photo');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}
