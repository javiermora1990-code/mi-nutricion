/**
 * Resumen legible del contexto que se envía a la IA: una tabla por bloque, solo con lo importante.
 * No escribe en la base de datos ni importa piezas de interfaz.
 */
import type { MiNutricionDB } from '../db/db';
import type {
  DayTargets, Food, InventoryBatch, IsoDate, NutritionGoal, Objective, Profile, Recipe, RecipeIngredient,
} from '../db/types';
import { formatShortDate, localIsoDate } from './dates';
import { getActiveGoal, getCurrentProfile, getCurrentWeight, profileAge } from './profileGoals';
import { latestRecipes, nutrientsPerServing } from './recipes';
import { loadWeeklySummary, type WeeklySummary } from './weeklySummary';

export type SummaryTone = 'ok' | 'warn' | 'block';
export type SectionKey = 'profile' | 'goals' | 'weeks' | 'pantry' | 'recipes' | 'catalog';

/** Un bloque del resumen: título, aviso opcional y una tabla sencilla. */
export interface SummarySection {
  key: SectionKey;
  title: string;
  /** Texto corto junto al título («Mantener», «120 alimentos»). */
  subtitle: string | null;
  tone: SummaryTone;
  /** Aviso en una línea; `null` si todo está bien. */
  note: string | null;
  /** Cabecera de columnas; vacía para tablas de dos columnas «dato · valor». */
  columns: string[];
  rows: string[][];
  /** Líneas finales («y 4 más», pistas). */
  footer: string[];
}

export interface ContextSummary {
  sections: SummarySection[];
  canExport: boolean;
}

type PantryLine = { name: string; quantity: number; unit: InventoryBatch['unit']; expiryDate: IsoDate | null };
type RecipeLine = { name: string; servings: number; kcalPerServing: number | null };

export interface ContextSummaryInput {
  profile: Pick<Profile, 'sex' | 'heightCm' | 'trainingDaysPerWeek' | 'trainingType' | 'workType' | 'dailyStepsBand' | 'mealRoutine'> | null;
  ageYears: number | null;
  weight: { weightKg: number; date: IsoDate } | null;
  goal: Pick<NutritionGoal, 'objective' | 'targets'> | null;
  weeklySummary?: WeeklySummary | null;
  pantry?: PantryLine[];
  recipes?: RecipeLine[];
  foods: Pick<Food, 'name' | 'brand' | 'nutrientsPer100' | 'verificationStatus' | 'deletedAt'>[];
}

/** Filas máximas por tabla: el resumen se lee de un vistazo. */
export const MAX_ROWS = 8;
const SIN_DATO = 'Sin dato';

const OBJECTIVE_TEXT: Record<Objective, string> = { maintain: 'Mantener', fat_loss: 'Perder grasa', muscle_gain: 'Ganar masa muscular' };
const WORK_TEXT: Record<Profile['workType'], string> = { seated: 'Sentado', standing: 'De pie', physical: 'Físico' };
const STEPS_TEXT: Record<string, string> = {
  '<5000': 'Menos de 5.000', '5000-7500': '5.000–7.500', '7500-10000': '7.500–10.000', '>10000': 'Más de 10.000',
};
const TRAINING_TEXT: Record<string, string> = { weights: 'pesas', cardio: 'cardio', mixed: 'mixto' };
const UNIT_TEXT: Record<InventoryBatch['unit'], string> = { g: 'g', ml: 'ml', unit: 'ud.' };
const MAIN_NUTRIENTS = ['energyKcal', 'proteinG', 'carbsG', 'fatG', 'fiberG'] as const;

const numberFormats = [0, 1].map((digits) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: digits }));
const fmt = (n: number, digits: 0 | 1 = 0) => numberFormats[digits].format(n);
const orSinDato = (n: number | null, suffix = '', digits: 0 | 1 = 0) => (n === null ? SIN_DATO : `${fmt(n, digits)}${suffix}`);
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;
const foodLabel = (food: Pick<Food, 'name' | 'brand'>) => (food.brand ? `${food.name} (${food.brand})` : food.name);
const more = (total: number) => (total > MAX_ROWS ? [`y ${fmt(total - MAX_ROWS)} más`] : []);

