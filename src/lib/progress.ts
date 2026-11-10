/**
 * Registro diario de progreso y series para las gráficas (sección 6).
 * Regla: un día sin dato es `null`. No se rellena, no se interpola y no cuenta
 * en los promedios.
 */
import { z } from 'zod';
import { newBase, nowIso, type MiNutricionDB } from '../db/db';
import type { IsoDate, ProgressLog } from '../db/types';
import { addDays } from './dates';

const scale1to5 = z.number().int().min(1).max(5).nullable();

export const progressInputSchema = z.object({
  weightKg: z.number().min(30).max(300).nullable(),
  sleepHours: z.number().min(0).max(24).nullable(),
  sleepQuality1to5: scale1to5,
  energyLevel1to5: scale1to5,
  hungerLevel1to5: scale1to5,
  trained: z.boolean().nullable(),
  notes: z.string().max(500).nullable(),
});

export type ProgressInput = z.infer<typeof progressInputSchema>;

export const EMPTY_PROGRESS: ProgressInput = {
  weightKg: null,
  sleepHours: null,
  sleepQuality1to5: null,
  energyLevel1to5: null,
  hungerLevel1to5: null,
  trained: null,
  notes: null,
};

export async function getProgressLog(db: MiNutricionDB, date: IsoDate): Promise<ProgressLog | null> {
  const log = await db.progressLogs.where('date').equals(date).first();
  return log && log.deletedAt === null ? log : null;
}

/**
 * Crea o actualiza el registro del día (uno por fecha). Al actualizar se
 * conserva el `id` y se incrementa `revision`.
 */
export async function saveProgressLog(db: MiNutricionDB, date: IsoDate, input: ProgressInput): Promise<ProgressLog> {
  const data = progressInputSchema.parse(input);
  z.iso.date().parse(date);
  return db.transaction('rw', db.progressLogs, async () => {
    const existing = await db.progressLogs.where('date').equals(date).first();
    const now = nowIso();
    const log: ProgressLog = existing
      ? { ...existing, ...data, deletedAt: null, updatedAt: now, revision: existing.revision + 1 }
      : { ...newBase(now), date, ...data };
    await db.progressLogs.put(log);
    return log;
  });
}

export const WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOWS)[number];

export const METRICS = ['weightKg', 'sleepHours', 'sleepQuality1to5', 'energyLevel1to5', 'hungerLevel1to5'] as const;
export type Metric = (typeof METRICS)[number];

export interface ProgressSeries {
  /** Todos los días de la ventana, del más antiguo al más reciente. */
  dates: IsoDate[];
  /** Un valor por día; `null` donde no hay dato. */
  values: Record<Metric, (number | null)[]>;
}

/** Fechas de una ventana de `days` días que termina en `endDate` (incluido). */
export function windowDates(endDate: IsoDate, days: number): IsoDate[] {
  return Array.from({ length: days }, (_, i) => addDays(endDate, i - (days - 1)));
}

/** Coloca cada registro en su día; los días sin registro o sin ese dato quedan en null. */
export function buildSeries(logs: ProgressLog[], endDate: IsoDate, days: number): ProgressSeries {
  const dates = windowDates(endDate, days);
  const byDate = new Map(logs.filter((l) => l.deletedAt === null).map((l) => [l.date, l]));
  const values = Object.fromEntries(
    METRICS.map((m) => [m, dates.map((d) => byDate.get(d)?.[m] ?? null)]),
  ) as Record<Metric, (number | null)[]>;
  return { dates, values };
}

export interface MetricSummary {
  /** Número de registros evaluables (días con dato). */
  count: number;
  /** null si no hay ningún registro: nunca 0. */
  average: number | null;
  min: number | null;
  max: number | null;
  first: number | null;
  last: number | null;
}

/** Promedio solo sobre los días con dato. */
export function summarize(values: (number | null)[]): MetricSummary {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return { count: 0, average: null, min: null, max: null, first: null, last: null };
  return {
    count: present.length,
    average: present.reduce((a, b) => a + b, 0) / present.length,
    min: Math.min(...present),
    max: Math.max(...present),
    first: present[0],
    last: present[present.length - 1],
  };
}

export async function loadSeries(db: MiNutricionDB, endDate: IsoDate, days: number): Promise<ProgressSeries> {
  const start = addDays(endDate, -(days - 1));
  const logs = await db.progressLogs.where('date').between(start, endDate, true, true).toArray();
  return buildSeries(logs, endDate, days);
}
