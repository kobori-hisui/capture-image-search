import type { ServiceMeta } from '../types';

// Captura simple: recorta una región y la copia al portapapeles (Shift al soltar = guardar PNG).
// El atajo real está en wxt.config.ts → manifest.commands['capture'].
export const capture: ServiceMeta = {
  title: 'Captura',
  toast: 'Selecciona una región · Shift al soltar = guardar PNG',
  menuTitle: 'Capturar (Alt+Shift+C)',
};
