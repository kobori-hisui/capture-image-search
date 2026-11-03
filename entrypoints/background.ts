import {
  DEFAULT_SERVICE,
  JOB_KEY,
  OCR_PAYLOAD_KEY,
  VIEW_KEY,
  type Job,
  type ServiceId,
} from '../services/types';
import { SERVICES, isServiceId } from '../services/meta';
import { OCR_URL, dropImage } from '../services/yandex/ocr-page';
import { addCapture } from '../utils/history';
import { getSettings } from '../utils/settings';

const DEFAULT_TITLE = 'Buscar por imagen (Alt+Shift+S)';

export default defineBackground(() => {
  browser.declarativeNetRequest
    .updateDynamicRules({
      removeRuleIds: [1, 2],
      addRules: [
        {
          // Yandex rechaza Origin chrome-extension:// en la subida
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'Origin', operation: 'set', value: 'https://yandex.com' },
              { header: 'Referer', operation: 'set', value: 'https://yandex.com/images/' },
            ],
          },
          condition: {
            urlFilter: '||yandex.com/images/search',
            requestMethods: ['post'],
            resourceTypes: ['xmlhttprequest', 'sub_frame'],
          },
        },
        {
          // Permite mostrar Yandex (y translate.yandex.com) dentro del iframe del panel lateral
          id: 2,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            responseHeaders: [
              { header: 'x-frame-options', operation: 'remove' },
              { header: 'content-security-policy', operation: 'remove' },
            ],
          },
          condition: {
            requestDomains: ['yandex.com', 'yandex.ru', 'ya.ru'],
            resourceTypes: ['sub_frame'],
          },
        },
      ],
    })
    .catch((err) => console.error('[reverse-search] DNR', err));

  // Clic derecho en el icono → una entrada por servicio que declare `menuTitle`.
  // (Hacer clic en una entrada del menú también concede activeTab.)
  browser.contextMenus
    .removeAll()
    .then(() => {
      const groups = new Set<string>();
      for (const [id, m] of Object.entries(SERVICES)) {
        if (!m.menuTitle) continue;
        let parentId: string | undefined;
        if (m.menuGroup) {
          parentId = `group:${m.menuGroup}`;
          if (!groups.has(parentId)) {
            groups.add(parentId);
            browser.contextMenus.create({ id: parentId, title: m.menuGroup, contexts: ['action'] });
          }
        }
        browser.contextMenus.create({ id, parentId, title: m.menuTitle, contexts: ['action'] });
      }
      browser.contextMenus.create({ id: 'history', title: 'Historial de capturas', contexts: ['action'] });
    })
    .catch((err) => console.error('[reverse-search] contextMenus', err));

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'history') {
      if (tab?.id) openHistory(tab.id);
      return;
    }
    if (tab?.id && isServiceId(info.menuItemId)) void startSelector(tab.id, info.menuItemId);
  });

  // Clic izquierdo o Alt+Shift+S (_execute_action) → servicio por defecto (búsqueda inversa)
  browser.action.onClicked.addListener((tab) => {
    if (tab.id) void startSelector(tab.id, DEFAULT_SERVICE);
  });

  // Atajos propios (manifest.commands): el nombre del comando es el id del servicio.
  // Alt+Shift+D → "yandex-ocr". Un atajo también concede activeTab a la pestaña activa.
  browser.commands.onCommand.addListener(async (command) => {
    if (!isServiceId(command)) return;
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id) void startSelector(tab.id, command);
  });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const tab = sender.tab;

    switch (msg?.type) {
      // El selector pide la captura de la pestaña (todavía sin overlay) para congelarla
      case 'frame': {
        if (!tab?.id) return;
        browser.tabs
          .captureVisibleTab(tab.windowId, { format: 'png' })
          .then((dataUrl) => sendResponse({ dataUrl }))
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      // Captura de página completa: el background captura, la guarda en el historial y se la devuelve
      // al selector (que la copia al portapapeles, que aquí no se puede).
      case 'full-page': {
        if (!tab?.id) return;
        captureFullPage(tab.id)
          .then(async (dataUrl) => {
            await saveToHistory(dataUrl).catch((err) => console.error('[reverse-search] historial', err));
            sendResponse({ dataUrl });
          })
          .catch((err) => sendResponse({ error: String(err) }));
        return true;
      }

      // Captura de región ya entregada por el selector → al historial
      case 'history:add': {
        if (typeof msg.image === 'string') {
          saveToHistory(msg.image).catch((err) => console.error('[reverse-search] historial', err));
        }
        return;
      }

      // Progreso de la captura por desplazamiento: en el icono, no en la página (saldría en la captura)
      case 'progress': {
        if (!tab?.id) return;
        browser.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#1a73e8' }).catch(() => {});
        browser.action.setBadgeText({ tabId: tab.id, text: String(msg.text ?? '') }).catch(() => {});
        return;
      }

      // Botón "Historial" del selector (hay gesto de usuario detrás)
      case 'history:open': {
        if (tab?.id) openHistory(tab.id);
        return;
      }

      case 'error': {
        if (tab?.id) void flagError(tab.id, `Error: ${String(msg.message).slice(0, 180)}`);
        return;
      }

      // Recorte ya hecho en la página → abrir panel y publicar el trabajo
      case 'region': {
        if (!tab?.id || typeof msg.image !== 'string') return;
        const tabId = tab.id;
        const service: ServiceId = isServiceId(msg.service) ? msg.service : DEFAULT_SERVICE;

        // sidePanel.open exige gesto de usuario: se llama primero, sin await previo.
        const opened = browser.sidePanel
          .open({ tabId })
          .then(() => true)
          .catch((err) => {
            console.warn('[reverse-search] No se pudo abrir el panel lateral', err);
            return false;
          });

        const job: Job = { id: crypto.randomUUID(), service, image: msg.image };
        const data: Record<string, unknown> = { [JOB_KEY]: job };
        // El iframe de Yandex Traductor no puede leer storage.session: la pide por mensaje
        if (service === 'yandex-ocr') data[OCR_PAYLOAD_KEY] = { id: job.id, image: job.image };

        browser.storage.session
          .set(data)
          .then(async () => {
            // Plan B: si el panel no abrió, la misma página funciona en una pestaña
            if (!(await opened)) {
              await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
            }
            sendResponse({ ok: true });
          })
          .catch((err) => {
            console.error('[reverse-search]', err);
            sendResponse({ ok: false });
          });
        return true;
      }

      // El content script del iframe de translate.yandex.com pide la imagen a pegar
      case 'ocr:get': {
        browser.storage.session
          .get(OCR_PAYLOAD_KEY)
          .then((s) => sendResponse(s[OCR_PAYLOAD_KEY] ?? null));
        return true;
      }

      // ↗ / "Abrir en pestaña": misma imagen, pegada en una pestaña normal de Yandex Traductor
      case 'ocr:open-tab': {
        void ocrInTab().catch((err) => console.error('[reverse-search] ocrInTab', err));
        return;
      }
    }
  });
});

