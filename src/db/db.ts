import Dexie, { type EntityTable } from 'dexie';
import type {
  AiExchangeLog,
  AppSetting,
  BaseRecord,
  DiaryDay,
  DiaryEntry,
  Food,
  FoodEquivalence,
  InventoryBatch,
  InventoryMovement,
  MealPlan,
  NutritionGoal,
  Photo,
  Profile,
  ProgressLog,
  Purchase,
  PurchaseLine,
  Recipe,
  RecipeIngredient,
} from './types';

export const DB_NAME = 'mi-nutricion';
export const DB_SCHEMA_VERSION = 1;

/**
 * Las 17 tablas en 6 bloques (sección 13.2).
 * Todas usan `id` (UUID v4) como clave primaria. `&` = índice único.
 */
export const STORES = {
  // Bloque 1 — Perfil y metas
  profiles: 'id, effectiveFrom',
  nutritionGoals: 'id, status, approvedAt',
  // Bloque 2 — Catálogo y recetas
  foods: 'id, name, kind, source, verificationStatus, externalId, lastUsedAt, *ticketAliases',
  foodEquivalences: 'id, foodId',
  recipes: 'id, parentRecipeId, name, lastUsedAt',
  recipeIngredients: 'id, recipeId, foodId',
  // Bloque 3 — Compras y despensa
  purchases: 'id, purchaseDate, sourceJsonId',
  purchaseLines: 'id, purchaseId, foodId, batchId',
  inventoryBatches: 'id, foodId, status, expiryDate, [foodId+status]',
  inventoryMovements:
    'id, &idempotencyKey, operationId, batchId, foodId, type, relatedDiaryEntryId, reversedMovementId, reversedOperationId',
  // Bloque 4 — Diario y planificación
  mealPlans: 'id, date, [date+mealSlot]',
  diaryDays: 'id, &date',
  diaryEntries: 'id, date, [date+mealSlot], foodId, recipeId',
  // Bloque 5 — Progreso
  progressLogs: 'id, &date',
  // Bloque 6 — IA, fotos y configuración
  aiExchangeLog: 'id, &externalJsonId, direction, schema',
  photos: 'id, relatedPurchaseId',
  appSettings: 'id, &key',
} as const;

export type TableName = keyof typeof STORES;
export const TABLE_NAMES = Object.keys(STORES) as TableName[];

export type MiNutricionDB = Dexie & {
  profiles: EntityTable<Profile, 'id'>;
  nutritionGoals: EntityTable<NutritionGoal, 'id'>;
  foods: EntityTable<Food, 'id'>;
  foodEquivalences: EntityTable<FoodEquivalence, 'id'>;
  recipes: EntityTable<Recipe, 'id'>;
  recipeIngredients: EntityTable<RecipeIngredient, 'id'>;
  purchases: EntityTable<Purchase, 'id'>;
  purchaseLines: EntityTable<PurchaseLine, 'id'>;
  inventoryBatches: EntityTable<InventoryBatch, 'id'>;
  inventoryMovements: EntityTable<InventoryMovement, 'id'>;
  mealPlans: EntityTable<MealPlan, 'id'>;
  diaryDays: EntityTable<DiaryDay, 'id'>;
  diaryEntries: EntityTable<DiaryEntry, 'id'>;
  progressLogs: EntityTable<ProgressLog, 'id'>;
  aiExchangeLog: EntityTable<AiExchangeLog, 'id'>;
  photos: EntityTable<Photo, 'id'>;
  appSettings: EntityTable<AppSetting, 'id'>;
};

export function createDb(name: string = DB_NAME): MiNutricionDB {
  const db = new Dexie(name) as MiNutricionDB;
  db.version(DB_SCHEMA_VERSION).stores(STORES);
  return db;
}

export const db = createDb();

/** Fecha/hora ISO-8601 UTC sin milisegundos: YYYY-MM-DDTHH:mm:ssZ. */
export function nowIso(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Campos comunes para un registro nuevo. */
export function newBase(now: string = nowIso()): BaseRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    revision: 1,
  };
}