function profileSection(input: ContextSummaryInput): SummarySection {
  const { profile, weight, ageYears } = input;
  const base = { key: 'profile' as const, title: 'Perfil', subtitle: null, columns: [], footer: [] };
  if (!profile || !weight || ageYears === null) {
    return {
      ...base, tone: 'block', rows: [],
      note: !profile ? 'Sin perfil. Complétalo en Configuración para poder exportar.' : 'Falta la edad o el peso en tu perfil.',
    };
  }
  const days = profile.trainingDaysPerWeek;
  return {
    ...base, tone: 'ok', note: null,
    rows: [
      ['Sexo', profile.sex === 'female' ? 'Mujer' : 'Hombre'],
      ['Edad', `${fmt(ageYears)} años`],
      ['Estatura', `${fmt(profile.heightCm)} cm`],
      ['Peso', `${fmt(weight.weightKg, 1)} kg · ${formatShortDate(weight.date)}`],
      ['Entrenamiento', days ? `${plural(days, 'día', 'días')} · ${TRAINING_TEXT[profile.trainingType] ?? profile.trainingType}` : 'No entrena'],
      ['Trabajo', WORK_TEXT[profile.workType]],
      ['Pasos al día', STEPS_TEXT[profile.dailyStepsBand] ?? profile.dailyStepsBand],
      ...(profile.mealRoutine ? [['Horarios', profile.mealRoutine]] : []),
    ],
  };
}

function goalsSection(goal: ContextSummaryInput['goal']): SummarySection {
  const base = { key: 'goals' as const, title: 'Metas', footer: [] };
  if (!goal) {
    return { ...base, subtitle: null, tone: 'warn', columns: [], rows: [], note: 'Sin metas aprobadas. La IA te preguntará qué criterio usar.' };
  }
  const days: [string, DayTargets][] = [['General', goal.targets.default]];
  if (goal.targets.training) days.push(['Entreno', goal.targets.training]);
  if (goal.targets.rest) days.push(['Descanso', goal.targets.rest]);
  const row = (label: string, key: keyof DayTargets) => [label, ...days.map(([, t]) => fmt(t[key].central))];
  return {
    ...base, subtitle: OBJECTIVE_TEXT[goal.objective], tone: 'ok', note: null,
    columns: ['', ...days.map(([name]) => name)],
    rows: [
      row('Energía (kcal)', 'energyKcal'), row('Proteína (g)', 'proteinG'), row('Hidratos (g)', 'carbsG'),
      row('Grasas (g)', 'fatG'), row('Fibra (g)', 'fiberG'),
    ],
  };
}

function weeksSection(summary: WeeklySummary): SummarySection {
  return {
    key: 'weeks', title: 'Últimas semanas', subtitle: null, tone: 'ok', note: null,
    columns: ['Semana', 'Días', 'kcal', 'Proteína', 'Peso'],
    rows: summary.weeks.map((week) => [
      formatShortDate(week.weekStart), `${fmt(week.evaluableDays)}/7`,
      orSinDato(week.avgEnergyKcal), orSinDato(week.avgProteinG, ' g'), orSinDato(week.avgWeightKg, ' kg', 1),
    ]),
    footer: [
      ...(summary.frequentRecipes.length ? [`Repites: ${summary.frequentRecipes.map((r) => r.name).join(', ')}`] : []),
      ...(summary.plannedButNotLogged.length ? [`Planificadas sin anotar: ${summary.plannedButNotLogged.join(', ')}`] : []),
    ],
  };
}

