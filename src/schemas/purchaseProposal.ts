import { z } from 'zod';
import {
  SCHEMA_IDS,
  envelope,
  foodSourceSchema,
  foodStateSchema,
  isoDate,
  locationSchema,
  nonNegative,
  numOrNull,
  nutrientsSchema,
  strOrNull,
} from './common';

/** Alimento nuevo propuesto por la IA; siempre queda pendiente de verificar. */
export const proposedCatalogFoodSchema = z.object({
  name: z.string().min(1),
  brand: strOrNull,
  kind: z.enum(['generic', 'commercial']),
  baseUnit: z.enum(['g', 'ml']),
  defaultState: foodStateSchema.nullable().optional(),
  source: foodSourceSchema,
  externalId: strOrNull.optional(),
  nutrientsPer100: nutrientsSchema,
  verificationStatus: z.literal('pending_review'),
  equivalences: z
    .array(
      z.object({
        label: z.string().min(1),
        baseQuantity: numOrNull,
        rawToCookedYieldFactor: numOrNull.optional(),
      }),
    )
    .optional(),
});

const receipt = z.object({
  merchantName: z.string().min(1),
  storeBranch: strOrNull,
  purchaseDate: isoDate,
  receiptNumber: strOrNull,
  currency: z.literal('EUR'),
  subtotalEur: nonNegative.nullable(),
  totalDiscountEur: nonNegative.nullable(),
  totalEur: nonNegative,
  aiConfidence: z.enum(['high', 'medium', 'low']),
  notes: strOrNull,
});

const line = z.object({
  // Identificación
  lineNumber: z.number().int().positive(),
  rawText: z.string(),
  normalizedName: z.string().min(1),
  brand: strOrNull,
  isFoodItem: z.boolean(),
  matchedFoodId: strOrNull,
  matchConfidence: z.number().min(0).max(1),
  // Cantidades
  quantity: z.number().positive(),
  unit: z.enum(['unit', 'g', 'kg', 'ml', 'l']),
  netContentPerUnit: z.object({ value: z.number().positive(), unit: z.enum(['g', 'ml']) }).nullable(),
  totalInventoryQuantity: z
    .object({ value: z.number().positive(), unit: z.enum(['g', 'ml', 'unit']) })
    .nullable(),
  // Precios en euros
  unitPriceEur: nonNegative.nullable(),
  discountEur: nonNegative.nullable(),
  lineTotalEur: z.number(),
  // Almacenamiento sugerido
  suggestedLocation: locationSchema.nullable(),
  suggestedCategory: strOrNull,
  proposedCatalogFood: proposedCatalogFoodSchema.nullable().optional(),
});

/** 12.2 — Propuesta de compra desde ticket (IA → app). */
export const purchaseProposalPayloadSchema = z.object({
  receipt,
  lines: z.array(line).min(1),
});

export const purchaseProposalSchema = envelope(
  SCHEMA_IDS.purchaseProposal,
  purchaseProposalPayloadSchema,
);
export type PurchaseProposalDocument = z.infer<typeof purchaseProposalSchema>;
