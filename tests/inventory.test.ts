import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MiNutricionDB } from '../src/db/db';
import type { Food, InventoryBatch } from '../src/db/types';
import { mapNutrients, saveFood } from '../src/lib/catalog';
import { addBatch, adjustBatch, applyPantry, daysToExpiry, fefo, groupByCategory, reverseOperation, reversibleOperations, takeOut } from '../src/lib/inventory';

let db: MiNutricionDB;
let food: Food;
const remaining = async () => (await db.inventoryBatches.toArray())
  .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''))
  .map((batch) => [batch.remainingQuantity, batch.status]);

beforeEach(async () => {
  db = createDb(`inventory-${crypto.randomUUID()}`);
  food = await saveFood(db, {
    name: 'Arroz ficticio', brand: null, kind: 'generic', category: null, baseUnit: 'g', defaultState: 'raw',
    source: 'user_label', externalId: null, sourceFetchedAt: null, sourceVersion: null, verificationStatus: 'verified',
    nutrientsPer100: mapNutrients(() => null),
  });
});
afterEach(async () => { await db.delete(); });

describe('Despensa · pruebas obligatorias (16.1)', () => {
  it('1 · descuento simple e idempotencia', async () => {
    await addBatch(db, { foodId: food.id, quantity: 500, location: 'pantry', expiryDate: null }, 'alta-1');
    expect((await addBatch(db, { foodId: food.id, quantity: 500, location: 'pantry', expiryDate: null }, 'alta-1')).duplicated).toBe(true);
    expect(await db.inventoryBatches.count()).toBe(1);
    await takeOut(db, { foodId: food.id, quantity: 200 }, 'uso-1');
    const again = await takeOut(db, { foodId: food.id, quantity: 200 }, 'uso-1');
    expect(again.duplicated).toBe(true);
    expect(await remaining()).toEqual([[300, 'available']]);
    expect(await db.inventoryMovements.count()).toBe(2);
  });

  it('2 · descuento multilote por FEFO en una sola operación, sin saldos negativos', async () => {
    await addBatch(db, { foodId: food.id, quantity: 120, location: 'pantry', expiryDate: '2026-01-10' }, 'a');
    await addBatch(db, { foodId: food.id, quantity: 500, location: 'pantry', expiryDate: '2026-02-10' }, 'b');
    const { operationId } = await takeOut(db, { foodId: food.id, quantity: 300 }, 'uso');
    expect(await remaining()).toEqual([[0, 'depleted'], [320, 'available']]);
    const movements = await db.inventoryMovements.where('operationId').equals(operationId).toArray();
    expect(movements.map((m) => m.quantityDelta).sort((a, b) => a - b)).toEqual([-180, -120]);
    await expect(takeOut(db, { foodId: food.id, quantity: 321 }, 'exceso')).rejects.toThrow('suficientes');
    expect(await remaining()).toEqual([[0, 'depleted'], [320, 'available']]);
  });

  it('4 · reversión completa restaura todos los lotes y conserva el historial', async () => {
    await addBatch(db, { foodId: food.id, quantity: 120, location: 'pantry', expiryDate: '2026-01-10' }, 'a');
    await addBatch(db, { foodId: food.id, quantity: 500, location: 'fridge', expiryDate: '2026-02-10' }, 'b');
    const { operationId } = await takeOut(db, { foodId: food.id, quantity: 300 }, 'uso');
    await reverseOperation(db, operationId, 'deshacer');
    expect(await remaining()).toEqual([[120, 'available'], [500, 'available']]);
    expect(await db.inventoryMovements.count()).toBe(6);
    await expect(reverseOperation(db, operationId, 'deshacer-2')).rejects.toThrow('ya se deshizo');
    expect(reversibleOperations(await db.inventoryMovements.toArray()).has(operationId)).toBe(false);
  });
});

