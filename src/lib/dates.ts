import type { IsoDate } from '../db/types';

/** Fecha local del dispositivo como YYYY-MM-DD (no UTC: el día es el del usuario). */
export function localIsoDate(date: Date = new Date()): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Suma (o resta) días naturales a una fecha YYYY-MM-DD. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  return localIsoDate(new Date(y, m - 1, d + days));
}

/** Mediodía local de una fecha YYYY-MM-DD, en segundos Unix (eje X de las gráficas). */
export function noonEpochSeconds(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(new Date(y, m - 1, d, 12).getTime() / 1000);
}

/** Años cumplidos en la fecha `on`. */
export function ageOn(birthDate: IsoDate, on: IsoDate): number {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [y, m, d] = on.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const shortDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

function toDate(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const formatShortDate = (date: IsoDate) => shortDate.format(toDate(date));
export const formatLongDate = (date: IsoDate) => longDate.format(toDate(date));
