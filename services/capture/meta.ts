import type { ServiceMeta } from '../types';

// Los atajos reales están en wxt.config.ts → manifest.commands (el nombre del comando = id del servicio).

// Región → portapapeles (Shift al soltar = guardar archivo). Todo queda en el historial.
export const capture: ServiceMeta = {
  title: 'Captura',
  toast: 'Selecciona una región · Shift al soltar = guardar archivo',
  menuTitle: 'Capturar (Alt+Shift+C)',
};

// Página entera de una vez (chrome.debugger), sin selector.
export const captureFull: ServiceMeta = {
  title: 'Captura',
  toast: '',
  menuTitle: 'Capturar página completa (Alt+Shift+F)',
};
