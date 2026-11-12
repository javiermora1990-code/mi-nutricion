import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, newBase, type MiNutricionDB } from '../src/db/db';
import type { MealPlan, MealSlot } from '../src/db/types';
import { nextPlannedDate, planItemName, sortByMealSlot } from '../src/lib/planning';

const when = '2026-01-12T12:00:00Z';
let db: MiNutricionDB;

function plan(date: string, mealSlot: MealSlot, deleted = false): MealPlan {
  return {
    ...newBase(when), date, mealSlot, dayType: 'rest', sourceJsonId: null, notes: null,
    deletedAt: deleted ? when : null,
    items: [{ itemType: 'recipe', refId: 'r', quantity: 1, unit: 'portion', snapshot: { name: 'Receta ficticia · v1', nutrients: {} as never, ingredients: [] } }],
  } as MealPlan;
}

beforeEach(() => { db = createDb(`planning-home-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); });

describe('Menú en Inicio', () => {
  it('encuentra el primer día con menú desde una fecha, ignorando los borrados', async () => {
    expect(await nextPlannedDate(db, '2026-01-12')).toBeNull();
    await db.mealPlans.bulkAdd([plan('2026-01-10', 'lunch'), plan('2026-01-14', 'lunch', true), plan('2026-01-19', 'dinner')]);
    expect(await nextPlannedDate(db, '2026-01-12')).toBe('2026-01-19');
    expect(await nextPlannedDate(db, '2026-01-10')).toBe('2026-01-10');
  });

  it('ordena las tomas como en el menú y oculta la primera versión en el nombre', () => {
    const sorted = sortByMealSlot([plan('2026-01-12', 'dinner'), plan('2026-01-12', 'breakfast'), plan('2026-01-12', 'lunch')]);
    expect(sorted.map((p) => p.mealSlot)).toEqual(['breakfast', 'lunch', 'dinner']);
    const item = sorted[0].items[0];
    expect(planItemName(item)).toBe('Receta ficticia');
    expect(planItemName({ ...item, snapshot: { ...item.snapshot!, name: 'Receta ficticia · v2' } })).toBe('Receta ficticia · v2');
  });
});
