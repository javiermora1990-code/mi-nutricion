import { z } from 'zod';
import {
  SCHEMA_IDS,
  envelope,
  foodStateSchema,
  isoDate,
  isoDateTime,
  numOrNull,
  nutrientsSchema,
  strOrNull,
  targetsByDayTypeSchema,
} from './common';

/** 12.1 — Perfil y contexto exportado (app → IA). */
const profile = z.object({
  version: z.number().int().positive(),
  updatedAt: isoDateTime,
  sex: z.enum(['male', 'female']),
  ageYears: z.number().int().min(14).max(110),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(300),
  weightDeclaredOn: isoDate,
  isNatural: z.boolean(),
  workType: z.enum(['seated', 'standing', 'physical']),
  dailyStepsBand: z.string(),
  trainingDaysPerWeek: z.number().int().min(0).max(7),
  trainingType: z.string(),
});

const activeGoal = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  objective: z.enum(['maintain', 'fat_loss', 'muscle_gain']),
  targetRateKgPerWeek: numOrNull,
  bmrFormula: z.literal('Mifflin-St Jeor'),
  estimatedBmrKcal: z.number().positive(),
  activityFactor: z.number().min(1).max(2.5),
  estimatedTdeeKcal: z.number().positive(),
  approvedAt: isoDateTime,
});

const trendWindow = z.object({
  evaluableDays: z.number().int().nonnegative(),
  avgEnergyKcal: numOrNull,
  avgProteinG: numOrNull,
  avgCarbsG: numOrNull,
  avgFatG: numOrNull,
  avgFiberG: numOrNull,
  avgWeightKg: numOrNull,
  avgSleepHours: numOrNull,
  avgEnergyLevel1to5: numOrNull,
  avgHungerLevel1to5: numOrNull,
});

const catalogItem = z.object({
  foodId: z.uuid(),
  name: z.string().min(1),
  brand: strOrNull,
  kind: z.enum(['generic', 'commercial']),
  baseUnit: z.enum(['g', 'ml']),
  defaultState: foodStateSchema.nullable(),
  nutrientsPer100: nutrientsSchema,
  verificationStatus: z.enum(['verified', 'pending_review']).optional(),
  equivalences: z.array(z.object({
    id: z.uuid(),
    label: z.string(),
    baseQuantity: numOrNull,
  })).optional(),
});

const pantryItem = z.object({
  foodId: z.uuid(),
  name: z.string().min(1),
  availableQuantity: z.number().nonnegative(),
  unit: z.enum(['g', 'ml', 'unit']),
  nearestExpiryDate: isoDate.nullable(),
});

export const profileContextPayloadSchema = z.object({
  profile,
  /** null mientras no exista una meta aprobada. */
  activeGoal: activeGoal.nullable(),
  activeTargets: targetsByDayTypeSchema.nullable(),
  recentTrends: z
    .object({ last7Days: trendWindow.optional(), last14Days: trendWindow.optional() })
    .optional(),
  catalogSummary: z.array(catalogItem),
  pantrySummary: z.array(pantryItem),
  recipeSummary: z.array(z.object({
    recipeId: z.uuid(),
    name: z.string(),
    version: z.number().int().positive(),
    servings: z.number().positive(),
    totalCookedWeightG: numOrNull,
    nutrientsPerServing: nutrientsSchema,
    prepTimeMin: numOrNull.optional(),
    instructions: z.array(z.string()).optional(),
    ingredients: z.array(z.object({
      foodId: z.uuid(), name: z.string(), quantity: z.number().positive(),
      unit: z.enum(['g', 'ml', 'unit', 'portion']), state: foodStateSchema,
      equivalenceId: z.uuid().optional(), isOptional: z.boolean(),
    })).optional(),
  })).optional(),
  aiInstructions: z.string().optional(),
});

export const profileContextSchema = envelope(SCHEMA_IDS.profileContext, profileContextPayloadSchema);
export type ProfileContextDocument = z.infer<typeof profileContextSchema>;
