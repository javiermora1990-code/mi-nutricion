import { describe, expect, it } from 'vitest';
import type { DayTargets, Food } from '../src/db/types';
import { buildContextPreview, canExportContext, type ContextPreviewInput } from '../src/lib/aiContextPreview';

const nutrients = (value: number | null): Food['nutrientsPer100'] => ({
  energyKcal: value, proteinG: value, carbsG: value, fatG: value, fiberG: value,
});
const range = (central: number) => ({ central, minTolerance: central - 100, maxTolerance: central + 100 });
const day: DayTargets = {
  energyKcal: range(2000), proteinG: range(120), fatG: range(70), carbsG: range(220), fiberG: range(30),
};
// Persona ficticia.
const complete: ContextPreviewInput = {
  profile: { sex: 'female', heightCm: 168, trainingDaysPerWeek: 3 },
  ageYears: 41,
  weight: { weightKg: 63.4, date: '2026-03-08' },
  goal: { objective: 'maintain', targets: { default: day, training: day } },
  foods: [
    { name: 'Arroz ficticio', brand: null, nutrientsPer100: nutrients(100), verificationStatus: 'verified', deletedAt: null },
    { name: 'Salsa ficticia', brand: 'Marca X', nutrientsPer100: nutrients(null), verificationStatus: 'pending_review', deletedAt: null },
    { name: 'Queso ficticio', brand: null, nutrientsPer100: nutrients(50), verificationStatus: 'pending_review', deletedAt: null },
    { name: 'Borrado', brand: null, nutrientsPer100: nutrients(null), verificationStatus: 'verified', deletedAt: '2026-01-01T00:00:00Z' },
  ],
};
const byKey = (input: ContextPreviewInput) => Object.fromEntries(buildContextPreview(input).map((row) => [row.key, row]));

describe('Vista previa del contexto para la IA', () => {
  it('resume cada bloque con los datos actuales y avisa de lo que conviene revisar', () => {
    const rows = byKey(complete);
    expect(rows.profile).toMatchObject({ tone: 'ok', summary: 'Mujer · 41 años · 168 cm · 63,4 kg (8 mar) · 3 días de entrenamiento' });
    expect(rows.goals).toMatchObject({ tone: 'ok', summary: 'Mantener · 2000 kcal · proteína 120 g' });
    expect(rows.goals.details).toHaveLength(2);
    expect(rows.catalog).toMatchObject({ tone: 'warn', summary: '3 alimentos', note: '1 sin nutrientes completos' });
    expect(rows.catalog.details).toEqual(['Salsa ficticia (Marca X) · faltan nutrientes', 'Queso ficticio · pendiente de verificar']);
    expect(canExportContext(Object.values(rows))).toBe(true);
  });

  it('sin perfil bloquea la exportación y sin metas solo avisa', () => {
    const rows = buildContextPreview({ ...complete, profile: null, weight: null, ageYears: null, goal: null });
    const map = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(map.profile).toMatchObject({ tone: 'block', summary: 'Sin perfil' });
    expect(map.goals).toMatchObject({ tone: 'warn', summary: 'Sin metas aprobadas' });
    expect(canExportContext(rows)).toBe(false);
  });

  it('muestra horarios y últimas semanas solo cuando hay datos', () => {
    expect(byKey(complete).diary).toBeUndefined();
    const rows = byKey({
      ...complete,
      profile: { ...complete.profile!, mealRoutine: 'Desayuno a las 8' },
      weeklySummary: {
        weeks: [{
          weekStart: '2026-11-09', loggedDays: 3, evaluableDays: 2, avgEnergyKcal: 1900, avgProteinG: 110,
          avgCarbsG: null, avgFatG: null, avgFiberG: null, avgWeightKg: 63.1, plannedMealsOnLoggedDays: 4, plannedMealsLogged: 3,
        }],
        frequentRecipes: [{ name: 'Lentejas ficticias', times: 2 }],
        plannedButNotLogged: [],
      },
    });
    expect(rows.profile.details).toEqual(['Horarios: Desayuno a las 8']);
    expect(rows.diary).toMatchObject({ summary: '1 semana · 3 días anotados' });
    expect(rows.diary.details).toEqual([
      'Semana del 9 nov · 2/7 días · 1900 kcal · proteína 110 g · 63,1 kg · menú seguido 3/4',
      'Repites: Lentejas ficticias (2)',
    ]);
  });
});
