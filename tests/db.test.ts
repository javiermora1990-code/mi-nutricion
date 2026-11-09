import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TABLE_NAMES, createDb, newBase, nowIso, type MiNutricionDB } from '../src/db/db';

const EXPECTED_TABLES = [
  'profiles',
  'nutritionGoals',
  'foods',
  'foodEquivalences',
  'recipes',
  'recipeIngredients',
  'purchases',
  'purchaseLines',
  'inventoryBatches',
  'inventoryMovements',
  'mealPlans',
  'diaryDays',
  'diaryEntries',
  'progressLogs',
  'aiExchangeLog',
  'photos',
  'appSettings',
];

let db: MiNutricionDB;
let n = 0;

beforeEach(async () => {
  db = createDb(`test-${++n}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('esquema Dexie', () => {
  it('crea exactamente las 17 tablas del diseño', () => {
    expect(TABLE_NAMES).toHaveLength(17);
    expect(db.tables.map((t) => t.name).sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('usa id como clave primaria no autoincremental en todas las tablas', () => {
    for (const t of db.tables) {
      expect(t.schema.primKey.keyPath, t.name).toBe('id');
      expect(t.schema.primKey.auto, t.name).toBe(false);
    }
  });

  it('define los índices únicos exigidos', () => {
    const unique = (table: string, index: string) =>
      db.table(table).schema.indexes.find((i) => i.name === index)?.unique;
    expect(unique('diaryDays', 'date')).toBe(true);
    expect(unique('progressLogs', 'date')).toBe(true);
    expect(unique('inventoryMovements', 'idempotencyKey')).toBe(true);
    expect(unique('aiExchangeLog', 'externalJsonId')).toBe(true);
    expect(unique('appSettings', 'key')).toBe(true);
  });

  it('newBase genera UUID v4, fechas UTC sin milisegundos y revision 1', () => {
    const b = newBase();
    expect(b.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(b.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(b.deletedAt).toBeNull();
    expect(b.revision).toBe(1);
  });
});

describe('restricciones de unicidad', () => {
  it('impide dos progressLogs del mismo día', async () => {
    const log = {
      weightKg: 80,
      sleepHours: null,
      sleepQuality1to5: null,
      energyLevel1to5: null,
      hungerLevel1to5: null,
      trained: null,
      notes: null,
    };
    await db.progressLogs.add({ ...newBase(), date: '2026-11-09', ...log });
    await expect(db.progressLogs.add({ ...newBase(), date: '2026-11-09', ...log })).rejects.toBeInstanceOf(
      Dexie.ConstraintError,
    );
    await db.progressLogs.add({ ...newBase(), date: '2026-11-10', ...log });
    expect(await db.progressLogs.count()).toBe(2);
  });

  it('impide dos diaryDays del mismo día', async () => {
    const day = {
      dayType: 'training' as const,
      completionStatus: 'open' as const,
      activeGoalId: null,
      goalTargetsSnapshot: null,
      notes: null,
    };
    await db.diaryDays.add({ ...newBase(), date: '2026-11-09', ...day });
    await expect(db.diaryDays.add({ ...newBase(), date: '2026-11-09', ...day })).rejects.toBeInstanceOf(
      Dexie.ConstraintError,
    );
  });

  it('rechaza un movimiento de inventario con idempotencyKey repetida', async () => {
    const mov = () => ({
      ...newBase(),
      type: 'consumption_out' as const,
      operationId: crypto.randomUUID(),
      idempotencyKey: 'diary:abc:consume:1',
      batchId: crypto.randomUUID(),
      foodId: crypto.randomUUID(),
      quantityDelta: -150,
      unit: 'g' as const,
      occurredAt: nowIso(),
      relatedDiaryEntryId: null,
      relatedPurchaseLineId: null,
      reversedMovementId: null,
      reversedOperationId: null,
      note: null,
    });
    await db.inventoryMovements.add(mov());
    await expect(db.inventoryMovements.add(mov())).rejects.toBeInstanceOf(Dexie.ConstraintError);
    expect(await db.inventoryMovements.count()).toBe(1);
  });

  it('impide registrar dos veces el mismo JSON en aiExchangeLog', async () => {
    const entry = () => ({
      ...newBase(),
      externalJsonId: '3f2b8c1e-9d4a-4e6f-8a1b-2c3d4e5f6a7b',
      direction: 'import' as const,
      schema: 'mi-nutricion/ai-proposal',
      formatVersion: '1.0',
      source: 'chatgpt' as const,
      fileName: 'x.json',
      documentCreatedAt: nowIso(),
      status: 'test' as const,
      summary: null,
    });
    await db.aiExchangeLog.add(entry());
    await expect(db.aiExchangeLog.add(entry())).rejects.toBeInstanceOf(Dexie.ConstraintError);
  });

  it('una transacción fallida no deja escrituras parciales (base de la restauración atómica)', async () => {
    const setting = (key: string) => ({ ...newBase(), key, value: 1 });
    await expect(
      db.transaction('rw', db.appSettings, async () => {
        await db.appSettings.add(setting('a'));
        await db.appSettings.add(setting('b'));
        await db.appSettings.add(setting('a')); // viola &key
      }),
    ).rejects.toBeInstanceOf(Dexie.ConstraintError);
    expect(await db.appSettings.count()).toBe(0);
  });
});
