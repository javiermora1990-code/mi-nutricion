import { z } from 'zod';
import {
  SCHEMA_IDS,
  envelope,
  foodStateSchema,
  isoDate,
  mealSlotSchema,
  numOrNull,
  nutrientsSchema,
  quantityUnitSchema,
  strOrNull,
  targetsByDayTypeSchema,
} from './common';
import { proposedCatalogFoodSchema } from './purchaseProposal';

const recipe = z.object({
  tempId: z.string().min(1),
  name: z.string().min(1),
  servings: z.number().positive(),
  prepTimeMin: numOrNull,
  totalCookedWeightG: numOrNull,
  instructions: z.array(z.string()),
  ingredients: z
    .array(
      z.object({
        /** null si el alimento aún no existe en el catálogo. */
        foodId: strOrNull,
        proposedName: z.string().min(1),
        quantity: z.number().positive(),
        unit: quantityUnitSchema,
        state: foodStateSchema,
        isOptional: z.boolean(),
      }),
    )
    .min(1),
});

const mealPlan = z.object({
  startDate: isoDate,
  endDate: isoDate,
  days: z.array(
    z.object({
      date: isoDate,
      dayType: z.enum(['training', 'rest']),
      meals: z.array(
        z.object({
          mealSlot: mealSlotSchema,
          items: z.array(
            z.object({
              itemType: z.enum(['food', 'recipe']),
              refId: z.string().min(1),
              quantity: z.number().positive(),
              unit: quantityUnitSchema,
            }),
          ),
        }),
      ),
      estimatedTotals: nutrientsSchema.optional(),
    }),
  ),
  shoppingSuggestions: z.array(
    z.object({
      foodId: strOrNull,
      name: z.string().min(1),
      quantityToBuy: z.number().positive(),
      unit: z.enum(['g', 'kg', 'ml', 'l', 'unit']),
      reason: z.string(),
    }),
  ),
});

const goalAdjustment = z.object({
  reason: z.string().min(1),
  analyzedPeriodDays: z.number().int().positive(),
  proposedTargets: targetsByDayTypeSchema,
  activityFactorSuggested: numOrNull,
  assumptions: z.array(z.string()),
  warnings: z.array(z.string()),
});

const REQUIRED_SECTIONS = {
  recipes: ['recipes'],
  meal_plan: ['mealPlan'],
  goal_adjustment: ['goalAdjustment'],
  catalog_items: ['catalogItems'],
  combined: [],
} as const;

/** 12.3 — Otras propuestas de la IA (IA → app). */
export const aiProposalPayloadSchema = z
  .object({
    basedOnContextId: z.uuid().nullable(),
    proposalKind: z.enum(['recipes', 'meal_plan', 'goal_adjustment', 'catalog_items', 'combined']),
    recipes: z.array(recipe).optional(),
    mealPlan: mealPlan.optional(),
    goalAdjustment: goalAdjustment.optional(),
    catalogItems: z.array(proposedCatalogFoodSchema).optional(),
  })
  .superRefine((p, ctx) => {
    for (const key of REQUIRED_SECTIONS[p.proposalKind]) {
      if (p[key] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `proposalKind "${p.proposalKind}" requiere la sección "${key}"`,
        });
      }
    }
    if (
      p.proposalKind === 'combined' &&
      !p.recipes && !p.mealPlan && !p.goalAdjustment && !p.catalogItems
    ) {
      ctx.addIssue({ code: 'custom', message: 'Una propuesta "combined" debe incluir al menos una sección' });
    }
  });

export const aiProposalSchema = envelope(SCHEMA_IDS.aiProposal, aiProposalPayloadSchema);
export type AiProposalDocument = z.infer<typeof aiProposalSchema>;
