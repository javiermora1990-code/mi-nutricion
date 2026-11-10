import { z } from 'zod';
import { nowIso } from '../db/db';
import type { Nutrients } from '../db/types';
import { mapNutrients, type FoodDetails } from './catalog';
import { APP_VERSION } from '../routes';

const resultSchema = z.object({
  code: z.string().regex(/^\d+$/),
  product_name: z.string().optional(),
  product_name_es: z.string().optional(),
  brands: z.string().optional(),
  last_modified_t: z.number().int().positive().optional(),
  nutriments: z.record(z.string(), z.unknown()).optional(),
  no_nutrition_data: z.string().optional(),
});

const fields = [
  'code', 'product_name', 'product_name_es', 'brands', 'last_modified_t',
  'nutriments', 'no_nutrition_data',
];

const nutrientFields: Record<keyof Nutrients, string> = {
  energyKcal: 'energy-kcal',
  proteinG: 'proteins',
  carbsG: 'carbohydrates',
  fatG: 'fat',
  fiberG: 'fiber',
  sugarsG: 'sugars',
  saturatedFatG: 'saturated-fat',
  saltG: 'salt',
};

function nutrientValue(n: unknown): number | null {
  const value = typeof n === 'string' && /^\d+(?:\.\d+)?$/.test(n) ? Number(n) : n;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function readOffResults(payload: unknown, fetchedAt = nowIso()): FoodDetails[] {
  const page = z.object({ products: z.array(z.unknown()) }).safeParse(payload);
  if (!page.success) throw new Error('Open Food Facts devolvió una respuesta inesperada.');
  const results = new Map<string, FoodDetails>();
  for (const row of page.data.products) {
    const product = resultSchema.safeParse(row);
    if (!product.success) continue;
    const item = product.data;
    const name = item.product_name_es?.trim() || item.product_name?.trim();
    if (!name || results.has(item.code)) continue;
    const nutrients = item.no_nutrition_data === 'on' ? undefined : item.nutriments;
    const nutrientsPer100 = mapNutrients((key) => {
      const value = nutrientValue(nutrients?.[`${nutrientFields[key]}_100g`]);
      if (key !== 'energyKcal' || value !== null) return value;
      const kilojoules = nutrientValue(nutrients?.['energy-kj_100g']);
      return kilojoules === null ? null : kilojoules / 4.184;
    });
    results.set(item.code, {
      name, brand: item.brands?.trim() || null, kind: 'commercial', category: null,
      baseUnit: 'g', defaultState: null, source: 'off', externalId: item.code,
      sourceFetchedAt: fetchedAt, sourceVersion: item.last_modified_t?.toString() ?? null,
      verificationStatus: 'pending_review', nutrientsPer100,
    });
  }
  return [...results.values()];
}

export type OffSearchMode = 'name' | 'brand' | 'barcode';

export async function searchOpenFoodFacts(query: string, mode: OffSearchMode): Promise<FoodDetails[]> {
  const term = query.trim();
  if (!term) return [];
  if (mode === 'barcode' && !/^\d{8,14}$/.test(term)) {
    throw new Error('Introduce un código de barras de 8 a 14 cifras.');
  }
  const nameSearch = mode === 'name';
  const url = new URL(nameSearch ? 'https://search.openfoodfacts.org/search' :
    mode === 'barcode' ? `https://world.openfoodfacts.org/api/v2/product/${term}.json` :
      'https://es.openfoodfacts.org/search');
  if (nameSearch) {
    url.search = new URLSearchParams({ q: term, langs: 'es', page_size: '20' }).toString();
  } else if (mode === 'barcode') {
    url.searchParams.set('fields', fields.join(','));
  } else {
    const tag = term.toLocaleLowerCase('es-ES').normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    if (!tag) return [];
    url.search = new URLSearchParams({ brands_tags: tag, json: '1', page_size: '20', fields: fields.join(',') }).toString();
  }
  const response = await fetch(url, {
    headers: { 'X-User-Agent': `MiNutricion/${APP_VERSION} (https://github.com/javiermora1990-code/mi-nutricion)` },
    credentials: 'omit',
    signal: AbortSignal.timeout(15_000),
  });
  if (mode === 'barcode' && response.status === 404) return [];
  if (!response.ok) {
    throw new Error('Open Food Facts no está disponible en este momento. Inténtalo más tarde.');
  }
  const payload = await response.json();
  if (nameSearch) return readOffResults({ products: payload?.hits });
  if (mode === 'barcode') {
    return readOffResults({ products: payload?.status === 0 ? [] : [payload?.product] });
  }
  return readOffResults(payload);
}
