import { browser } from 'wxt/browser';

export type ImgFormat = 'png' | 'jpeg' | 'webp';
export type Settings = {
  format: ImgFormat; // formato al guardar/descargar (el portapapeles siempre es PNG)
  quality: number; // 0.4–1, solo JPG/WebP
  historyMax: number; // cuántas capturas conserva el historial
  fullMethod: 'scroll' | 'debugger'; // página completa: desplazar y unir (por defecto) o una sola captura con el depurador
};

export const DEFAULT_SETTINGS: Settings = { format: 'png', quality: 0.92, historyMax: 50, fullMethod: 'scroll' };
const KEY = 'settings';

function sanitize(raw: Partial<Settings> | undefined): Settings {
  const d = DEFAULT_SETTINGS;
  const format = raw?.format === 'jpeg' || raw?.format === 'webp' || raw?.format === 'png' ? raw.format : d.format;
  const q = Number(raw?.quality);
  const m = Number(raw?.historyMax);
  return {
    format,
    quality: Number.isFinite(q) ? Math.min(1, Math.max(0.4, q)) : d.quality,
    historyMax: Number.isFinite(m) ? Math.min(500, Math.max(1, Math.round(m))) : d.historyMax,
    fullMethod: raw?.fullMethod === 'debugger' ? 'debugger' : 'scroll',
  };
}

export async function getSettings(): Promise<Settings> {
  try {
    const s = await browser.storage.local.get(KEY);
    return sanitize(s[KEY] as Partial<Settings> | undefined);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings();
  await browser.storage.local.set({ [KEY]: sanitize({ ...cur, ...patch }) });
}
