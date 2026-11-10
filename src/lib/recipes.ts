import { newBase, nowIso, type MiNutricionDB } from '../db/db';
import type { Nutrients, Recipe, RecipeIngredient } from '../db/types';
import { foodName, mapNutrients } from './catalog';

export type IngredientInput = Pick<RecipeIngredient, 'foodId' | 'quantity' | 'unit' |
  'state' | 'equivalenceId' | 'isOptional'>;
type RecipeInput = Pick<Recipe, 'name' | 'servings' | 'totalCookedWeightG' | 'prepTimeMin' | 'instructions'>;

export const recipeRoot = (recipe: Recipe) => recipe.parentRecipeId ?? recipe.id;
export const quantityLabel = { g: 'g', ml: 'ml', unit: 'unidad(es)', portion: 'porción(es)' };

export function recipeVersions(recipes: Recipe[], root: string): Recipe[] {
  return recipes.filter((recipe) => !recipe.deletedAt && recipeRoot(recipe) === root)
    .sort((a, b) => b.version - a.version);
}

export function latestRecipes(recipes: Recipe[]): Recipe[] {
  const byRoot = new Map<string, Recipe>();
  for (const recipe of recipes) {
    if (recipe.deletedAt) continue;
    const root = recipeRoot(recipe);
    if ((byRoot.get(root)?.version ?? 0) < recipe.version) byRoot.set(root, recipe);
  }
  return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name, 'es-ES'));
}

export function scaleNutrients(nutrients: Nutrients, factor: number): Nutrients {
  return mapNutrients((key) => {
    const n = nutrients[key];
    return n == null ? null : n * factor;
  });
}

export function nutrientsPerServing(recipe: Recipe, ingredients: RecipeIngredient[]): Nutrients {
  return mapNutrients((key) => {
    if (!ingredients.length) return null;
    let total = 0;
    for (const ingredient of ingredients) {
      const value = ingredient.snapshot?.nutrients[key];
      if (value == null) return null;
      total += value / recipe.servings;
    }
    return total;
  });
}

export async function saveRecipe(
  db: MiNutricionDB,
  input: RecipeInput,
  ingredients: IngredientInput[],
  previous?: Recipe,
  now = nowIso(),
): Promise<Recipe> {
  const name = input.name.trim();
  if (!name || !Number.isFinite(input.servings) || input.servings <= 0 || !ingredients.length) {
    throw new Error('Indica un nombre, un número de raciones mayor que cero y al menos un ingrediente.');
  }
  if (input.totalCookedWeightG !== null && (!Number.isFinite(input.totalCookedWeightG) || input.totalCookedWeightG <= 0)) {
    throw new Error('El peso cocinado debe ser mayor que cero.');
  }
  if (input.prepTimeMin !== null && (!Number.isFinite(input.prepTimeMin) || input.prepTimeMin < 0)) {
    throw new Error('El tiempo de preparación debe ser positivo o cero.');
  }

  return db.transaction('rw', db.recipes, db.recipeIngredients, db.foods, db.foodEquivalences, async () => {
    const root = previous ? recipeRoot(previous) : null;
    if (previous && root) {
      const original = await db.recipes.get(root);
      const versions = await db.recipes.where('parentRecipeId').equals(root).toArray();
      if (!original || recipeVersions([original, ...versions], root)[0]?.id !== previous.id) {
        throw new Error('Hay una versión más reciente. Ábrela antes de guardar cambios.');
      }
    }
    const recipe: Recipe = {
      ...newBase(now), ...input, name, parentRecipeId: root, version: (previous?.version ?? 0) + 1,
      useCountByMealSlot: {}, lastUsedAt: null, lastUsedQuantityAndUnit: null,
    };
    const rows = await Promise.all(ingredients.map(async (ingredient, sortOrder): Promise<RecipeIngredient> => {
      const food = await db.foods.get(ingredient.foodId);
      if (!food || food.deletedAt) throw new Error('Selecciona un alimento del catálogo para cada ingrediente.');
      if (!Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0) {
        throw new Error(`Indica una cantidad mayor que cero para ${food.name}.`);
      }
      if (food.defaultState && food.defaultState !== ingredient.state) {
        throw new Error(`Elige la ficha de ${food.name} que corresponda al estado en que lo has medido.`);
      }
      let amountPerUnit = 1;
      let unitLabel = quantityLabel[ingredient.unit];
      if (ingredient.unit === 'unit' || ingredient.unit === 'portion') {
        const equivalent = ingredient.equivalenceId ? await db.foodEquivalences.get(ingredient.equivalenceId) : undefined;
        if (!equivalent || equivalent.deletedAt || equivalent.foodId !== food.id ||
          equivalent.baseQuantity === null || !Number.isFinite(equivalent.baseQuantity) || equivalent.baseQuantity <= 0) {
          throw new Error(`Elige una equivalencia vigente para ${food.name}.`);
        }
        amountPerUnit = equivalent.baseQuantity;
        unitLabel = equivalent.label;
      } else if (ingredient.unit !== food.baseUnit) {
        throw new Error(`La cantidad de ${food.name} debe indicarse en ${food.baseUnit} o mediante una equivalencia.`);
      }
      const factor = (ingredient.quantity / 100) * amountPerUnit;
      if (!Number.isFinite(factor)) throw new Error(`La cantidad de ${food.name} es demasiado grande.`);
      return {
        ...newBase(now), ...ingredient, recipeId: recipe.id, sortOrder,
        snapshot: {
          name: foodName(food), unitLabel, nutrients: scaleNutrients(food.nutrientsPer100, factor),
          pendingReview: food.verificationStatus === 'pending_review',
        },
      };
    }));
    await db.recipes.add(recipe);
    await db.recipeIngredients.bulkAdd(rows);
    return recipe;
  });
}
