import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, DB_SCHEMA_VERSION, newBase, type MiNutricionDB } from '../src/db/db';
import type { Food } from '../src/db/types';
import { mapNutrients, saveFood, searchFoods, seedCatalog, type FoodDetails } from '../src/lib/catalog';
import { readOffResults, searchOpenFoodFacts } from '../src/lib/openFoodFacts';
import { latestRecipes, nutrientsPerServing, recipeVersions, saveRecipe, scaleNutrients, type IngredientInput } from '../src/lib/recipes';

const when = '2026-01-01T00:00:00Z';
const foodDetails: FoodDetails = {
  name: 'Alimento ficticio', brand: null, kind: 'generic', category: null, baseUnit: 'g',
  defaultState: 'raw', source: 'user_label', externalId: null, sourceVersion: null,
  sourceFetchedAt: null, verificationStatus: 'verified',
  nutrientsPer100: { ...mapNutrients(() => null), energyKcal: 200, proteinG: 10, fatG: 0 },
};
const recipeInput = { name: 'Receta de prueba', servings: 2, totalCookedWeightG: 150, prepTimeMin: null, instructions: [] };
const ingredient = (food: Food, overrides?: Partial<IngredientInput>): IngredientInput => ({
  foodId: food.id, quantity: 100, unit: food.baseUnit, state: 'raw', isOptional: false, ...overrides,
});
const offFixture = { products: [
  { code: '0123456789123', product_name: 'Test', product_name_es: 'Producto ficticio', brands: 'Marca ficticia',
    last_modified_t: 1234567890, nutriments: {
      'energy-kj_100g': 418.4, proteins_100g: '3.5', fat_100g: 0, fiber_100g: '', sugars_100g: -1, salt_serving: 0.2,
    } },
  { code: '0123456789123', product_name: 'Duplicado' },
  { code: '987', product_name_es: '   ', product_name: 'Sin nutrientes' },
  { product_name: 'Sin identificador' },
] };

let db: MiNutricionDB;
beforeEach(() => { db = createDb(`stage3-${crypto.randomUUID()}`); });
afterEach(async () => { vi.unstubAllGlobals(); await db.delete(); });

describe('Catálogo local', () => {
  it('carga una sola vez 118 fichas USDA de ocho categorías, con referencias y medidas', async () => {
    await Promise.all([seedCatalog(db, when), seedCatalog(db, when)]);
    expect(DB_SCHEMA_VERSION).toBe(1);
    const foods = await db.foods.toArray();
    expect(foods).toHaveLength(118);
    expect(new Set(foods.map((food) => food.category)).size).toBe(8);
    expect(new Set(foods.map((food) => food.externalId)).size).toBe(118);
    expect(foods.every((food) => food.source === 'usda' && /^\d+$/.test(food.externalId ?? ''))).toBe(true);
    const egg = foods.find((food) => food.externalId === '171287')!;
    expect(egg.nutrientsPer100).toMatchObject({ energyKcal: 143, carbsG: 0.72 });
    expect(await db.foodEquivalences.where('foodId').equals(egg.id).toArray()).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: expect.stringMatching(/Huevo M/), baseQuantity: 50 }),
      expect.objectContaining({ label: expect.stringMatching(/Huevo L/), baseQuantity: 56 }),
    ]));
    const rice = foods.find((food) => food.externalId === '169756')!;
    expect(await db.foodEquivalences.where('foodId').equals(rice.id).toArray()).toEqual(expect.arrayContaining([
      expect.objectContaining({ rawToCookedYieldFactor: expect.any(Number), precision: 'approximate' }),
    ]));
  });

  it('conserva los datos existentes y las ediciones de una ficha de semilla', async () => {
    await db.appSettings.add({ ...newBase(when), key: 'ajuste-existente', value: true });
    await seedCatalog(db, when);
    const initial = (await db.foods.where('externalId').equals('171287').first())!;
    const edited = await saveFood(db, { ...initial, name: 'Huevo de prueba' }, initial);
    await seedCatalog(db);
    expect(await db.foods.get(initial.id)).toEqual(edited);
    expect(await db.appSettings.get({ key: 'ajuste-existente' })).toMatchObject({ value: true });
  });

  it('busca sin tildes por nombre, marca e identificador y omite las bajas', async () => {
    await seedCatalog(db, when);
    const local = await saveFood(db, { ...foodDetails, name: 'Ñoquis de prueba', brand: 'Fictícia', externalId: 'ABC' });
    const foods = await db.foods.toArray();
    expect(searchFoods(foods, 'noquis ficticia ABC')).toEqual([local]);
    expect(searchFoods(foods, 'platano')[0]?.externalId).toBe('173944');
    expect(searchFoods([{ ...local, deletedAt: when }], 'noquis')).toEqual([]);
  });

  it('versiona las equivalencias, protege ediciones concurrentes y conserva los null', async () => {
    const measure = { label: 'Taza', baseQuantity: 100, rawToCookedYieldFactor: null, source: 'Prueba', precision: 'approximate' } as const;
    const original = await saveFood(db, foodDetails, undefined, [measure], when);
    const edited = await saveFood(db, foodDetails, original, [{ ...measure, label: ' taza ', baseQuantity: 120 }], when);
    await expect(saveFood(db, foodDetails, original)).rejects.toThrow('ha cambiado');
    const entries = await db.foodEquivalences.where('foodId').equals(edited.id).sortBy('version');
    expect(entries).toMatchObject([{ version: 1, deletedAt: when }, { version: 2, deletedAt: null, baseQuantity: 120 }]);
    expect(edited.nutrientsPer100).toMatchObject({ fatG: 0, fiberG: null, sugarsG: null });
  });
});