function pantrySection(pantry: PantryLine[]): SummarySection {
  const sorted = [...pantry].sort((a, b) =>
    (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999') || a.name.localeCompare(b.name, 'es'));
  return {
    key: 'pantry', title: 'Despensa', subtitle: pantry.length ? plural(pantry.length, 'producto', 'productos') : null,
    tone: 'ok', note: pantry.length ? null : 'Vacía. La IA no supondrá que tienes nada en casa.',
    columns: pantry.length ? ['Producto', 'Cantidad', 'Caduca'] : [],
    rows: sorted.slice(0, MAX_ROWS).map((item) => [
      item.name, `${fmt(item.quantity)} ${UNIT_TEXT[item.unit]}`, item.expiryDate ? formatShortDate(item.expiryDate) : '—',
    ]),
    footer: more(pantry.length),
  };
}

function recipesSection(recipes: RecipeLine[]): SummarySection {
  return {
    key: 'recipes', title: 'Recetas', subtitle: recipes.length ? plural(recipes.length, 'receta', 'recetas') : null,
    tone: 'ok', note: recipes.length ? null : 'Todavía no tienes recetas guardadas.',
    columns: recipes.length ? ['Receta', 'Raciones', 'kcal/ración'] : [],
    rows: recipes.slice(0, MAX_ROWS).map((recipe) => [recipe.name, fmt(recipe.servings), orSinDato(recipe.kcalPerServing)]),
    footer: more(recipes.length),
  };
}

function catalogSection(allFoods: ContextSummaryInput['foods']): SummarySection {
  const foods = allFoods.filter((food) => !food.deletedAt);
  const missing = foods.filter((food) => MAIN_NUTRIENTS.some((key) => food.nutrientsPer100[key] === null));
  const pending = foods.filter((food) => food.verificationStatus === 'pending_review' && !missing.includes(food));
  const flagged = [
    ...missing.map((food) => [foodLabel(food), 'Faltan nutrientes']),
    ...pending.map((food) => [foodLabel(food), 'Pendiente de verificar']),
  ];
  return {
    key: 'catalog', title: 'Catálogo', subtitle: plural(foods.length, 'alimento', 'alimentos'),
    tone: missing.length ? 'warn' : 'ok',
    note: missing.length ? `${plural(missing.length, 'alimento', 'alimentos')} sin nutrientes completos.` : null,
    columns: flagged.length ? ['Alimento', 'Aviso'] : [],
    rows: flagged.slice(0, MAX_ROWS),
    footer: more(flagged.length),
  };
}

export function buildContextSummary(input: ContextSummaryInput): ContextSummary {
  const sections = [
    profileSection(input),
    goalsSection(input.goal),
    ...(input.weeklySummary ? [weeksSection(input.weeklySummary)] : []),
    ...(input.pantry ? [pantrySection(input.pantry)] : []),
    ...(input.recipes ? [recipesSection(input.recipes)] : []),
    catalogSection(input.foods),
  ];
  return { sections, canExport: !sections.some((section) => section.tone === 'block') };
}

/** Agrupa los lotes disponibles por alimento y unidad, como en el contexto exportado. */
export function pantryLines(batches: InventoryBatch[], foods: Pick<Food, 'id' | 'name'>[]): PantryLine[] {
  const lines = new Map<string, PantryLine>();
  for (const batch of batches) {
    if (batch.deletedAt || batch.status !== 'available' || batch.remainingQuantity <= 0) continue;
    const food = foods.find((f) => f.id === batch.foodId);
    if (!food) continue;
    const key = `${food.id}|${batch.unit}`;
    const line = lines.get(key) ?? { name: food.name, quantity: 0, unit: batch.unit, expiryDate: null };
    line.quantity += batch.remainingQuantity;
    if (batch.expiryDate && (!line.expiryDate || batch.expiryDate < line.expiryDate)) line.expiryDate = batch.expiryDate;
    lines.set(key, line);
  }
  return [...lines.values()];
}

export function recipeLines(recipes: Recipe[], ingredients: RecipeIngredient[]): RecipeLine[] {
  return latestRecipes(recipes).map((recipe) => ({
    name: recipe.name, servings: recipe.servings,
    kcalPerServing: nutrientsPerServing(recipe, ingredients.filter((i) => !i.deletedAt && i.recipeId === recipe.id)).energyKcal,
  }));
}

/** Lee lo mismo que `createProfileContext`, sin escribir nada. */
export async function loadContextSummary(db: MiNutricionDB, date = new Date()): Promise<ContextSummary> {
  const today = localIsoDate(date);
  const [profile, weight, goal, foods, weeklySummary, batches, recipes, ingredients] = await Promise.all([
    getCurrentProfile(db), getCurrentWeight(db), getActiveGoal(db), db.foods.toArray(), loadWeeklySummary(db, date),
    db.inventoryBatches.toArray(), db.recipes.toArray(), db.recipeIngredients.toArray(),
  ]);
  return buildContextSummary({
    profile, ageYears: profile ? profileAge(profile, today) : null, weight, goal, weeklySummary,
    pantry: pantryLines(batches, foods.filter((food) => !food.deletedAt)),
    recipes: recipeLines(recipes, ingredients),
    foods,
  });
}
