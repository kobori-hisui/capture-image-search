import { clearCaptures, deleteCapture, listCaptures, pruneCaptures, type Capture } from '../../utils/history';
import { EXT, downloadBlob, encodeImage, stamp } from '../../utils/image';
import { getSettings, setSettings, type ImgFormat } from '../../utils/settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let urls: string[] = [];

/** Enlaza los controles (formato, calidad, límite, borrar todo). Se llama una sola vez. */
export async function initHistory() {
  const s = await getSettings();
  const fmt = $<HTMLSelectElement>('fmt');
  const q = $<HTMLInputElement>('q');
  const qv = $('qv');
  const max = $<HTMLSelectElement>('max');
  const clear = $<HTMLButtonElement>('clear');

  const method = $<HTMLSelectElement>('method');
  method.value = s.fullMethod;
  method.addEventListener('change', () => setSettings({ fullMethod: method.value as 'scroll' | 'debugger' }));
  fmt.value = s.format;
  q.value = String(Math.round(s.quality * 100));
  max.value = String(s.historyMax);

  const sync = () => {
    $('qWrap').hidden = fmt.value === 'png'; // PNG no tiene calidad
    qv.textContent = `${q.value}%`;
  };
  sync();

  fmt.addEventListener('change', async () => {
    sync();
    await setSettings({ format: fmt.value as ImgFormat });
  });
  q.addEventListener('input', sync);
  q.addEventListener('change', () => setSettings({ quality: Number(q.value) / 100 }));
  max.addEventListener('change', async () => {
    const n = Number(max.value);
    await setSettings({ historyMax: n });
    await pruneCaptures(n);
    await renderHistory();
  });

  // Doble clic de confirmación (sin diálogos nativos)
  let armed: number | undefined;
  clear.addEventListener('click', async () => {
    if (armed === undefined) {
      clear.textContent = '¿Seguro?';
      armed = window.setTimeout(() => {
        clear.textContent = 'Borrar todo';
        armed = undefined;
      }, 2500);
      return;
    }
    clearTimeout(armed);
    armed = undefined;
    clear.textContent = 'Borrar todo';
    await clearCaptures();
    await renderHistory();
  });
}

export async function renderHistory() {
  const items = await listCaptures();
  const grid = $('grid');
  for (const u of urls) URL.revokeObjectURL(u);
  urls = [];
  grid.replaceChildren(...items.map(card));
  $('empty').hidden = items.length > 0;
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return 'ahora';
  if (m < 60) return `hace ${m} min`;
  if (m < 60 * 24) return `hace ${Math.round(m / 60)} h`;
  return new Date(ts).toLocaleDateString();
}

function button(label: string, title: string, run: (b: HTMLButtonElement) => Promise<void>) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', async () => {
    const prev = b.textContent;
    try {
      await run(b);
    } catch (err) {
      console.error('[reverse-search]', err);
      b.textContent = '✗';
      b.title = String(err);
      setTimeout(() => {
        b.textContent = prev;
        b.title = title;
      }, 1500);
    }
  });
  return b;
}

function ok(b: HTMLButtonElement, label: string) {
  const prev = b.textContent;
  b.textContent = '✓';
  setTimeout(() => (b.textContent = prev ?? label), 1200);
}

function card(c: Capture): HTMLElement {
  const root = document.createElement('div');
  root.className = 'card';

  const thumbUrl = URL.createObjectURL(c.thumb);
  urls.push(thumbUrl);
  const img = document.createElement('img');
  img.src = thumbUrl;
  img.alt = '';
  img.title = 'Abrir a tamaño completo';
  img.addEventListener('click', () => {
    const u = URL.createObjectURL(c.blob);
    window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60_000);
  });

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${c.w}×${c.h} · ${ago(c.ts)}`;

  const acts = document.createElement('div');
  acts.className = 'acts';
  acts.append(
    button('Copiar', 'Copiar al portapapeles (PNG)', async (b) => {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([c.blob], { type: 'image/png' }) })]);
      ok(b, 'Copiar');
    }),
    button('Descargar', 'Descargar con el formato elegido arriba', async (b) => {
      const s = await getSettings();
      const out = await encodeImage(c.blob, s.format, s.quality);
      downloadBlob(out, `captura-${stamp(new Date(c.ts))}.${EXT[s.format]}`);
      ok(b, 'Descargar');
    }),
    button('🗑', 'Quitar del historial', async () => {
      await deleteCapture(c.id);
      root.remove();
      $('empty').hidden = $('grid').childElementCount > 0;
    }),
  );

  root.append(img, meta, acts);
  return root;
}
