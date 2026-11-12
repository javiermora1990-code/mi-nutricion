import { newBase, nowIso, type MiNutricionDB } from '../db/db';
import type { Food, InventoryBatch, InventoryMovement, InventoryMovementType, IsoDate, StorageLocation } from '../db/types';
import type { ShoppingItem } from './planning';

/**
 * Despensa por lotes (Etapa 4). Reglas:
 * - Cada acción es una operación (`operationId`) con uno o varios movimientos inmutables.
 * - `idempotencyKey` (índice único) impide aplicar dos veces la misma acción: el segundo intento no escribe nada.
 * - Nunca hay saldos negativos ni un lote por encima de su cantidad inicial.
 * - Deshacer crea movimientos `reversal`; el historial no se borra.
 * Las cantidades se guardan en la unidad base del alimento (g o ml).
 */

export const LOCATION_LABELS: Record<StorageLocation, string> = { pantry: 'Despensa', fridge: 'Nevera', freezer: 'Congelador' };
export const LOCATIONS = Object.keys(LOCATION_LABELS) as StorageLocation[];
export const MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  purchase_in: 'Compra', consumption_out: 'Consumo', manual_adjust: 'Ajuste', waste_out: 'Desechado', reversal: 'Anulación',
};

export interface OperationResult {
  operationId: string;
  /** true si la clave ya se había usado y no se ha escrito nada. */
  duplicated: boolean;
}

const EPSILON = 1e-6;
export const CREATION_NOTE = 'Alta manual';
const clean = (n: number) => (Math.abs(n) < EPSILON ? 0 : Math.round(n * 1e6) / 1e6);
const tables = (db: MiNutricionDB) => [db.inventoryBatches, db.inventoryMovements, db.foods];

function assertQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Indica una cantidad mayor que cero.');
}

async function duplicate(db: MiNutricionDB, idempotencyKey: string): Promise<OperationResult | null> {
  const previous = await db.inventoryMovements.get({ idempotencyKey });
  return previous ? { operationId: previous.operationId, duplicated: true } : null;
}

function movement(
  batch: InventoryBatch, type: InventoryMovementType, quantityDelta: number, operationId: string, idempotencyKey: string,
  now: string, extra: Partial<InventoryMovement> = {},
): InventoryMovement {
  return {
    ...newBase(now), type, operationId, idempotencyKey, batchId: batch.id, foodId: batch.foodId,
    quantityDelta: clean(quantityDelta), unit: batch.unit, occurredAt: now, relatedDiaryEntryId: null,
    relatedPurchaseLineId: null, reversedMovementId: null, reversedOperationId: null, note: null, ...extra,
  };
}

/** Aplica una variación a un lote comprobando límites y recalcula su estado. */
async function applyDelta(db: MiNutricionDB, batch: InventoryBatch, delta: number, now: string, emptyStatus: InventoryBatch['status'] = 'depleted') {
  const remaining = clean(batch.remainingQuantity + delta);
  if (remaining < 0) throw new Error('No hay existencias suficientes en ese lote.');
  if (remaining > batch.initialQuantity + EPSILON) throw new Error('El lote no puede superar su cantidad inicial.');
  const status: InventoryBatch['status'] = remaining === 0 ? emptyStatus : 'available';
  await db.inventoryBatches.update(batch.id, { remainingQuantity: remaining, status, updatedAt: now, revision: batch.revision + 1 });
  Object.assign(batch, { remainingQuantity: remaining, status, revision: batch.revision + 1 });
}

export interface NewBatchInput {
  foodId: string;
  quantity: number;
  location: StorageLocation;
  expiryDate: IsoDate | null;
}

/** Da de alta un lote con su movimiento de entrada. */
export async function addBatch(db: MiNutricionDB, input: NewBatchInput, idempotencyKey: string, now = nowIso()): Promise<OperationResult> {
  assertQuantity(input.quantity);
  return db.transaction('rw', tables(db), async () => {
    const seen = await duplicate(db, idempotencyKey);
    if (seen) return seen;
    const food = await db.foods.get(input.foodId);
    if (!food || food.deletedAt) throw new Error('Ese alimento no está en el catálogo.');
    const batch: InventoryBatch = {
      ...newBase(now), foodId: food.id, purchaseLineId: null, location: input.location, unit: food.baseUnit,
      initialQuantity: clean(input.quantity), remainingQuantity: clean(input.quantity), expiryDate: input.expiryDate,
      openedAt: null, status: 'available',
    };
    const operationId = crypto.randomUUID();
    await db.inventoryBatches.add(batch);
    await db.inventoryMovements.add(movement(batch, 'manual_adjust', batch.initialQuantity, operationId, idempotencyKey, now,
      { note: CREATION_NOTE }));
    return { operationId, duplicated: false };
  });
}

