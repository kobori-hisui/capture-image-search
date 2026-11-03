// Historial de capturas en IndexedDB. Solo lo usan el background (escribe) y el panel lateral (lee/borra):
// ambos viven en el origen de la extensión y comparten la misma base de datos.

const DB = 'rs-history';
const STORE = 'captures';
const THUMB = 360; // lado máximo de la miniatura (px)

export type Capture = {
  id: string;
  ts: number;
  w: number;
  h: number;
  blob: Blob; // PNG original
  thumb: Blob; // miniatura WebP
};

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('ts', 'ts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbp = null;
      reject(req.error);
    };
  }));
}

function finished(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// Miniatura que cabe en THUMB×THUMB; las páginas muy altas se recortan por arriba (relación 1:1.5)
async function makeThumb(bmp: ImageBitmap): Promise<Blob> {
  const sh = Math.min(bmp.height, Math.round(bmp.width * 1.5));
  const s = Math.min(1, THUMB / Math.max(bmp.width, sh));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(sh * s));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d')!.drawImage(bmp, 0, 0, bmp.width, sh, 0, 0, w, h);
  return c.convertToBlob({ type: 'image/webp', quality: 0.8 });
}

export async function addCapture(dataUrl: string, max: number): Promise<Capture> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  let rec: Capture;
  try {
    rec = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      w: bmp.width,
      h: bmp.height,
      blob,
      thumb: await makeThumb(bmp),
    };
  } finally {
    bmp.close();
  }
  const t = (await db()).transaction(STORE, 'readwrite');
  const fin = finished(t);
  t.objectStore(STORE).put(rec);
  await fin;
  await pruneCaptures(max);
  return rec;
}

/** Más recientes primero. Los Blob se leen perezosamente, listar es barato. */
export async function listCaptures(): Promise<Capture[]> {
  const t = (await db()).transaction(STORE, 'readonly');
  const all = await req<Capture[]>(t.objectStore(STORE).getAll());
  return all.sort((a, b) => b.ts - a.ts);
}

export async function deleteCapture(id: string): Promise<void> {
  const t = (await db()).transaction(STORE, 'readwrite');
  const fin = finished(t);
  t.objectStore(STORE).delete(id);
  await fin;
}

export async function clearCaptures(): Promise<void> {
  const t = (await db()).transaction(STORE, 'readwrite');
  const fin = finished(t);
  t.objectStore(STORE).clear();
  await fin;
}

/** Deja solo las `max` más recientes. */
export async function pruneCaptures(max: number): Promise<void> {
  const t = (await db()).transaction(STORE, 'readwrite');
  const fin = finished(t);
  const store = t.objectStore(STORE);
  let extra = (await req(store.count())) - max;
  if (extra > 0) {
    await new Promise<void>((resolve, reject) => {
      const cur = store.index('ts').openKeyCursor(); // de la más antigua a la más nueva
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || extra <= 0) return resolve();
        store.delete(c.primaryKey);
        extra--;
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  }
  await fin;
}