describe('Despensa · reglas adicionales', () => {
  it('desechar deja el lote como desechado y deshacerlo lo devuelve', async () => {
    await addBatch(db, { foodId: food.id, quantity: 100, location: 'fridge', expiryDate: null }, 'a');
    const [batch] = await db.inventoryBatches.toArray();
    const { operationId } = await takeOut(db, { foodId: food.id, batchId: batch.id, quantity: 100, type: 'waste_out' }, 'tirar');
    expect(await remaining()).toEqual([[0, 'discarded']]);
    await reverseOperation(db, operationId, 'deshacer');
    expect(await remaining()).toEqual([[100, 'available']]);
  });

  it('el recuento solo registra la diferencia y no supera la cantidad inicial', async () => {
    await addBatch(db, { foodId: food.id, quantity: 500, location: 'pantry', expiryDate: null }, 'a');
    const [batch] = await db.inventoryBatches.toArray();
    await adjustBatch(db, batch.id, 350, 'recuento');
    expect((await db.inventoryMovements.get({ idempotencyKey: 'recuento' }))?.quantityDelta).toBe(-150);
    await expect(adjustBatch(db, batch.id, 600, 'recuento-2')).rejects.toThrow('lote nuevo');
  });

  it('no deja deshacer un alta ya gastada en parte; deshacer un alta intacta retira el lote', async () => {
    const alta = await addBatch(db, { foodId: food.id, quantity: 200, location: 'pantry', expiryDate: null }, 'a');
    await takeOut(db, { foodId: food.id, quantity: 50 }, 'uso');
    await expect(reverseOperation(db, alta.operationId, 'x')).rejects.toThrow('Deshaz antes');
    const otra = await addBatch(db, { foodId: food.id, quantity: 80, location: 'pantry', expiryDate: '2030-01-01' }, 'b');
    await reverseOperation(db, otra.operationId, 'y');
    expect((await db.inventoryBatches.toArray()).filter((batch) => !batch.deletedAt)).toHaveLength(1);
  });

  it('la lista de compra descuenta lo que hay en casa', async () => {
    await addBatch(db, { foodId: food.id, quantity: 300, location: 'pantry', expiryDate: null }, 'a');
    const lines = applyPantry([
      { key: '1', foodId: food.id, name: food.name, quantity: 500, unit: 'g', state: 'raw' },
      { key: '2', foodId: 'otro', name: 'Otro', quantity: 100, unit: 'g', state: 'raw' },
      { key: '3', foodId: food.id, name: food.name, quantity: null, unit: 'g', state: 'cooked' },
    ], await db.inventoryBatches.toArray());
    expect(lines.map((line) => [line.have, line.toBuy])).toEqual([[300, 200], [0, 100], [0, null]]);
  });

  it('ordena por caducidad y calcula los días que faltan', () => {
    const batch = (id: string, expiryDate: string | null) => ({ id, expiryDate, createdAt: '2026-01-01T00:00:00Z' }) as InventoryBatch;
    expect(fefo([batch('b', null), batch('a', '2026-01-05')]).map((b) => b.id)).toEqual(['a', 'b']);
    expect(daysToExpiry('2026-01-05', '2026-01-03')).toBe(2);
    expect(daysToExpiry('2026-01-01', '2026-01-03')).toBe(-2);
  });

  it('agrupa por categoría en el orden del catálogo, con «Otros» al final', () => {
    const batch = (id: string, foodId: string) => ({ id, foodId, expiryDate: null }) as InventoryBatch;
    const foods = new Map([
      ['manzana', { name: 'Manzana', category: 'Frutas' }],
      ['aceite', { name: 'Aceite', category: 'Aceites' }],
      ['pera', { name: 'Pera', category: 'Frutas' }],
      ['salsa', { name: 'Salsa', category: null }],
    ]);
    const groups = groupByCategory([batch('1', 'salsa'), batch('2', 'pera'), batch('3', 'aceite'), batch('4', 'manzana')], foods, ['Frutas', 'Aceites']);
    expect(groups.map((g) => [g.category, g.batches.map((b) => b.id)])).toEqual([
      ['Frutas', ['4', '2']], ['Aceites', ['3']], ['Otros', ['1']],
    ]);
  });
});
