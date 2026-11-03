import type { ImgFormat } from './settings';

export const MIME: Record<ImgFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};
export const EXT: Record<ImgFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/** Re-codifica una imagen al formato pedido. JPG no admite transparencia: se rellena de blanco. */
export async function encodeImage(src: Blob, format: ImgFormat, quality: number): Promise<Blob> {
  if (format === 'png' && src.type === 'image/png') return src;
  const bmp = await createImageBitmap(src);
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const g = canvas.getContext('2d')!;
    if (format === 'jpeg') {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, bmp.width, bmp.height);
    }
    g.drawImage(bmp, 0, 0);
    return await canvas.convertToBlob({ type: MIME[format], quality });
  } finally {
    bmp.close();
  }
}

/** AAAAMMDD-HHMMSS */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  (document.body ?? document.documentElement).appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
