import { describe, expect, it } from 'vitest';
import type { DayTargets, Food } from '../src/db/types';
import { buildContextSummary, MAX_ROWS, type ContextSummaryInput } from '../src/lib/aiContextPreview';

const nutrients = (value: number | null): Food['nutrientsPer100'] => ({
  energyKcal: value, proteinG: value, carbsG: value, fatG: value, fiberG: value,
});
const range = (central: number) => ({ central, minTolerance: central - 100, maxTolerance: central + 100 });
const day = (kcal: number): DayTargets => ({
  energyKcal: range(kcal), proteinG: range(120), fatG: range(70), carbsG: range(220), fiberG: range(30),
});
// Persona ficticia.
const complete: ContextSummaryInput = {
  profile: {
    sex: 'female', heightCm: 168, trainingDaysPerWeek: 3, trainingType: 'weights', workType: 'seated',
    dailyStepsBand: '5000-7500', mealRoutine: 'Desayuno a las 8',
  },
  ageYears: 41,
  weight: { weightKg: 63.4, date: '2026-03-08' },
  goal: { objective: 'maintain', targets: { default: day(2000), training: day(2200) } },
  foods: [
    { name: 'Arroz ficticio', brand: null, nutrientsPer100: nutrients(100), verificationStatus: 'verified', deletedAt: null },
    { name: 'Salsa ficticia', brand: 'Marca X', nutrientsPer100: nutrients(null), verificationStatus: 'pending_review', deletedAt: null },
    { name: 'Queso ficticio', brand: null, nutrientsPer100: nutrients(50), verificationStatus: 'pending_review', deletedAt: null },
    { name: 'Borrado', brand: null, nutrientsPer100: nutrients(null), verificationStatus: 'verified', deletedAt: '2026-01-01T00:00:00Z' },
  ],
};
const sections = (input: ContextSummaryInput) =>
  Object.fromEntries(buildContextSummary(input).sections.map((section) => [section.key, section]));

describe('Resumen del contexto para la IA', () => {
  it('ordena cada bloque en una tabla con lo importante', () => {
    const s = sections(complete);
    expect(s.profile.rows).toEqual([
      ['Sexo', 'Mujer'], ['Edad', '41 años'], ['Estatura', '168 cm'], ['Peso', '63,4 kg · 8 mar'],
      ['Entrenamiento', '3 días · pesas'], ['Trabajo', 'Sentado'], ['Pasos al día', '5.000–7.500'], ['Horarios', 'Desayuno a las 8'],
    ]);
    expect(s.goals).toMatchObject({ subtitle: 'Mantener', columns: ['', 'General', 'Entreno'] });
    expect(s.goals.rows[0]).toEqual(['Energía (kcal)', '2000', '2200']);
    expect(s.catalog).toMatchObject({ tone: 'warn', subtitle: '3 alimentos', note: '1 alimento sin nutrientes completos.' });
    expect(s.catalog.rows).toEqual([['Salsa ficticia (Marca X)', 'Faltan nutrientes'], ['Queso ficticio', 'Pendiente de verificar']]);
    expect(s.weeks).toBeUndefined();
    expect(buildContextSummary(complete).canExport).toBe(true);
  });

  it('sin perfil bloquea la exportación y sin metas solo avisa', () => {
    const summary = buildContextSummary({ ...complete, profile: null, weight: null, ageYears: null, goal: null });
    const s = Object.fromEntries(summary.sections.map((section) => [section.key, section]));
    expect(s.profile).toMatchObject({ tone: 'block', rows: [] });
    expect(s.goals).toMatchObject({ tone: 'warn', rows: [] });
    expect(summary.canExport).toBe(false);
  });

  it('despensa por caducidad, recetas y semanas con «Sin dato», limitadas a pocas filas', () => {
    const s = sections({
      ...complete,
      pantry: [
        { name: 'Yogur ficticio', quantity: 4, unit: 'unit', expiryDate: '2026-11-20' },
        { name: 'Arroz ficticio', quantity: 1000, unit: 'g', expiryDate: null },
        { name: 'Leche ficticia', quantity: 1500, unit: 'ml', expiryDate: '2026-11-15' },
      ],
      recipes: Array.from({ length: 10 }, (_, i) => ({ name: `Receta ${i + 1}`, servings: 2, kcalPerServing: i ? 450 : null })),
      weeklySummary: {
        weeks: [{
          weekStart: '2026-11-09', loggedDays: 3, evaluableDays: 2, avgEnergyKcal: 1900, avgProteinG: null,
          avgCarbsG: null, avgFatG: null, avgFiberG: null, avgWeightKg: 63.1, plannedMealsOnLoggedDays: 4, plannedMealsLogged: 3,
        }],
        frequentRecipes: [{ name: 'Lentejas ficticias', times: 2 }],
        plannedButNotLogged: [],
      },
    });
    expect(s.pantry.rows).toEqual([
      ['Leche ficticia', '1500 ml', '15 nov'], ['Yogur ficticio', '4 ud.', '20 nov'], ['Arroz ficticio', '1000 g', '—'],
    ]);
    expect(s.recipes.rows).toHaveLength(MAX_ROWS);
    expect(s.recipes.rows[0]).toEqual(['Receta 1', '2', 'Sin dato']);
    expect(s.recipes.footer).toEqual(['y 2 más']);
    expect(s.weeks.rows).toEqual([['9 nov', '2/7', '1900', 'Sin dato', '63,1 kg']]);
    expect(s.weeks.footer).toEqual(['Repites: Lentejas ficticias']);
  });

  it('despensa vacía lo dice en una línea', () => {
    expect(sections({ ...complete, pantry: [] }).pantry).toMatchObject({ rows: [], note: 'Vacía. La IA no supondrá que tienes nada en casa.' });
  });
});
