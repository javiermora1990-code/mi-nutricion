import { z } from 'zod';

export const FORMAT_VERSION = '1.0';

export const SCHEMA_IDS = {
  profileContext: 'mi-nutricion/profile-context',
  purchaseProposal: 'mi-nutricion/purchase-proposal',
  aiProposal: 'mi-nutricion/ai-proposal',
  backup: 'mi-nutricion/backup',
  encryptedBackup: 'mi-nutricion/encrypted-backup',
} as const;

export type SchemaId = (typeof SCHEMA_IDS)[keyof typeof SCHEMA_IDS];

/** ISO-8601 UTC (termina en Z). */
export const isoDateTime = z.iso.datetime();
export const isoDate = z.iso.date();
export const numOrNull = z.number().nullable();
export const strOrNull = z.string().nullable();
export const nonNegative = z.number().nonnegative();

/** Nutrientes por 100 g/ml: los valores desconocidos deben ser null, no 0. */
export const nutrientsSchema = z.object({
  energyKcal: numOrNull,
  proteinG: numOrNull,
  carbsG: numOrNull,
  fatG: numOrNull,
  fiberG: numOrNull,
  sugarsG: numOrNull.optional(),
  saturatedFatG: numOrNull.optional(),
  saltG: numOrNull.optional(),
});

export const targetRangeSchema = z.object({
  central: z.number(),
  minTolerance: z.number(),
  maxTolerance: z.number(),
});

export const dayTargetsSchema = z.object({
  energyKcal: targetRangeSchema,
  proteinG: targetRangeSchema,
  fatG: targetRangeSchema,
  carbsG: targetRangeSchema,
  fiberG: targetRangeSchema,
});

export const targetsByDayTypeSchema = z.object({
  default: dayTargetsSchema,
  training: dayTargetsSchema.optional(),
  rest: dayTargetsSchema.optional(),
});

export const quantityUnitSchema = z.enum(['g', 'ml', 'unit', 'portion']);
export const mealSlotSchema = z.enum(['breakfast', 'mid_morning', 'lunch', 'snack', 'dinner', 'other']);
export const foodStateSchema = z.enum(['raw', 'cooked']);
export const locationSchema = z.enum(['pantry', 'fridge', 'freezer']);
export const foodSourceSchema = z.enum(['user_label', 'bedca', 'off', 'usda', 'estimate']);

/**
 * Envoltura común (sección 12). Estricta: no admite campos desconocidos
 * en el nivel superior.
 */
export function envelope<S extends SchemaId, P extends z.ZodType>(schemaId: S, payload: P) {
  return z.strictObject({
    schema: z.literal(schemaId),
    formatVersion: z.literal(FORMAT_VERSION),
    id: z.uuidv4(),
    createdAt: isoDateTime,
    source: z.enum(['app', 'chatgpt', 'gemini']),
    locale: z.literal('es-ES'),
    currency: z.literal('EUR'),
    payload,
  });
}
