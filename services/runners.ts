// Solo lo importa el panel lateral (los runners usan APIs de DOM).
import type { Runner, ServiceId } from './types';
import { runImageSearch } from './yandex/image-search';
import { runOcrTranslate } from './yandex/ocr-translate';

// 'capture' no pasa por el panel lateral (se resuelve en el selector), por eso es parcial.
export const RUNNERS: Partial<Record<ServiceId, Runner>> = {
  'yandex-search': runImageSearch,
  'yandex-ocr': runOcrTranslate,
};
