/**
 * Resumen breve de las últimas semanas para el contexto de la IA (propuesto en v1.29).
 * Tamaño fijo: como mucho 4 semanas y 3 recetas por lista, por mucho historial que haya.
 */
import type { MiNutricionDB } from '../db/db';
import type { DiaryDay, DiaryEntry, IsoDate, MealPlan, ProgressLog } from '../db/types';
import { addDays, localIsoDate, startOfWeek } from './dates';

export const SUMMARY_WEEKS = 4;
const TOP = 3;
const NUTRIENT_KEYS = ['energyKcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;
type MainNutrient = (typeof NUTRIENT_KEYS)[number];

export interface WeekSummary {
  /** Lunes de la semana. */
  weekStart: IsoDate;
  /** Días con algo anotado en el diario. */
  loggedDays: number;
  /** Días que cuentan para las medias: con registros y no marcados como abiertos. */
  evaluableDays: number;
  /** Medias diarias; solo cuentan los días evaluables con dato en todas sus entradas. */
  avgEnergyKcal: number | null;
  avgProteinG: number | null;
  avgCarbsG: number | null;
  avgFatG: number | null;
  avgFiberG: number | null;
  avgWeightKg: number | null;
  /** Tomas planificadas en días con registros, y cuántas de ellas tienen algo anotado. */
  plannedMealsOnLoggedDays: number;
  plannedMealsLogged: number;
}

export interface WeeklySummary {
  weeks: WeekSummary[];
  /** Recetas anotadas al menos dos veces, de más a menos. */
  frequentRecipes: { name: string; times: number }[];
  /** Recetas planificadas en días con registros que no se anotaron ninguna vez. */
  plannedButNotLogged: string[];
}

export interface WeeklySummaryInput {
  today: IsoDate;
  entries: Pick<DiaryEntry, 'date' | 'mealSlot' | 'itemType' | 'recipeId' | 'snapshotName' | 'snapshotNutrients' | 'deletedAt'>[];
  days: Pick<DiaryDay, 'date' | 'completionStatus' | 'deletedAt'>[];
  progress: Pick<ProgressLog, 'date' | 'weightKg' | 'deletedAt'>[];
  plans: Pick<MealPlan, 'date' | 'mealSlot' | 'items' | 'deletedAt'>[];
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const mean = (values: number[], digits: number) =>
  values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, digits) : null;

/** Ventana: desde el lunes de hace tres semanas hasta ayer (hoy aún está a medias). */
export function summaryWindow(today: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: addDays(startOfWeek(today), -7 * (SUMMARY_WEEKS - 1)), to: addDays(today, -1) };
}

/** Devuelve `null` si no hay ningún registro en la ventana: entonces no se envía nada. */
export function buildWeeklySummary(input: WeeklySummaryInput): WeeklySummary | null {
  const { from, to } = summaryWindow(input.today);
  const inWindow = <T extends { date: IsoDate; deletedAt: string | null }>(rows: T[]) =>
    rows.filter((row) => !row.deletedAt && row.date >= from && row.date <= to);
  const entries = inWindow(input.entries);
  const progress = inWindow(input.progress).filter((log) => log.weightKg !== null);
  const plans = inWindow(input.plans);
  const status = new Map(inWindow(input.days).map((day) => [day.date, day.completionStatus]));
  const loggedDates = new Set(entries.map((entry) => entry.date));

  const weeks: WeekSummary[] = [];
  for (let start = from; start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    const inWeek = (date: IsoDate) => date >= start && date <= end;
    const logged = [...loggedDates].filter(inWeek).sort();
    const evaluable = logged.filter((date) => status.get(date) !== 'open');
    const dayTotal = (date: IsoDate, key: MainNutrient): number | null => {
      let total = 0;
      for (const entry of entries) {
        if (entry.date !== date) continue;
        const value = entry.snapshotNutrients[key];
        if (value === null || value === undefined) return null;
        total += value;
      }
      return total;
    };
    const avg = (key: MainNutrient) =>
      mean(evaluable.map((date) => dayTotal(date, key)).filter((v): v is number => v !== null), 0);
    const weights = progress.filter((log) => inWeek(log.date)).map((log) => log.weightKg as number);
    const planned = plans.filter((plan) => loggedDates.has(plan.date) && inWeek(plan.date) && plan.items.length);
    const plannedLogged = planned.filter((plan) =>
      entries.some((entry) => entry.date === plan.date && entry.mealSlot === plan.mealSlot));
    if (!logged.length && !weights.length) continue;
    weeks.push({
      weekStart: start, loggedDays: logged.length, evaluableDays: evaluable.length,
      avgEnergyKcal: avg('energyKcal'), avgProteinG: avg('proteinG'), avgCarbsG: avg('carbsG'),
      avgFatG: avg('fatG'), avgFiberG: avg('fiberG'), avgWeightKg: mean(weights, 1),
      plannedMealsOnLoggedDays: planned.length, plannedMealsLogged: plannedLogged.length,
    });
  }
  if (!weeks.length) return null;

  const counts = new Map<string, { name: string; times: number }>();
  for (const entry of entries) {
    if (entry.itemType !== 'recipe' || !entry.recipeId) continue;
    const current = counts.get(entry.recipeId) ?? { name: entry.snapshotName, times: 0 };
    current.times += 1;
    counts.set(entry.recipeId, current);
  }
  const frequentRecipes = [...counts.values()].filter((r) => r.times >= 2)
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name, 'es')).slice(0, TOP);

  const loggedRecipeIds = new Set(counts.keys());
  const missing = new Map<string, string>();
  for (const plan of plans) {
    if (!loggedDates.has(plan.date)) continue;
    for (const item of plan.items) {
      if (item.itemType === 'recipe' && !loggedRecipeIds.has(item.refId)) {
        missing.set(item.refId, item.snapshot?.name ?? 'Receta sin nombre');
      }
    }
  }
  const plannedButNotLogged = [...new Set(missing.values())].sort((a, b) => a.localeCompare(b, 'es')).slice(0, TOP);

  return { weeks, frequentRecipes, plannedButNotLogged };
}

export async function loadWeeklySummary(db: MiNutricionDB, date = new Date()): Promise<WeeklySummary | null> {
  const today = localIsoDate(date);
  const { from, to } = summaryWindow(today);
  const [entries, days, progress, plans] = await Promise.all([
    db.diaryEntries.where('date').between(from, to, true, true).toArray(),
    db.diaryDays.where('date').between(from, to, true, true).toArray(),
    db.progressLogs.where('date').between(from, to, true, true).toArray(),
    db.mealPlans.where('date').between(from, to, true, true).toArray(),
  ]);
  return buildWeeklySummary({ today, entries, days, progress, plans });
}

