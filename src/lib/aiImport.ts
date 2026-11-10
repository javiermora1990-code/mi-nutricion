import { newBase, nowIso, type MiNutricionDB } from '../db/db';
import type { Food, FoodEquivalence, MealPlan, Nutrients } from '../db/types';
import { aiProposalSchema, type AiProposalDocument } from '../schemas/aiProposal';
import { foodQuantity, mapNutrients, saveFood } from './catalog';
import { snapshotPlanItem } from './planning';
import { saveRecipe, scaleNutrients } from './recipes';

export type ProposedRecipe = NonNullable<AiProposalDocument['payload']['recipes']>[number];
export type ProposedFood = NonNullable<AiProposalDocument['payload']['catalogItems']>[number];
export type ProposedPlan = NonNullable<AiProposalDocument['payload']['mealPlan']>;

export const newFoodRef = (index: number) => `catalog:${index}`;
const normalized = (name: string) => name.trim().toLocaleLowerCase('es-ES');
const planKey = (date: string, mealSlot: string) => `${date}|${mealSlot}`;

export interface ProposalReview {
  document: AiProposalDocument;
  conflicts: MealPlan[];
}

export function previewRecipeNutrients(
  recipe: ProposedRecipe, foods: Food[], equivalents: FoodEquivalence[], proposed: ProposedFood[],
): Nutrients {
  const ingredients = recipe.ingredients.map((ingredient) => {
    const food = foods.find((food) => food.id === ingredient.foodId) ??
      proposed.map((food, i) => ({ ...food, id: newFoodRef(i) })).find((food) => food.id === ingredient.foodId);
    if (!food || (food.defaultState && food.defaultState !== ingredient.state)) return mapNutrients(() => null);
    try {
      const equivalent = equivalents.find((e) => e.id === ingredient.equivalenceId);
      const amount = foodQuantity(food, ingredient.quantity, ingredient.unit, equivalent);
      return scaleNutrients(food.nutrientsPer100, amount.baseQuantity / 100);
    } catch { return mapNutrients(() => null); }
  });
  return mapNutrients((key) => {
    if (!Number.isFinite(recipe.servings) || recipe.servings <= 0 || !ingredients.length) return null;
    let total = 0;
    for (const ingredient of ingredients) {
      const value = ingredient[key];
      if (value == null) return null;
      total += value / recipe.servings;
    }
    return Number.isFinite(total) ? total : null;
  });
}

function validateProposal(document: AiProposalDocument): void {
  const payload = document.payload;
  if (payload.goalAdjustment) throw new Error('Esta propuesta incluye ajustes de metas. Pide a la IA un archivo solo con recetas, menú y alimentos.');
  if (!(payload.recipes?.length || payload.catalogItems?.length || payload.mealPlan?.days.some((day) => day.meals.some((meal) => meal.items.length)))) {
    throw new Error('La propuesta no contiene recetas, alimentos ni tomas para importar.');
  }
  const recipeIds = payload.recipes?.map((recipe) => recipe.tempId) ?? [];
  if (new Set(recipeIds).size !== recipeIds.length) throw new Error('Hay identificadores de recetas repetidos en el archivo.');
  const foodNames = payload.catalogItems?.map((food) => normalized(food.name)) ?? [];
  if (new Set(foodNames).size !== foodNames.length) throw new Error('Hay alimentos nuevos con el mismo nombre. Pide nombres distintos a la IA.');
  const versions = payload.recipes?.map((recipe) => recipe.existingRecipeId).filter(Boolean) ?? [];
  if (new Set(versions).size !== versions.length) throw new Error('El archivo intenta revisar dos veces la misma receta.');
  const plan = payload.mealPlan;
  if (!plan) return;
  if (plan.startDate > plan.endDate) throw new Error('El intervalo de fechas del menú está invertido.');
  const slots = new Set<string>();
  const dates = new Set<string>();
  for (const day of plan.days) {
    if (dates.has(day.date)) throw new Error('El menú repite una fecha. Agrupa sus tomas en un único día.');
    dates.add(day.date);
    if (day.date < plan.startDate || day.date > plan.endDate) throw new Error('El menú contiene un día fuera de su intervalo.');
    for (const meal of day.meals) {
      const key = planKey(day.date, meal.mealSlot);
      if (slots.has(key)) throw new Error('El menú repite una toma en la misma fecha.');
      slots.add(key);
    }
  }
}

async function planConflicts(db: MiNutricionDB, document: AiProposalDocument): Promise<MealPlan[]> {
  const keys = new Set(document.payload.mealPlan?.days.flatMap((day) => day.meals.map((meal) => planKey(day.date, meal.mealSlot))));
  return db.mealPlans.filter((plan) => !plan.deletedAt && keys.has(planKey(plan.date, plan.mealSlot))).toArray();
}

