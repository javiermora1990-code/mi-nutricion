/**
 * Tipos de las 17 tablas (sección 13 del diseño v1.14).
 * Regla general: los valores desconocidos son `null`, nunca 0.
 */

/** Campos comunes a las 17 tablas (13.1). */
export interface BaseRecord {
  /** UUID v4, clave primaria. */
  id: string;
  /** ISO-8601 UTC. */
  createdAt: string;
  updatedAt: string;
  /** null si el registro está activo (eliminación lógica). */
  deletedAt: string | null;
  /** Entero incremental. */
  revision: number;
}

export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string; // YYYY-MM-DDTHH:mm:ssZ

export type MealSlot = 'breakfast' | 'mid_morning' | 'lunch' | 'snack' | 'dinner' | 'other';
export type DayType = 'training' | 'rest';
export type Objective = 'maintain' | 'fat_loss' | 'muscle_gain';
export type QuantityUnit = 'g' | 'ml' | 'unit' | 'portion';
export type InventoryUnit = 'g' | 'ml' | 'unit';
export type FoodState = 'raw' | 'cooked';
export type StorageLocation = 'pantry' | 'fridge' | 'freezer';

/** Nutrientes por 100 g/ml. `null` = sin dato. */
export interface Nutrients {
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  sugarsG?: number | null;
  saturatedFatG?: number | null;
  saltG?: number | null;
}

/** Meta con cifra central y tolerancia (eventualmente asimétrica). */
export interface TargetRange {
  central: number;
  minTolerance: number;
  maxTolerance: number;
}

export interface DayTargets {
  energyKcal: TargetRange;
  proteinG: TargetRange;
  fatG: TargetRange;
  carbsG: TargetRange;
  fiberG: TargetRange;
}

export interface TargetsByDayType {
  default: DayTargets;
  training?: DayTargets;
  rest?: DayTargets;
}

export interface LastUsedQuantity {
  quantity: number;
  unit: QuantityUnit;
}

// ───────────── Bloque 1 — Perfil y metas ─────────────

export interface Profile extends BaseRecord {
  version: number;
  effectiveFrom: IsoDate;
  sex: 'male' | 'female';
  birthDate: IsoDate | null;
  ageYears: number | null;
  heightCm: number;
  /** Peso declarado al crear el perfil; el peso actual sale de progressLogs. */
  declaredWeightKg: number;
  weightDeclaredOn: IsoDate;
  isNatural: boolean;
  workType: 'seated' | 'standing' | 'physical';
  dailyStepsBand: string;
  trainingDaysPerWeek: number;
  trainingType: string;
}

export interface NutritionGoal extends BaseRecord {
  version: number;
  status: 'proposed' | 'active' | 'archived';
  objective: Objective;
  targetRateKgPerWeek: number | null;
  referenceWeightKg: number;
  bmrFormula: 'Mifflin-St Jeor';
  estimatedBmrKcal: number;
  activityFactor: number;
  estimatedTdeeKcal: number;
  targets: TargetsByDayType;
  assumptions: string[];
  origin: 'app' | 'chatgpt' | 'gemini' | 'manual';
  effectiveFrom: IsoDate | null;
  effectiveTo: IsoDate | null;
  approvedAt: IsoDateTime | null;
}

// ───────────── Bloque 2 — Catálogo y recetas ─────────────

export type FoodSource = 'user_label' | 'bedca' | 'off' | 'usda' | 'estimate';

export interface Food extends BaseRecord {
  name: string;
  brand: string | null;
  kind: 'generic' | 'commercial';
  category: string | null;
  baseUnit: 'g' | 'ml';
  defaultState: FoodState | null;
  source: FoodSource;
  /** Identificador en la fuente (FDC ID, código de barras…). */
  externalId: string | null;
  sourceFetchedAt: IsoDateTime | null;
  sourceVersion: string | null;
  verificationStatus: 'verified' | 'pending_review';
  nutrientsPer100: Nutrients;
  // Metadatos aprendidos automáticamente
  ticketAliases: string[];
  defaultLocation: StorageLocation | null;
  defaultPackageSize: { value: number; unit: 'g' | 'ml' } | null;
  useCountByMealSlot: Partial<Record<MealSlot, number>>;
  lastUsedAt: IsoDateTime | null;
  lastUsedQuantityAndUnit: LastUsedQuantity | null;
}

export interface FoodEquivalence extends BaseRecord {
  foodId: string;
  label: string;
  /** Gramos o ml (según baseUnit del alimento) por unidad casera/envase. */
  baseQuantity: number | null;
  /** Peso cocido / peso crudo. */
  rawToCookedYieldFactor: number | null;
  source: string;
  precision: 'exact' | 'approximate';
  version: number;
}

export interface Recipe extends BaseRecord {
  /** Receta raíz de la que esta es una versión; null en la primera. */
  parentRecipeId: string | null;
  version: number;
  name: string;
  servings: number;
  totalCookedWeightG: number | null;
  prepTimeMin: number | null;
  instructions: string[];
  useCountByMealSlot: Partial<Record<MealSlot, number>>;
  lastUsedAt: IsoDateTime | null;
  lastUsedQuantityAndUnit: LastUsedQuantity | null;
}

export interface RecipeIngredient extends BaseRecord {
  recipeId: string;
  foodId: string;
  quantity: number;
  unit: QuantityUnit;
  state: FoodState;
  isOptional: boolean;
  sortOrder: number;
  equivalenceId?: string;
  /** Instantánea de la cantidad original. Las versiones previas pueden carecer de ella. */
  snapshot?: {
    name: string;
    unitLabel: string;
    nutrients: Nutrients;
    pendingReview: boolean;
  };
}

