import type { MiNutricionDB } from '../db/db';
import type { Food, IsoDate, NutritionGoal, Objective, Profile } from '../db/types';
import { formatShortDate, localIsoDate } from './dates';
import { getActiveGoal, getCurrentProfile, getCurrentWeight, profileAge } from './profileGoals';
import { loadWeeklySummary, type WeeklySummary } from './weeklySummary';

export type PreviewTone = 'ok' | 'warn' | 'block';
export type PreviewKey = 'profile' | 'goals' | 'diary' | 'catalog';

/** Una fila de la vista previa del contexto: resumen en una línea y detalle desplegable. */
export interface ContextPreviewRow {
  key: PreviewKey;
  label: string;
  summary: string;
  /** Aviso corto que acompaña al resumen («2 sin nutrientes»). */
  note: string | null;
  tone: PreviewTone;
  details: string[];
}

export interface ContextPreviewInput {
  profile: Pick<Profile, 'sex' | 'heightCm' | 'trainingDaysPerWeek' | 'mealRoutine'> | null;
  ageYears: number | null;
  weight: { weightKg: number; date: IsoDate } | null;
  goal: Pick<NutritionGoal, 'objective' | 'targets'> | null;
  /** Opcional: sin registros no se envía ni se muestra. */
  weeklySummary?: WeeklySummary | null;
  foods: Pick<Food, 'name' | 'brand' | 'nutrientsPer100' | 'verificationStatus' | 'deletedAt'>[];
}

const OBJECTIVE_TEXT: Record<Objective, string> = { maintain: 'Mantener', fat_loss: 'Perder grasa', muscle_gain: 'Ganar masa muscular' };
const numberFormats = [0, 1].map((digits) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }));
const fmt = (n: number, digits: 0 | 1 = 0) => numberFormats[digits].format(n);
const MAIN_NUTRIENTS = ['energyKcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
const foodLabel = (food: Pick<Food, 'name' | 'brand'>) => (food.brand ? `${food.name} (${food.brand})` : food.name);

export function buildContextPreview(input: ContextPreviewInput): ContextPreviewRow[] {
  const rows: ContextPreviewRow[] = [];
  const { profile, weight } = input;

  if (!profile || !weight || input.ageYears === null) {
    rows.push({
      key: 'profile', label: 'Perfil', tone: 'block', details: [],
      summary: 'Sin perfil', note: !profile ? 'Complétalo en Configuración para poder exportar' : 'Falta la edad o el peso',
    });
  } else {
    rows.push({
      key: 'profile', label: 'Perfil', tone: 'ok', note: null,
      details: profile.mealRoutine ? [`Horarios: ${profile.mealRoutine}`] : [],
      summary: [
        profile.sex === 'female' ? 'Mujer' : 'Hombre', `${fmt(input.ageYears)} años`, `${fmt(profile.heightCm)} cm`,
        `${fmt(weight.weightKg, 1)} kg (${formatShortDate(weight.date)})`,
        profile.trainingDaysPerWeek ? plural(profile.trainingDaysPerWeek, 'día de entrenamiento', 'días de entrenamiento') : 'sin entrenamiento',
      ].join(' · '),
    });
  }

  if (!input.goal) {
    rows.push({
      key: 'goals', label: 'Metas', tone: 'warn', details: [],
      summary: 'Sin metas aprobadas', note: 'La IA te preguntará qué criterio usar',
    });
  } else {
    const { targets } = input.goal;
    const day = (name: string, t: typeof targets.default) =>
      `${name}: ${fmt(t.energyKcal.central)} kcal (${fmt(t.energyKcal.minTolerance)}–${fmt(t.energyKcal.maxTolerance)}) · proteína ${fmt(t.proteinG.central)} g · grasas ${fmt(t.fatG.central)} g · hidratos ${fmt(t.carbsG.central)} g · fibra ${fmt(t.fiberG.central)} g`;
    rows.push({
      key: 'goals', label: 'Metas', tone: 'ok', note: null,
      summary: `${OBJECTIVE_TEXT[input.goal.objective]} · ${fmt(targets.default.energyKcal.central)} kcal · proteína ${fmt(targets.default.proteinG.central)} g`,
      details: [
        day('General', targets.default),
        ...(targets.training ? [day('Entrenamiento', targets.training)] : []),
        ...(targets.rest ? [day('Descanso', targets.rest)] : []),
      ],
    });
  }

  const summary = input.weeklySummary;
  if (summary) {
    const daysWithData = summary.weeks.reduce((total, week) => total + week.loggedDays, 0);
    rows.push({
      key: 'diary', label: 'Últimas semanas', tone: 'ok', note: null,
      summary: `${plural(summary.weeks.length, 'semana', 'semanas')} · ${plural(daysWithData, 'día anotado', 'días anotados')}`,
      details: [
        ...summary.weeks.map((week) => [
          `Semana del ${formatShortDate(week.weekStart)}`,
          week.evaluableDays ? `${fmt(week.evaluableDays)}/7 días` : 'sin días evaluables',
          week.avgEnergyKcal !== null ? `${fmt(week.avgEnergyKcal)} kcal` : null,
          week.avgProteinG !== null ? `proteína ${fmt(week.avgProteinG)} g` : null,
          week.avgWeightKg !== null ? `${fmt(week.avgWeightKg, 1)} kg` : null,
          week.plannedMealsOnLoggedDays ? `menú seguido ${fmt(week.plannedMealsLogged)}/${fmt(week.plannedMealsOnLoggedDays)}` : null,
        ].filter(Boolean).join(' · ')),
        ...(summary.frequentRecipes.length
          ? [`Repites: ${summary.frequentRecipes.map((r) => `${r.name} (${fmt(r.times)})`).join(', ')}`] : []),
        ...(summary.plannedButNotLogged.length ? [`Planificadas sin anotar: ${summary.plannedButNotLogged.join(', ')}`] : []),
      ],
    });
  }

  const foods = input.foods.filter((food) => !food.deletedAt);
  const missing = foods.filter((food) => MAIN_NUTRIENTS.some((key) => food.nutrientsPer100[key] === null));
  const pending = foods.filter((food) => food.verificationStatus === 'pending_review');
  rows.push({
    key: 'catalog', label: 'Catálogo', tone: missing.length ? 'warn' : 'ok',
    summary: plural(foods.length, 'alimento', 'alimentos'),
    note: missing.length ? `${plural(missing.length, 'sin nutrientes completos', 'sin nutrientes completos')}` : null,
    details: [
      ...missing.map((food) => `${foodLabel(food)} · faltan nutrientes`),
      ...pending.filter((food) => !missing.includes(food)).map((food) => `${foodLabel(food)} · pendiente de verificar`),
    ],
  });

  return rows;
}

export const canExportContext = (rows: ContextPreviewRow[]) => !rows.some((row) => row.tone === 'block');

/** Lee perfil, metas y catálogo con los mismos criterios que `createProfileContext`, sin escribir nada. */
export async function loadContextPreview(db: MiNutricionDB, date = new Date()): Promise<ContextPreviewRow[]> {
  const today = localIsoDate(date);
  const [profile, weight, goal, foods, weeklySummary] = await Promise.all([
    getCurrentProfile(db), getCurrentWeight(db), getActiveGoal(db), db.foods.toArray(), loadWeeklySummary(db, date),
  ]);
  return buildContextPreview({ profile, ageYears: profile ? profileAge(profile, today) : null, weight, goal, foods, weeklySummary });
}
