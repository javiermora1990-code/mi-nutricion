import { newBase, nowIso, type MiNutricionDB } from '../db/db';
import type { Food, FoodEquivalence, Nutrients, QuantityUnit } from '../db/types';
import { USDA_SEED } from '../db/usdaSeed';

export const NUTRIENT_LABELS: Record<keyof Nutrients, string> = {
  energyKcal: 'Energía',
  proteinG: 'Proteínas',
  carbsG: 'Hidratos de carbono',
  fatG: 'Grasas',
  fiberG: 'Fibra',
  sugarsG: 'Azúcares',
  saturatedFatG: 'Grasas saturadas',
  saltG: 'Sal',
};

export const NUTRIENT_KEYS = Object.keys(NUTRIENT_LABELS) as (keyof Nutrients)[];

export function mapNutrients(value: (key: keyof Nutrients) => number | null): Required<Nutrients> {
  return {
    energyKcal: value('energyKcal'),
    proteinG: value('proteinG'),
    carbsG: value('carbsG'),
    fatG: value('fatG'),
    fiberG: value('fiberG'),
    sugarsG: value('sugarsG'),
    saturatedFatG: value('saturatedFatG'),
    saltG: value('saltG'),
  };
}

export const FOOD_CATEGORIES = Object.keys(USDA_SEED);
export const FOOD_SOURCES = {
  user_label: 'Etiqueta del producto',
  bedca: 'BEDCA',
  off: 'Open Food Facts',
  usda: 'USDA FoodData Central',
  estimate: 'Estimación',
} satisfies Record<Food['source'], string>;
export const STATE_LABELS = { raw: 'Crudo o seco', cooked: 'Cocinado' };