// ───────────── Bloque 3 — Compras y despensa ─────────────

export interface Purchase extends BaseRecord {
  merchantName: string;
  storeBranch: string | null;
  purchaseDate: IsoDate;
  receiptNumber: string | null;
  currency: 'EUR';
  subtotalEur: number | null;
  totalDiscountEur: number | null;
  totalEur: number;
  photoId: string | null;
  /** id del JSON purchase-proposal de origen. */
  sourceJsonId: string | null;
  notes: string | null;
}

export interface PurchaseLine extends BaseRecord {
  purchaseId: string;
  lineNumber: number;
  rawText: string;
  foodId: string | null;
  isFoodItem: boolean;
  quantity: number;
  unit: 'unit' | 'g' | 'kg' | 'ml' | 'l';
  totalInventoryQuantity: { value: number; unit: InventoryUnit } | null;
  unitPriceEur: number | null;
  discountEur: number | null;
  lineTotalEur: number;
  /** Lote creado al confirmar la compra. */
  batchId: string | null;
}

export interface InventoryBatch extends BaseRecord {
  foodId: string;
  purchaseLineId: string | null;
  location: StorageLocation;
  unit: InventoryUnit;
  initialQuantity: number;
  remainingQuantity: number;
  expiryDate: IsoDate | null;
  openedAt: IsoDateTime | null;
  status: 'available' | 'depleted' | 'discarded';
}

export type InventoryMovementType =
  | 'purchase_in'
  | 'consumption_out'
  | 'manual_adjust'
  | 'waste_out'
  | 'reversal';

/** Libro inmutable: nunca se borra ni se sobrescribe un movimiento. */
export interface InventoryMovement extends BaseRecord {
  type: InventoryMovementType;
  /** Agrupa los movimientos de una misma acción. */
  operationId: string;
  /** Único: impide procesar dos veces la misma acción. */
  idempotencyKey: string;
  batchId: string;
  foodId: string;
  /** Con signo: positivo entra, negativo sale. */
  quantityDelta: number;
  unit: InventoryUnit;
  occurredAt: IsoDateTime;
  relatedDiaryEntryId: string | null;
  relatedPurchaseLineId: string | null;
  reversedMovementId: string | null;
  reversedOperationId: string | null;
  note: string | null;
}

// ───────────── Bloque 4 — Diario y planificación ─────────────

export interface MealPlanItem {
  itemType: 'food' | 'recipe';
  refId: string;
  quantity: number;
  unit: QuantityUnit;
}

/** Planificar no descuenta inventario. */
export interface MealPlan extends BaseRecord {
  date: IsoDate;
  mealSlot: MealSlot;
  dayType: DayType | null;
  items: MealPlanItem[];
  sourceJsonId: string | null;
  notes: string | null;
}

export interface DiaryDay extends BaseRecord {
  /** Índice único. */
  date: IsoDate;
  dayType: DayType;
  completionStatus: 'open' | 'partial' | 'completed';
  activeGoalId: string | null;
  /** Instantánea inmutable de las metas de ese día. */
  goalTargetsSnapshot: DayTargets | null;
  notes: string | null;
}

export interface SnapshotIngredient {
  foodId: string;
  name: string;
  quantity: number;
  unit: QuantityUnit;
  gramsEquivalent: number | null;
  nutrients: Nutrients;
}

export interface DiaryEntryRevision {
  revision: number;
  changedAt: IsoDateTime;
  previousFoodId: string | null;
  previousName: string;
  previousQuantity: number;
  previousUnit: QuantityUnit;
  previousGramsEquivalent: number | null;
  previousNutrients: Nutrients;
  note?: string;
}

export interface DiaryEntry extends BaseRecord {
  date: IsoDate;
  mealSlot: MealSlot;
  itemType: 'food' | 'recipe';
  foodId: string | null;
  recipeId: string | null;
  quantity: number;
  unit: QuantityUnit;
  gramsEquivalent: number | null;
  state: FoodState | null;
  // Instantánea completa e inmutable
  snapshotName: string;
  snapshotUnitLabel: string;
  /** Nutrientes totales de la cantidad registrada. */
  snapshotNutrients: Nutrients;
  snapshotIngredients: SnapshotIngredient[] | null;
  revisionHistory: DiaryEntryRevision[];
}

// ───────────── Bloque 5 — Progreso ─────────────

export interface ProgressLog extends BaseRecord {
  /** Índice único. */
  date: IsoDate;
  weightKg: number | null;
  sleepHours: number | null;
  sleepQuality1to5: number | null;
  energyLevel1to5: number | null;
  hungerLevel1to5: number | null;
  trained: boolean | null;
  notes: string | null;
}

// ───────────── Bloque 6 — IA, fotos y configuración ─────────────

export interface AiExchangeLog extends BaseRecord {
  /** `id` del documento JSON. Índice único: impide importaciones duplicadas. */
  externalJsonId: string;
  direction: 'export' | 'import';
  schema: string;
  formatVersion: string;
  source: 'app' | 'chatgpt' | 'gemini';
  fileName: string | null;
  documentCreatedAt: IsoDateTime;
  status: 'exported' | 'previewed' | 'applied' | 'rejected' | 'test';
  summary: string | null;
}

export interface Photo extends BaseRecord {
  kind: 'receipt' | 'product' | 'other';
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  blob: Blob | null;
  relatedPurchaseId: string | null;
}

export interface AppSetting extends BaseRecord {
  /** Índice único. */
  key: string;
  value: unknown;
}
