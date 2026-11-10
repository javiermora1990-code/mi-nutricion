import type { MiNutricionDB } from '../db/db';
import type { MealPlan, MealPlanItem, MealSlot, Nutrients, PlannedIngredient, RecipeIngredient } from '../db/types';
import { foodName, foodQuantity, mapNutrients } from './catalog';
import { nutrientsPerServing, scaleNutrients } from './recipes';

export const MEAL_LABELS: Record<MealSlot, string> = {
  breakfast: 'Desayuno', mid_morning: 'Media mañana', lunch: 'Comida',
  snack: 'Merienda', dinner: 'Cena', other: 'Otra toma',
};

export const MEAL_SLOTS = Object.keys(MEAL_LABELS) as MealSlot[];

export async function snapshotPlanItem(db: MiNutricionDB, item: MealPlanItem): Promise<MealPlanItem> {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('Revisa las cantidades del menú.');
  if (item.itemType === 'food') {
    const food = await db.foods.get(item.refId);
    if (!food || food.deletedAt) throw new Error('Hay un alimento del menú que falta en el catálogo.');
    const equivalent = item.equivalenceId ? await db.foodEquivalences.get(item.equivalenceId) : undefined;
    const { baseQuantity } = foodQuantity(food, item.quantity, item.unit, equivalent);
    return {
      ...item, snapshot: {
        name: foodName(food), nutrients: scaleNutrients(food.nutrientsPer100, baseQuantity / 100),
        ingredients: [{ foodId: food.id, name: foodName(food), quantity: baseQuantity, unit: food.baseUnit, state: food.defaultState }],
      },
    };
  }
  const recipe = await db.recipes.get(item.refId);
  if (!recipe || recipe.deletedAt) throw new Error('Hay una receta del menú que no está disponible.');
  let factor: number;
  if (item.unit === 'portion') factor = item.quantity / recipe.servings;
  else if (item.unit === 'g' && recipe.totalCookedWeightG !== null && recipe.totalCookedWeightG > 0) {
    factor = item.quantity / recipe.totalCookedWeightG;
  } else throw new Error(`Indica raciones para ${recipe.name}, o gramos si conoces su peso cocinado.`);
  const ingredients = await db.recipeIngredients.where('recipeId').equals(recipe.id).and((i) => !i.deletedAt).toArray();
  if (!ingredients.length) throw new Error(`La receta ${recipe.name} no tiene ingredientes.`);
  const portions = await Promise.all(ingredients.map((ingredient) => plannedIngredient(db, ingredient, factor)));
  return {
    ...item, snapshot: {
      name: `${recipe.name} · v${recipe.version}`,
      nutrients: scaleNutrients(nutrientsPerServing(recipe, ingredients), factor * recipe.servings),
      ingredients: portions,
    },
  };
}

async function plannedIngredient(db: MiNutricionDB, ingredient: RecipeIngredient, factor: number): Promise<PlannedIngredient> {
  const food = await db.foods.get(ingredient.foodId);
  let quantity = ingredient.snapshot?.baseQuantity ?? null;
  let unit = ingredient.snapshot?.baseUnit ?? null;
  // Compatibilidad con recetas de 0.3.0. Las equivalencias antiguas siguen guardadas.
  if (quantity === null && (ingredient.unit === 'g' || ingredient.unit === 'ml')) {
    quantity = ingredient.quantity;
    unit = ingredient.unit;
  }
  if (quantity === null && ingredient.equivalenceId) {
    const equivalent = await db.foodEquivalences.get(ingredient.equivalenceId);
    if (equivalent?.foodId === ingredient.foodId && equivalent.baseQuantity !== null && food) {
      quantity = ingredient.quantity * equivalent.baseQuantity;
      unit = food.baseUnit;
    }
  }
  return {
    foodId: ingredient.foodId, name: ingredient.snapshot?.name ?? food?.name ?? 'Alimento no disponible',
    quantity: quantity === null ? null : quantity * factor, unit, state: ingredient.state,
  };
}

export function planNutrients(plans: MealPlan[]): Nutrients {
  const items = plans.flatMap((plan) => plan.items);
  return mapNutrients((key) => {
    if (!items.length) return null;
    let total = 0;
    for (const item of items) {
      const value = item.snapshot?.nutrients[key];
      if (value == null) return null;
      total += value;
    }
    return Number.isFinite(total) ? total : null;
  });
}

export interface ShoppingItem extends PlannedIngredient {
  key: string;
}

/** Necesidades del menú. Las existencias de despensa se incorporarán con su módulo. */
export function shoppingList(plans: MealPlan[]): { items: ShoppingItem[]; incomplete: boolean } {
  const grouped = new Map<string, ShoppingItem>();
  let incomplete = false;
  for (const item of plans.flatMap((plan) => plan.items)) {
    if (!item.snapshot) { incomplete = true; continue; }
    for (const ingredient of item.snapshot.ingredients) {
      const key = [ingredient.foodId, ingredient.unit, ingredient.state].join('|');
      const existing = grouped.get(key);
      const quantity = ingredient.quantity;
      if (quantity === null || ingredient.unit === null) incomplete = true;
      if (existing) {
        existing.quantity = existing.quantity === null || quantity === null ? null : existing.quantity + quantity;
      } else grouped.set(key, { ...ingredient, key });
    }
  }
  return { items: [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'es-ES')), incomplete };
}
