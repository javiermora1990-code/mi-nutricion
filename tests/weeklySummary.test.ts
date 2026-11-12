import { describe, expect, it } from 'vitest';
import type { MealPlan, Nutrients } from '../src/db/types';
import { buildWeeklySummary, summaryWindow, type WeeklySummaryInput } from '../src/lib/weeklySummary';

// Datos ficticios. Hoy es viernes 13 de noviembre de 2026.
const today = '2026-11-13';
const n = (energyKcal: number, proteinG: number | null = 30): Nutrients => ({
  energyKcal, proteinG, carbsG: 50, fatG: 20, fiberG: 5,
});
const entry = (date: string, mealSlot: MealPlan['mealSlot'], nutrients: Nutrients, recipeId: string | null = null) => ({
  date, mealSlot, itemType: recipeId ? 'recipe' as const : 'food' as const, recipeId,
  snapshotName: recipeId ? `Receta ${recipeId}` : 'Alimento ficticio', snapshotNutrients: nutrients, deletedAt: null,
});
const plan = (date: string, mealSlot: MealPlan['mealSlot'], recipeId: string) => ({
  date, mealSlot, deletedAt: null,
  items: [{ itemType: 'recipe' as const, refId: recipeId, quantity: 1, unit: 'portion' as const,
    snapshot: { name: `Receta ${recipeId}`, nutrients: n(0), ingredients: [] } }],
});
const empty: WeeklySummaryInput = { today, entries: [], days: [], progress: [], plans: [] };

describe('Resumen semanal para la IA', () => {
  it('la ventana va del lunes de hace tres semanas hasta ayer', () => {
    expect(summaryWindow(today)).toEqual({ from: '2026-10-19', to: '2026-11-12' });
  });

  it('sin registros no se envía nada', () => {
    expect(buildWeeklySummary(empty)).toBeNull();
    expect(buildWeeklySummary({ ...empty, plans: [plan('2026-11-10', 'lunch', 'A')] })).toBeNull();
  });

  it('resume cada semana con medias que solo cuentan los días con dato', () => {
    const summary = buildWeeklySummary({
      today,
      entries: [
        entry('2026-11-10', 'breakfast', n(500), 'A'),
        entry('2026-11-10', 'lunch', n(700)),
        entry('2026-11-11', 'dinner', n(600, null), 'A'),
        entry('2026-11-12', 'lunch', n(300)),
        entry('2026-11-13', 'lunch', n(999)), // hoy: fuera de la ventana
        { ...entry('2026-11-11', 'lunch', n(5000)), deletedAt: '2026-11-11T20:00:00Z' },
      ],
      days: [{ date: '2026-11-12', completionStatus: 'open', deletedAt: null }],
      progress: [
        { date: '2026-11-10', weightKg: 63.2, deletedAt: null },
        { date: '2026-11-12', weightKg: 63, deletedAt: null },
        { date: '2026-10-20', weightKg: 64, deletedAt: null },
        { date: '2026-10-01', weightKg: 65, deletedAt: null },
      ],
      plans: [
        plan('2026-11-10', 'breakfast', 'A'),
        plan('2026-11-10', 'dinner', 'B'),
        plan('2026-11-11', 'dinner', 'A'),
        plan('2026-11-09', 'lunch', 'C'), // día sin registros: no cuenta
      ],
    });
    expect(summary?.weeks).toHaveLength(2);
    expect(summary?.weeks[0]).toMatchObject({ weekStart: '2026-10-19', loggedDays: 0, avgWeightKg: 64, avgEnergyKcal: null });
    expect(summary?.weeks[1]).toEqual({
      weekStart: '2026-11-09', loggedDays: 3, evaluableDays: 2,
      avgEnergyKcal: 900, avgProteinG: 60, avgCarbsG: 75, avgFatG: 30, avgFiberG: 8,
      avgWeightKg: 63.1, plannedMealsOnLoggedDays: 3, plannedMealsLogged: 2,
    });
    expect(summary?.frequentRecipes).toEqual([{ name: 'Receta A', times: 2 }]);
    expect(summary?.plannedButNotLogged).toEqual(['Receta B']);
  });

  it('tiene un tamaño fijo aunque haya mucho historial', () => {
    const entries = [];
    for (let d = 0; d < 200; d++) {
      const date = new Date(Date.UTC(2026, 4, 1 + d)).toISOString().slice(0, 10);
      entries.push(entry(date, 'lunch', n(2000), `R${d % 6}`));
    }
    const summary = buildWeeklySummary({ ...empty, entries });
    expect(summary?.weeks).toHaveLength(4);
    expect(summary?.frequentRecipes).toHaveLength(3);
  });
});