export async function prepareProposal(db: MiNutricionDB, input: unknown): Promise<ProposalReview> {
  const document = aiProposalSchema.parse(input);
  validateProposal(document);
  const previous = await db.aiExchangeLog.get({ externalJsonId: document.id });
  if (previous && !(previous.direction === 'import' && (previous.status === 'test' || previous.status === 'previewed'))) {
    throw new Error('Este documento ya se ha importado o registrado. Elige una propuesta con un identificador nuevo.');
  }
  const foods = await db.foods.filter((food) => !food.deletedAt).toArray();
  const options = [
    ...foods.map((food) => ({ id: food.id, name: food.name })),
    ...(document.payload.catalogItems ?? []).map((food, i) => ({ id: newFoodRef(i), name: food.name })),
  ];
  function findFood(name: string): string | null {
    const matches = options.filter((food) => normalized(food.name) === normalized(name));
    return matches.length === 1 ? matches[0].id : null;
  }
  for (const recipe of document.payload.recipes ?? []) {
    for (const ingredient of recipe.ingredients) {
      if (!ingredient.foodId) ingredient.foodId = findFood(ingredient.proposedName);
    }
  }
  for (const day of document.payload.mealPlan?.days ?? []) {
    for (const meal of day.meals) {
      for (const item of meal.items) {
        if (item.itemType === 'food' && !options.some((food) => food.id === item.refId)) {
          item.refId = findFood(item.refId) ?? item.refId;
        }
      }
    }
  }
  return { document, conflicts: await planConflicts(db, document) };
}

const conflictSignature = (plans: MealPlan[]) => plans.map((plan) => `${plan.id}|${plan.revision}`).sort().join(',');

/** Único punto de aplicación tras la confirmación. Un fallo revierte todas las tablas. */
export async function applyProposal(
  db: MiNutricionDB, review: ProposalReview, fileName: string, replaceMeals: boolean, now = nowIso(),
): Promise<{ recipes: number; foods: number; meals: number }> {
  const document = aiProposalSchema.parse(review.document);
  validateProposal(document);
  return db.transaction('rw', [
    db.foods, db.foodEquivalences, db.recipes, db.recipeIngredients, db.mealPlans, db.aiExchangeLog,
  ], async () => {
    const log = await db.aiExchangeLog.get({ externalJsonId: document.id });
    if (log && !(log.direction === 'import' && (log.status === 'test' || log.status === 'previewed'))) {
      throw new Error('Este documento ya se ha importado.');
    }
    const conflicts = await planConflicts(db, document);
    if (conflictSignature(conflicts) !== conflictSignature(review.conflicts)) {
      throw new Error('El menú guardado ha cambiado. Vuelve a abrir el archivo para revisar las diferencias.');
    }
    if (conflicts.length && !replaceMeals) throw new Error('Confirma la sustitución de las tomas que ya están guardadas.');

    const references = new Map<string, string>();
    let foodCount = 0;
    for (const [index, food] of (document.payload.catalogItems ?? []).entries()) {
      const saved = await saveFood(db, {
        name: food.name, brand: food.brand, kind: food.kind, category: null, baseUnit: food.baseUnit,
        defaultState: food.defaultState ?? null, source: food.source, externalId: food.externalId ?? null,
        sourceFetchedAt: null, sourceVersion: null, verificationStatus: 'pending_review',
        nutrientsPer100: food.nutrientsPer100,
      }, undefined, (food.equivalences ?? []).map((e) => ({
        ...e, rawToCookedYieldFactor: e.rawToCookedYieldFactor ?? null,
        source: `Propuesta ${document.source}`, precision: 'approximate',
      })), now);
      references.set(newFoodRef(index), saved.id);
      foodCount++;
    }
    const resolve = (ref: string) => references.get(ref) ?? ref;
    for (const recipe of document.payload.recipes ?? []) {
      if (await db.recipes.get(recipe.tempId) || references.has(recipe.tempId)) {
        throw new Error('Un identificador temporal de receta coincide con otro registro. Pide a la IA un tempId diferente.');
      }
      const previous = recipe.existingRecipeId ? await db.recipes.get(recipe.existingRecipeId) : undefined;
      if (recipe.existingRecipeId && (!previous || previous.deletedAt)) throw new Error('La receta que quieres revisar ya no está disponible.');
      const saved = await saveRecipe(db, {
        name: recipe.name, servings: recipe.servings, prepTimeMin: recipe.prepTimeMin,
        totalCookedWeightG: recipe.totalCookedWeightG, instructions: recipe.instructions,
      }, recipe.ingredients.map((ingredient) => ({
        foodId: resolve(ingredient.foodId ?? ''), quantity: ingredient.quantity,
        unit: ingredient.unit, state: ingredient.state, isOptional: ingredient.isOptional,
        equivalenceId: ingredient.equivalenceId,
      })), previous, now);
      await db.recipes.update(saved.id, { sourceJsonId: document.id });
      references.set(recipe.tempId, saved.id);
    }

    let mealCount = 0;
    for (const day of document.payload.mealPlan?.days ?? []) {
      for (const meal of day.meals) {
        const items = await Promise.all(meal.items.map((item) => snapshotPlanItem(db, { ...item, refId: resolve(item.refId) })));
        await db.mealPlans.add({
          ...newBase(now), date: day.date, mealSlot: meal.mealSlot, dayType: day.dayType, items,
          sourceJsonId: document.id, notes: null,
        });
        mealCount++;
      }
    }
    for (const plan of conflicts) {
      await db.mealPlans.update(plan.id, { deletedAt: now, updatedAt: now, revision: plan.revision + 1 });
    }
    const summary = { recipes: document.payload.recipes?.length ?? 0, foods: foodCount, meals: mealCount };
    await db.aiExchangeLog.put({
      ...(log ?? newBase(now)), updatedAt: now, revision: log ? log.revision + 1 : 1,
      externalJsonId: document.id, direction: 'import', schema: document.schema,
      formatVersion: document.formatVersion, source: document.source, fileName,
      documentCreatedAt: document.createdAt, status: 'applied',
      summary: `${summary.recipes} recetas, ${summary.foods} alimentos y ${summary.meals} tomas`,
    });
    return summary;
  });
}