export function foodQuantity(
  food: Pick<Food, 'id' | 'name' | 'baseUnit'>, quantity: number, unit: QuantityUnit, equivalent?: FoodEquivalence,
): { baseQuantity: number; unitLabel: string } {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Revisa la cantidad de ${food.name}.`);
  let amountPerUnit = 1;
  let unitLabel: string = unit;
  if (unit === 'unit' || unit === 'portion') {
    if (!equivalent || equivalent.deletedAt || equivalent.foodId !== food.id ||
      equivalent.baseQuantity === null || !Number.isFinite(equivalent.baseQuantity) || equivalent.baseQuantity <= 0) {
      throw new Error(`Elige una equivalencia vigente para ${food.name}.`);
    }
    amountPerUnit = equivalent.baseQuantity;
    unitLabel = equivalent.label;
  } else if (unit !== food.baseUnit) {
    throw new Error(`La cantidad de ${food.name} debe indicarse en ${food.baseUnit} o mediante una equivalencia.`);
  }
  const baseQuantity = quantity * amountPerUnit;
  if (!Number.isFinite(baseQuantity)) throw new Error(`La cantidad de ${food.name} es demasiado grande.`);
  return { baseQuantity, unitLabel };
}

export type FoodDetails = Pick<Food, 'name' | 'brand' | 'kind' | 'category' | 'baseUnit' |
  'defaultState' | 'source' | 'externalId' | 'sourceFetchedAt' | 'sourceVersion' |
  'verificationStatus' | 'nutrientsPer100'>;
export type EquivalenceDetails = Pick<FoodEquivalence, 'label' | 'baseQuantity' |
  'rawToCookedYieldFactor' | 'source' | 'precision'>;

function newFood(details: FoodDetails, now: string): Food {
  return {
    ...newBase(now), ...details,
    ticketAliases: [], defaultLocation: null, defaultPackageSize: null,
    useCountByMealSlot: {}, lastUsedAt: null, lastUsedQuantityAndUnit: null,
  };
}

export const foodName = (food: Pick<Food, 'name' | 'brand'>) =>
  food.brand ? `${food.name} · ${food.brand}` : food.name;

const collator = new Intl.Collator('es-ES');
const searchable = (text: string) =>
  text.toLocaleLowerCase('es-ES').normalize('NFD').replace(/\p{Diacritic}/gu, '');

export function searchFoods(foods: Food[], query: string, category = ''): Food[] {
  const words = searchable(query).trim().split(/\s+/);
  return foods.filter((food) => {
    if (food.deletedAt || (category && food.category !== category)) return false;
    const text = searchable([food.name, food.brand, food.externalId, ...food.ticketAliases].join(' '));
    return words.every((word) => text.includes(word));
  }).sort((a, b) => collator.compare(foodName(a), foodName(b)));
}

const SEED_KEY = 'catalog.usda.sr-legacy.v1';

export async function seedCatalog(db: MiNutricionDB, now = nowIso()): Promise<void> {
  // Marcador, alimentos y medidas se escriben en la misma transacción.
  await db.transaction('rw', db.appSettings, db.foods, db.foodEquivalences, async () => {
    if (await db.appSettings.get({ key: SEED_KEY })) return;
    const existing = await db.foods.where('source').equals('usda').toArray();
    const existingIds = new Set(existing.map((food) => food.externalId));
    const foods: Food[] = [];
    const equivalents: FoodEquivalence[] = [];

    for (const [category, entries] of Object.entries(USDA_SEED)) {
      for (const [id, name, defaultState, nutrients, portions, yieldEstimate] of entries) {
        if (existingIds.has(String(id))) continue;
        const source = `USDA SR Legacy 04/2018 · FDC ${id}`;
        const food = newFood({
          name, category, defaultState, brand: null, kind: 'generic', baseUnit: 'g',
          source: 'usda', externalId: String(id), sourceVersion: 'SR Legacy 04/2018',
          sourceFetchedAt: null, verificationStatus: 'verified',
          nutrientsPer100: mapNutrients((key) => nutrients[NUTRIENT_KEYS.indexOf(key)]),
        }, now);
        foods.push(food);
        for (const [label, baseQuantity] of portions) {
          equivalents.push({
            ...newBase(now), foodId: food.id, label, baseQuantity, rawToCookedYieldFactor: null,
            source, precision: 'approximate', version: 1,
          });
        }
        if (yieldEstimate) {
          const [factor, pairedFdcId] = yieldEstimate;
          equivalents.push({
            ...newBase(now), foodId: food.id, label: 'Rendimiento de cocción', baseQuantity: null,
            rawToCookedYieldFactor: factor, source: `${source} y ${pairedFdcId} · estimación por materia seca`,
            precision: 'approximate', version: 1,
          });
        }
      }
    }
    await db.foods.bulkAdd(foods);
    await db.foodEquivalences.bulkAdd(equivalents);
    await db.appSettings.add({ ...newBase(now), key: SEED_KEY, value: true });
  });
}

export async function saveFood(
  db: MiNutricionDB,
  details: FoodDetails,
  previous?: Food,
  equivalents: EquivalenceDetails[] = [],
  now = nowIso(),
): Promise<Food> {
  const name = details.name.trim();
  if (!name) throw new Error('Escribe el nombre del alimento.');
  const nutrientsPer100 = mapNutrients((key) => details.nutrientsPer100[key] ?? null);
  if (Object.values(nutrientsPer100).some((n) => n !== null && (!Number.isFinite(n) || n < 0))) {
    throw new Error('Los nutrientes deben ser números positivos o cero.');
  }
  for (const equivalent of equivalents) {
    if (!equivalent.label.trim() || [equivalent.baseQuantity, equivalent.rawToCookedYieldFactor]
      .some((n) => n !== null && (!Number.isFinite(n) || n <= 0)) ||
      (equivalent.baseQuantity === null && equivalent.rawToCookedYieldFactor === null)) {
      throw new Error('Cada equivalencia necesita un nombre y un valor mayor que cero.');
    }
  }

  return db.transaction('rw', db.foods, db.foodEquivalences, async () => {
    const current = previous ? await db.foods.get(previous.id) : undefined;
    if (previous && (!current || current.deletedAt || current.revision !== previous.revision)) {
      throw new Error('El alimento ha cambiado. Vuelve a abrirlo para editar la última versión.');
    }
    if (!previous && details.source === 'off' && details.externalId) {
      const match = await db.foods.where('externalId').equals(details.externalId)
        .and((food) => food.source === 'off' && !food.deletedAt).first();
      if (match) return match;
    }
    const fields = { ...details, name, brand: details.brand?.trim() || null, nutrientsPer100 };
    const food = current
      ? { ...current, ...fields, revision: current.revision + 1, updatedAt: now }
      : newFood(fields, now);
    const active = await db.foodEquivalences.where('foodId').equals(food.id).and((e) => !e.deletedAt).toArray();
    if (current && current.baseUnit !== food.baseUnit && active.some((e) => e.baseQuantity !== null)) {
      throw new Error('Crea otro alimento para usar una unidad base distinta cuando ya hay equivalencias.');
    }
    for (const equivalent of equivalents) {
      const label = equivalent.label.trim();
      const existing = active.filter((e) => searchable(e.label) === searchable(label));
      const last = existing.reduce((max, e) => Math.max(max, e.version), 0);
      for (const e of existing) await db.foodEquivalences.update(e.id, { deletedAt: now, updatedAt: now, revision: e.revision + 1 });
      const next = {
        ...newBase(now), ...equivalent, foodId: food.id, label, version: last + 1,
      };
      await db.foodEquivalences.add(next);
      active.push(next);
    }
    await db.foods.put(food);
    return food;
  });
}
