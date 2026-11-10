/**
 * Documentos de ejemplo válidos para los 5 esquemas.
 * Se usan en las pruebas automáticas y en la pantalla de prueba de Drive.
 * Son datos ficticios: no proceden de ningún registro real.
 */
import { TABLE_NAMES } from '../db/db';
import { FORMAT_VERSION, SCHEMA_IDS } from './common';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

const envelopeBase = (schema: string, source: 'app' | 'chatgpt' | 'gemini') => ({
  schema,
  formatVersion: FORMAT_VERSION,
  id: uuid(),
  createdAt: now(),
  source,
  locale: 'es-ES',
  currency: 'EUR',
});

const range = (central: number, min: number, max: number) => ({
  central,
  minTolerance: min,
  maxTolerance: max,
});

const sampleTargets = () => ({
  default: {
    energyKcal: range(2600, 2450, 2750),
    proteinG: range(120, 112, 144),
    fatG: range(80, 64, 96),
    carbsG: range(350, 300, 400),
    fiberG: range(30, 25, 40),
  },
});

export function sampleProfileContext() {
  return {
    ...envelopeBase(SCHEMA_IDS.profileContext, 'app'),
    payload: {
      profile: {
        version: 1,
        updatedAt: now(),
        sex: 'male',
        ageYears: 40,
        heightCm: 170,
        weightKg: 70,
        weightDeclaredOn: '2026-11-09',
        isNatural: true,
        workType: 'seated',
        dailyStepsBand: '5000-7500',
        trainingDaysPerWeek: 3,
        trainingType: 'weights',
      },
      activeGoal: null,
      activeTargets: null,
      catalogSummary: [
        {
          foodId: uuid(),
          name: 'Arroz blanco (ejemplo de prueba)',
          brand: null,
          kind: 'generic',
          baseUnit: 'g',
          defaultState: 'raw',
          nutrientsPer100: { energyKcal: 360, proteinG: 6.6, carbsG: 79.3, fatG: 0.6, fiberG: null },
        },
      ],
      pantrySummary: [],
    },
  };
}

export function samplePurchaseProposal() {
  return {
    ...envelopeBase(SCHEMA_IDS.purchaseProposal, 'chatgpt'),
    payload: {
      receipt: {
        merchantName: 'Supermercado de prueba',
        storeBranch: null,
        purchaseDate: '2026-11-09',
        receiptNumber: null,
        currency: 'EUR',
        subtotalEur: 3.25,
        totalDiscountEur: 0.3,
        totalEur: 2.95,
        aiConfidence: 'medium',
        notes: null,
      },
      lines: [
        {
          lineNumber: 1,
          rawText: 'ARROZ REDONDO 1KG',
          normalizedName: 'Arroz redondo',
          brand: null,
          isFoodItem: true,
          matchedFoodId: null,
          matchConfidence: 0.4,
          quantity: 1,
          unit: 'unit',
          netContentPerUnit: { value: 1000, unit: 'g' },
          totalInventoryQuantity: { value: 1000, unit: 'g' },
          unitPriceEur: 1.35,
          discountEur: 0.3,
          lineTotalEur: 1.05,
          suggestedLocation: 'pantry',
          suggestedCategory: 'grains_tubers_bread_and_pasta',
          proposedCatalogFood: {
            name: 'Arroz redondo',
            brand: null,
            kind: 'commercial',
            baseUnit: 'g',
            source: 'estimate',
            nutrientsPer100: { energyKcal: 350, proteinG: 7, carbsG: 78, fatG: 0.9, fiberG: null },
            verificationStatus: 'pending_review',
          },
        },
        {
          lineNumber: 2,
          rawText: 'BOLSA PLASTICO',
          normalizedName: 'Bolsa',
          brand: null,
          isFoodItem: false,
          matchedFoodId: null,
          matchConfidence: 0,
          quantity: 1,
          unit: 'unit',
          netContentPerUnit: null,
          totalInventoryQuantity: null,
          unitPriceEur: 0.15,
          discountEur: null,
          lineTotalEur: 0.15,
          suggestedLocation: null,
          suggestedCategory: null,
        },
      ],
    },
  };
}

export function sampleAiProposal() {
  return {
    ...envelopeBase(SCHEMA_IDS.aiProposal, 'gemini'),
    payload: {
      basedOnContextId: null,
      proposalKind: 'combined',
      recipes: [
        {
          tempId: 'r1',
          name: 'Arroz con pollo (prueba)',
          servings: 2,
          prepTimeMin: 30,
          totalCookedWeightG: null,
          instructions: ['Cocer el arroz.', 'Saltear el pollo.'],
          ingredients: [
            { foodId: null, proposedName: 'Arroz blanco', quantity: 160, unit: 'g', state: 'raw', isOptional: false },
            { foodId: null, proposedName: 'Pechuga de pollo', quantity: 300, unit: 'g', state: 'raw', isOptional: false },
          ],
        },
      ],
      goalAdjustment: {
        reason: 'Ejemplo de prueba',
        analyzedPeriodDays: 14,
        proposedTargets: sampleTargets(),
        activityFactorSuggested: null,
        assumptions: [],
        warnings: [],
      },
    },
  };
}

export function sampleBackup() {
  const tables = Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as unknown[]]));
  const tableCounts = Object.fromEntries(TABLE_NAMES.map((t) => [t, 0]));
  return {
    ...envelopeBase(SCHEMA_IDS.backup, 'app'),
    payload: {
      appVersion: '0.1.0',
      dbSchemaVersion: 1,
      includesPhotos: false,
      integrity: { tableCounts, dataSha256: '0'.repeat(64) },
      tables,
    },
  };
}

export function sampleEncryptedBackup() {
  return {
    schema: SCHEMA_IDS.encryptedBackup,
    formatVersion: FORMAT_VERSION,
    createdAt: now(),
    innerType: 'backup-json',
    kdf: { algorithm: 'PBKDF2', hash: 'SHA-256', iterations: 600000, saltBase64: 'AAAAAAAAAAAAAAAAAAAAAA==' },
    cipher: { algorithm: 'AES-256-GCM', chunkSizeBytes: 4194304, totalChunks: 1 },
    chunks: [{ index: 0, ivBase64: 'AAAAAAAAAAAAAAAA', ciphertextBase64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
  };
}