async function startSelector(tabId: number, service: ServiceId) {
  try {
    // El selector lee este valor al arrancar (mismo mundo aislado que el content script)
    await browser.scripting.executeScript({
      target: { tabId },
      func: (s: string) => {
        (window as unknown as { __rsService?: string }).__rsService = s;
      },
      args: [service],
    });
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
  } catch (err) {
    // Visible sin abrir la consola: "!" rojo en el icono + el error en su tooltip
    console.warn('[reverse-search] No se pudo inyectar el selector', err);
    await flagError(tabId, `No se pudo usar aquí: ${String(err).slice(0, 180)}`);
  }
}

async function saveToHistory(dataUrl: string) {
  const { historyMax } = await getSettings();
  await addCapture(dataUrl, historyMax);
  browser.runtime.sendMessage({ type: 'history:changed' }).catch(() => {}); // sin panel abierto no hay receptor
}

// Abre el panel lateral en la vista de historial. sidePanel.open exige gesto: se llama primero, sin await previo.
function openHistory(tabId: number) {
  const opened = browser.sidePanel
    .open({ tabId })
    .then(() => true)
    .catch(() => false);
  browser.storage.session
    .set({ [VIEW_KEY]: { view: 'history', id: crypto.randomUUID() } })
    .then(async () => {
      if (!(await opened)) await browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') });
    })
    .catch((err) => console.error('[reverse-search]', err));
}

const MAX_PX = 16_000; // Chrome no rasteriza texturas mayores de ~16384 px por lado

// Página entera con una sola captura: Page.captureScreenshot + captureBeyondViewport (sin costuras,
// sin repetir cabeceras fijas). Muestra el aviso "depurando este navegador" solo mientras dura.
async function captureFullPage(tabId: number): Promise<string> {
  const target = { tabId };
  const cdp = <T>(method: string, params?: Record<string, unknown>) =>
    browser.debugger.sendCommand(target, method, params) as unknown as Promise<T>;

  await browser.debugger.attach(target, '1.3');
  try {
    const m = await cdp<{ cssContentSize?: Size; contentSize: Size }>('Page.getLayoutMetrics');
    const size = m.cssContentSize ?? m.contentSize;
    const dpr = (await cdp<{ result: { value: number } }>('Runtime.evaluate', {
      expression: 'window.devicePixelRatio',
      returnByValue: true,
    })).result.value || 1;

    // Resolución nativa si cabe; si no, se baja la escala y, en último caso, se recorta el alto
    let scale = dpr;
    let width = Math.ceil(size.width);
    let height = Math.ceil(size.height);
    if (Math.max(width, height) * scale > MAX_PX) scale = Math.max(1, MAX_PX / Math.max(width, height));
    height = Math.min(height, Math.floor(MAX_PX / scale));
    width = Math.min(width, Math.floor(MAX_PX / scale));

    const shot = await cdp<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale },
    });
    return `data:image/png;base64,${shot.data}`;
  } finally {
    await browser.debugger.detach(target).catch(() => {});
  }
}
type Size = { width: number; height: number };

async function ocrInTab() {
  const stored = await browser.storage.session.get(OCR_PAYLOAD_KEY);
  const payload = stored[OCR_PAYLOAD_KEY] as { id: string; image: string } | undefined;
  if (!payload) return;

  const tab = await browser.tabs.create({ url: OCR_URL });
  if (!tab.id) return;
  const tabId = tab.id;
  await new Promise<void>((resolve) => {
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const done = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const timer = setTimeout(done, 20_000);
    browser.tabs.onUpdated.addListener(onUpdated);
  });

  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: dropImage,
    args: [payload.image],
  });
  console.log('[reverse-search] ocrInTab →', res?.result);
}

async function flagError(tabId: number, title: string) {
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
  await browser.action.setBadgeText({ tabId, text: '!' });
  await browser.action.setTitle({ tabId, title });
  setTimeout(() => {
    browser.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    browser.action.setTitle({ tabId, title: DEFAULT_TITLE }).catch(() => {});
  }, 8000);
}
