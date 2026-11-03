import { JOB_KEY, VIEW_KEY, type Job, type PanelCtx } from '../../services/types';
import { SERVICES } from '../../services/meta';
import { RUNNERS } from '../../services/runners';
import { initHistory, renderHistory } from './history';

const $ = (id: string) => document.getElementById(id)!;
const titleEl = $('title');
const statusEl = $('status');
const bannerEl = $('banner');
const frame = $('results') as HTMLIFrameElement;
const openBtn = $('open') as HTMLButtonElement;

const histBtn = $('hist');
const resultsView = $('resultsView');
const historyView = $('history');

let view: 'results' | 'history' = 'results';
let resultsTitle = 'Yandex';

function setView(next: 'results' | 'history') {
  view = next;
  const h = next === 'history';
  resultsView.hidden = h;
  historyView.hidden = !h;
  document.body.classList.toggle('hist', h);
  histBtn.style.background = h ? '#3c4043' : '';
  titleEl.textContent = h ? 'Historial' : resultsTitle;
  if (h) void renderHistory();
}

let lastId = '';
let openHandler: (() => void) | null = null;

function setStatus(text: string, isError = false, detail = '') {
  frame.style.display = 'none';
  statusEl.style.display = 'block';
  statusEl.className = isError ? 'error' : '';
  statusEl.textContent = text;
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail;
    statusEl.appendChild(pre);
  }
}

function resetUi() {
  bannerEl.hidden = true;
  bannerEl.replaceChildren();
  openHandler = null;
  openBtn.hidden = true;
}

function makeCtx(job: Job): PanelCtx {
  return {
    jobId: job.id,
    frame,
    isStale: () => job.id !== lastId,
    setStatus,
    showFrame() {
      statusEl.style.display = 'none';
      frame.style.display = 'block';
    },
    navigate(url) {
      frame.src = url;
    },
    onOpen(handler) {
      openHandler = handler;
      openBtn.hidden = !handler;
    },
    banner(text, action) {
      bannerEl.replaceChildren();
      const span = document.createElement('span');
      span.textContent = text;
      bannerEl.append(span);
      if (action) {
        const b = document.createElement('button');
        b.textContent = action.label;
        b.addEventListener('click', action.run);
        bannerEl.append(b);
      }
      bannerEl.hidden = false;
    },
  };
}

async function handle(job: Job | undefined) {
  if (!job || job.id === lastId) return;
  lastId = job.id;
  await browser.storage.session.remove(JOB_KEY);

  const meta = SERVICES[job.service];
  const run = RUNNERS[job.service];
  if (!meta || !run) return setStatus(`Servicio desconocido: ${job.service}`, true);

  resultsTitle = meta.title;
  setView('results');
  resetUi();
  try {
    const blob = await (await fetch(job.image)).blob();
    await run(blob, makeCtx(job));
  } catch (err) {
    console.error('[reverse-search]', err);
    if (job.id === lastId) setStatus('Error', true, String(err));
  }
}

openBtn.addEventListener('click', () => openHandler?.());
histBtn.addEventListener('click', () => setView(view === 'history' ? 'results' : 'history'));
void initHistory().catch((err) => console.error('[reverse-search] initHistory', err));

// Capturas nuevas mientras el historial está a la vista
browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'history:changed' && view === 'history') void renderHistory();
});

async function consumeView(v: { view?: string } | undefined) {
  if (!v) return;
  await browser.storage.session.remove(VIEW_KEY);
  if (v.view === 'history') setView('history');
}

// Trabajos nuevos mientras el panel está abierto (cada vez que ajustas la selección)
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (changes[VIEW_KEY]?.newValue) void consumeView(changes[VIEW_KEY].newValue as { view?: string });
  if (!changes[JOB_KEY]) return;
  void handle(changes[JOB_KEY].newValue as Job | undefined);
});

// Trabajo ya pendiente cuando el panel termina de cargar
browser.storage.session
  .get(JOB_KEY)
  .then((s) => handle(s[JOB_KEY] as Job | undefined))
  .catch((err) => setStatus('Error', true, String(err)));

browser.storage.session
  .get(VIEW_KEY)
  .then((s) => consumeView(s[VIEW_KEY] as { view?: string } | undefined))
  .catch(() => {});