describe('Open Food Facts', () => {
  it('lee solo datos normalizados por 100, respeta ceros y conserva origen y fecha', () => {
    const results = readOffResults(offFixture, when);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      name: 'Producto ficticio', brand: 'Marca ficticia', externalId: '0123456789123',
      source: 'off', sourceFetchedAt: when, sourceVersion: '1234567890', verificationStatus: 'pending_review',
      nutrientsPer100: { proteinG: 3.5, fatG: 0, fiberG: null, sugarsG: null, saltG: null },
    });
    expect(results[0].nutrientsPer100.energyKcal).toBeCloseTo(100);
    expect(results[1].nutrientsPer100).toEqual(mapNutrients(() => null));
    expect(() => readOffResults({ error: true })).toThrow('respuesta inesperada');
  });

  it('envía consultas explícitas por nombre, marca o código y explica un fallo del servidor', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ hits: offFixture.products }))
      .mockResolvedValueOnce(Response.json(offFixture)).mockResolvedValueOnce(Response.json({ product: offFixture.products[0] }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchOpenFoodFacts(' Marca & producto ', 'name')).resolves.toHaveLength(2);
    expect(fetchMock.mock.calls[0][0].searchParams.get('q')).toBe('Marca & producto');
    await expect(searchOpenFoodFacts('Marca Fictícia', 'brand')).resolves.toHaveLength(2);
    expect(fetchMock.mock.calls[1][0].searchParams.get('brands_tags')).toBe('marca-ficticia');
    await expect(searchOpenFoodFacts('0123456789123', 'barcode')).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls[2][0].pathname).toBe('/api/v2/product/0123456789123.json');
    await expect(searchOpenFoodFacts('Marca', 'brand')).rejects.toThrow('no está disponible');
  });

  it('deduplica guardados concurrentes y conserva una ficha local verificada', async () => {
    const [draft] = readOffResults(offFixture, when);
    const [first, second] = await Promise.all([saveFood(db, draft), saveFood(db, draft)]);
    expect(first.id).toBe(second.id);
    const verified = await saveFood(db, { ...draft, verificationStatus: 'verified' }, first);
    expect(await saveFood(db, draft)).toEqual(verified);
    expect(await db.foods.count()).toBe(1);
  });
});

describe('Recetas versionadas', () => {
  it('calcula por ración usando gramos y medidas, escala y mantiene ausencias', async () => {
    const food = await saveFood(db, foodDetails, undefined, [{
      label: 'Rebanada', baseQuantity: 25, rawToCookedYieldFactor: null, source: 'Prueba', precision: 'exact',
    }]);
    const [slice] = await db.foodEquivalences.toArray();
    const recipe = await saveRecipe(db, recipeInput, [ingredient(food),
      ingredient(food, { quantity: 2, unit: 'unit', equivalenceId: slice.id })]);
    const ingredients = await db.recipeIngredients.where('recipeId').equals(recipe.id).sortBy('sortOrder');
    expect(ingredients[1].snapshot?.unitLabel).toBe('Rebanada');
    const nutrients = nutrientsPerServing(recipe, ingredients);
    expect(nutrients).toMatchObject({ energyKcal: 150, proteinG: 7.5, fatG: 0, fiberG: null });
    expect(scaleNutrients(nutrients, 3)).toMatchObject({ energyKcal: 450, proteinG: 22.5, fiberG: null });
  });

  it('mantiene instantáneas antiguas aunque cambie el catálogo y solo permite una nueva versión a la vez', async () => {
    const food = await saveFood(db, foodDetails);
    const v1 = await saveRecipe(db, recipeInput, [ingredient(food)]);
    await saveFood(db, { ...foodDetails, name: 'Ficha editada', nutrientsPer100: { ...food.nutrientsPer100, energyKcal: 300 } }, food);
    const results = await Promise.allSettled([
      saveRecipe(db, recipeInput, [ingredient(food)], v1),
      saveRecipe(db, recipeInput, [ingredient(food)], v1),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const versions = recipeVersions(await db.recipes.toArray(), v1.id);
    expect(versions.map((recipe) => recipe.version)).toEqual([2, 1]);
    expect(latestRecipes(versions)).toEqual([versions[0]]);
    const [oldIngredient] = await db.recipeIngredients.where('recipeId').equals(v1.id).toArray();
    expect(oldIngredient.snapshot).toMatchObject({ name: food.name, nutrients: { energyKcal: 200 } });
    const current = await db.recipeIngredients.where('recipeId').equals(versions[0].id).toArray();
    expect(nutrientsPerServing(versions[0], current).energyKcal).toBe(150);
  });

  it('rechaza referencias, estados o medidas incompatibles sin guardar una receta parcial', async () => {
    const food = await saveFood(db, foodDetails);
    await expect(saveRecipe(db, recipeInput, [ingredient(food), ingredient(food, { foodId: 'ausente' })])).rejects.toThrow('catálogo');
    await expect(saveRecipe(db, recipeInput, [ingredient(food, { state: 'cooked' })])).rejects.toThrow('estado');
    await expect(saveRecipe(db, recipeInput, [ingredient(food, { unit: 'ml' })])).rejects.toThrow('equivalencia');
    await expect(saveRecipe(db, recipeInput, [ingredient(food, { unit: 'unit' })])).rejects.toThrow('equivalencia');
    expect(await db.recipes.count()).toBe(0);
    expect(await db.recipeIngredients.count()).toBe(0);
  });
});