/** Orden FEFO: primero lo que caduca antes; sin fecha, al final; a igualdad, el más antiguo. */
export function fefo(batches: InventoryBatch[]): InventoryBatch[] {
  return [...batches].sort((a, b) =>
    (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Descuenta una cantidad de un alimento repartiéndola entre lotes por FEFO, o de un lote concreto.
 * Todo en una sola operación; si no alcanza, no escribe nada.
 */
export async function takeOut(
  db: MiNutricionDB,
  request: { foodId: string; quantity: number; batchId?: string; type?: 'consumption_out' | 'waste_out'; note?: string | null },
  idempotencyKey: string, now = nowIso(),
): Promise<OperationResult> {
  assertQuantity(request.quantity);
  const type = request.type ?? 'consumption_out';
  return db.transaction('rw', tables(db), async () => {
    const seen = await duplicate(db, idempotencyKey);
    if (seen) return seen;
    const candidates = request.batchId
      ? [await db.inventoryBatches.get(request.batchId)].filter((batch): batch is InventoryBatch => !!batch)
      : fefo(await db.inventoryBatches.where('[foodId+status]').equals([request.foodId, 'available']).toArray());
    const usable = candidates.filter((batch) => !batch.deletedAt && batch.foodId === request.foodId && batch.status === 'available');
    const available = usable.reduce((sum, batch) => sum + batch.remainingQuantity, 0);
    if (available + EPSILON < request.quantity) throw new Error('No hay existencias suficientes para descontar esa cantidad.');
    const operationId = crypto.randomUUID();
    let pending = request.quantity;
    let index = 0;
    for (const batch of usable) {
      if (pending <= EPSILON) break;
      const amount = Math.min(pending, batch.remainingQuantity);
      if (amount <= 0) continue;
      // La primera fila usa la clave de la acción; las siguientes derivan de ella para seguir siendo únicas.
      const key = index === 0 ? idempotencyKey : `${idempotencyKey}#${index}`;
      await db.inventoryMovements.add(movement(batch, type, -amount, operationId, key, now, { note: request.note ?? null }));
      await applyDelta(db, batch, -amount, now, type === 'waste_out' ? 'discarded' : 'depleted');
      pending = clean(pending - amount);
      index++;
    }
    return { operationId, duplicated: false };
  });
}

/** Corrige la cantidad que queda en un lote (recuento). Solo registra la diferencia. */
export async function adjustBatch(db: MiNutricionDB, batchId: string, remaining: number, idempotencyKey: string, now = nowIso()): Promise<OperationResult> {
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Indica una cantidad igual o mayor que cero.');
  return db.transaction('rw', tables(db), async () => {
    const seen = await duplicate(db, idempotencyKey);
    if (seen) return seen;
    const batch = await db.inventoryBatches.get(batchId);
    if (!batch || batch.deletedAt) throw new Error('Ese lote ya no existe.');
    if (remaining > batch.initialQuantity + EPSILON) throw new Error('Para añadir más de lo que entró, crea un lote nuevo.');
    const delta = clean(remaining - batch.remainingQuantity);
    if (delta === 0) throw new Error('La cantidad no ha cambiado.');
    const operationId = crypto.randomUUID();
    await db.inventoryMovements.add(movement(batch, 'manual_adjust', delta, operationId, idempotencyKey, now, { note: 'Recuento' }));
    await applyDelta(db, batch, delta, now);
    return { operationId, duplicated: false };
  });
}

/** Operaciones que aún se pueden deshacer (no son reversiones ni se han revertido ya). */
export function reversibleOperations(movements: InventoryMovement[]): Set<string> {
  const reversed = new Set(movements.filter((m) => m.reversedOperationId).map((m) => m.reversedOperationId!));
  return new Set(movements.filter((m) => m.type !== 'reversal' && !reversed.has(m.operationId)).map((m) => m.operationId));
}

/**
 * Deshace una operación completa con asientos compensatorios en todos sus lotes.
 * Si deshacer un alta dejaría el lote en negativo (porque ya se gastó algo), se rechaza.
 */
export async function reverseOperation(db: MiNutricionDB, operationId: string, idempotencyKey: string, now = nowIso()): Promise<OperationResult> {
  return db.transaction('rw', tables(db), async () => {
    const seen = await duplicate(db, idempotencyKey);
    if (seen) return seen;
    const original = await db.inventoryMovements.where('operationId').equals(operationId).toArray();
    if (!original.length) throw new Error('No se encuentra esa operación.');
    if (original.some((m) => m.type === 'reversal')) throw new Error('No se puede deshacer una reversión.');
    if (await db.inventoryMovements.where('reversedOperationId').equals(operationId).count()) throw new Error('Esa operación ya se deshizo.');
    const reversalId = crypto.randomUUID();
    let index = 0;
    for (const m of original) {
      const batch = await db.inventoryBatches.get(m.batchId);
      if (!batch) throw new Error('Falta un lote de esa operación.');
      const delta = -m.quantityDelta;
      if (batch.remainingQuantity + delta < -EPSILON) {
        throw new Error('Ya se ha gastado parte de este lote. Deshaz antes los movimientos posteriores.');
      }
      const key = index === 0 ? idempotencyKey : `${idempotencyKey}#${index}`;
      await db.inventoryMovements.add(movement(batch, 'reversal', delta, reversalId, key, now,
        { reversedMovementId: m.id, reversedOperationId: operationId }));
      await applyDelta(db, batch, delta, now);
      // Deshacer el alta deja el lote vacío: deja de mostrarse, pero se conserva con su historial.
      const isCreation = (m.type === 'manual_adjust' && m.note === CREATION_NOTE) || m.type === 'purchase_in';
      if (isCreation && batch.remainingQuantity === 0) await db.inventoryBatches.update(batch.id, { deletedAt: now });
      index++;
    }
    return { operationId: reversalId, duplicated: false };
  });
}

/** Existencias disponibles por alimento y unidad. */
export function stockByFood(batches: InventoryBatch[]): Map<string, number> {
  const stock = new Map<string, number>();
  for (const batch of batches) {
    if (batch.deletedAt || batch.status !== 'available') continue;
    const key = `${batch.foodId}|${batch.unit}`;
    stock.set(key, clean((stock.get(key) ?? 0) + batch.remainingQuantity));
  }
  return stock;
}

export interface ShoppingLine extends ShoppingItem {
  /** Lo que hay en casa de ese alimento (0 si nada). */
  have: number;
  /** Lo que falta comprar; `null` si la necesidad es desconocida. */
  toBuy: number | null;
}

/** Contrasta la lista con la despensa. Las existencias se reparten entre las líneas del mismo alimento. */
export function applyPantry(items: ShoppingItem[], batches: InventoryBatch[]): ShoppingLine[] {
  const stock = stockByFood(batches);
  return items.map((item) => {
    const key = `${item.foodId}|${item.unit}`;
    const have = item.unit ? stock.get(key) ?? 0 : 0;
    if (item.quantity === null) return { ...item, have, toBuy: null };
    const used = Math.min(have, item.quantity);
    if (item.unit) stock.set(key, clean(have - used));
    return { ...item, have, toBuy: clean(item.quantity - used) };
  });
}

/** Días hasta la caducidad (negativo si ya caducó); `null` sin fecha. */
export function daysToExpiry(expiryDate: IsoDate | null, today: IsoDate): number | null {
  if (!expiryDate) return null;
  return Math.round((Date.parse(expiryDate) - Date.parse(today)) / 86_400_000);
}

export const OTHER_CATEGORY = 'Otros';

/**
 * Agrupa los lotes por la categoría del alimento, en el orden del catálogo y con «Otros» al final
 * (alimentos sin categoría, como los creados por la IA). Dentro de cada grupo: por nombre y caducidad.
 */
export function groupByCategory(
  batches: InventoryBatch[], foodById: Map<string, Pick<Food, 'name' | 'category'>>, categoryOrder: string[],
): { category: string; batches: InventoryBatch[] }[] {
  const groups = new Map<string, InventoryBatch[]>();
  for (const batch of batches) {
    const category = foodById.get(batch.foodId)?.category || OTHER_CATEGORY;
    groups.set(category, [...(groups.get(category) ?? []), batch]);
  }
  const rank = (category: string) => {
    const index = categoryOrder.indexOf(category);
    return category === OTHER_CATEGORY ? Infinity : index === -1 ? categoryOrder.length : index;
  };
  const name = (batch: InventoryBatch) => foodById.get(batch.foodId)?.name ?? '';
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'es-ES'))
    .map(([category, list]) => ({
      category,
      batches: [...list].sort((a, b) => name(a).localeCompare(name(b), 'es-ES') ||
        (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31')),
    }));
}
