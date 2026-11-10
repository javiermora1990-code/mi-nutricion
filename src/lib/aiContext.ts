import { z } from 'zod';
import { newBase, nowIso, type MiNutricionDB } from '../db/db';
import { aiProposalSchema } from '../schemas/aiProposal';
import { profileContextSchema, type ProfileContextDocument } from '../schemas/profileContext';
import { FORMAT_VERSION, SCHEMA_IDS } from '../schemas/common';
import { localIsoDate } from './dates';
import { getActiveGoal, getCurrentProfile, getCurrentWeight, profileAge } from './profileGoals';
import { latestRecipes, nutrientsPerServing } from './recipes';
import { seedCatalog } from './catalog';

export function exchangeBaseName(type: 'contexto' | 'recetas' | 'plan' | 'propuesta', id: string, date = new Date()): string {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join('-');
  return `${type}_${localIsoDate(date)}_${time}_${id.slice(0, 8)}`;
}

export function aiInstructions(contextId: string): string {
  return [
    'Ayúdame a preparar recetas y un menú adaptados al contexto adjunto de Mi Nutrición.',
    'Primero pregúntame la semana, personas, comidas que quiero planificar, gustos, alergias, alimentos que evito, tiempo y presupuesto si no te los he indicado. No supongas estas preferencias.',
    'Trabajaremos conversando. Presenta las propuestas en español de España. Genera el archivo final solo cuando te confirme que me encaja.',
    'Usa mis metas aprobadas de activeTargets. Sus límites minTolerance y maxTolerance son valores absolutos. Si faltan metas, pregúntame el criterio antes de afirmar que el menú las cumple.',
    'Utiliza foodId del catalogSummary y el estado raw/cooked de la ficha elegida. Usa cantidades en su baseUnit g o ml. Para unidades caseras incluye el equivalenceId exacto del contexto.',
    'Reutiliza recetas de recipeSummary mediante recipeId. Para una nueva receta usa un tempId único en el documento. Para revisar una receta existente indica existingRecipeId de su última versión y una receta completa.',
    'Las cantidades de ingredients corresponden a todas las servings de la receta. Las cantidades de recetas en el menú son raciones, con unit "portion". También puedes usar g si existe totalCookedWeightG.',
    'Los ingredientes isOptional se incluyen en el cálculo. Si decidimos omitir uno, elimínalo de la propuesta final.',
    'Si falta un alimento, propón un catalogItems con el mismo name que proposedName, foodId null y verificationStatus "pending_review". Documenta su fuente y deja cada nutriente desconocido en null. No inventes identificadores ni cifras nutricionales.',
    'Cada nutrientsPer100 lleva energyKcal, proteinG, carbsG, fatG y fiberG. Los datos desconocidos son null. El cero solo significa un valor conocido de cero. La aplicación calculará los totales de los ingredientes.',
    'Devuelve solo recetas, menú y alimentos en este flujo. Omite goalAdjustment. Los ajustes de metas requieren otro flujo de aprobación.',
    'El menú debe tener fechas reales dentro de startDate y endDate, con una sola entrada por fecha y mealSlot. Indica dayType training o rest según lo que acordemos. Las tomas incluidas se revisarán antes de sustituir las guardadas.',
    'Para referenciar en el menú una receta nueva usa su tempId en refId. Para alimentos nuevos usa el mismo name que catalogItems en refId. Para alimentos o recetas existentes usa sus UUID.',
    'shoppingSuggestions puede ser []. La app obtiene las necesidades de ingredientes del menú. pantrySummary solo contiene existencias conocidas, y una lista vacía no permite afirmar qué tengo en casa.',
    'El JSON final debe tener schema "mi-nutricion/ai-proposal", formatVersion "1.0", locale "es-ES", currency "EUR", source "chatgpt" o "gemini", createdAt UTC ISO-8601 y un id UUID v4 nuevo.',
    `Usa basedOnContextId "${contextId}". proposalKind será recipes, meal_plan, catalog_items o combined según el contenido.`,
    'Entrega un archivo .json descargable sin Markdown alrededor. Usa nombre tipo_AAAA-MM-DD_HH-mm-ss_id8.json, donde tipo es recetas, plan o propuesta, con la hora local y los ocho primeros caracteres del id. Si revisamos una propuesta final, genera otro id y otro archivo.',
    'Yo guardaré el archivo en Drive/Mi Nutrición/03_IA y lo importaré para revisar y confirmar.',
    'Contrato JSON de la propuesta final',
    JSON.stringify(z.toJSONSchema(aiProposalSchema), null, 2),
  ].join('\n\n');
}

export async function createProfileContext(db: MiNutricionDB, date = new Date()): Promise<ProfileContextDocument> {
  await seedCatalog(db);
  const today = localIsoDate(date);
  return db.transaction('r', [
    db.profiles, db.progressLogs, db.nutritionGoals, db.foods,
    db.foodEquivalences, db.recipes, db.recipeIngredients, db.inventoryBatches,
  ], async () => {
      const [profile, weight, active, foods, equivalents, recipes, ingredients, batches] = await Promise.all([
        getCurrentProfile(db), getCurrentWeight(db), getActiveGoal(db),
        db.foods.filter((food) => !food.deletedAt).toArray(),
        db.foodEquivalences.filter((e) => !e.deletedAt).toArray(),
        db.recipes.toArray(), db.recipeIngredients.filter((i) => !i.deletedAt).toArray(),
        db.inventoryBatches.filter((batch) => !batch.deletedAt && batch.status === 'available' && batch.remainingQuantity > 0).toArray(),
      ]);
      if (!profile || !weight) throw new Error('Completa primero tu perfil en Configuración.');
      const ageYears = profileAge(profile, today);
      if (ageYears === null) throw new Error('Completa tu edad en el perfil.');
      const id = crypto.randomUUID();
      const pantry = new Map<string, ProfileContextDocument['payload']['pantrySummary'][number]>();
      for (const batch of batches) {
        const food = foods.find((food) => food.id === batch.foodId);
        if (!food) continue;
        const key = `${food.id}|${batch.unit}`;
        const entry = pantry.get(key) ?? {
          foodId: food.id, name: food.name, availableQuantity: 0, unit: batch.unit, nearestExpiryDate: null,
        };
        entry.availableQuantity += batch.remainingQuantity;
        if (batch.expiryDate && (!entry.nearestExpiryDate || batch.expiryDate < entry.nearestExpiryDate)) {
          entry.nearestExpiryDate = batch.expiryDate;
        }
        pantry.set(key, entry);
      }
      return profileContextSchema.parse({
        schema: SCHEMA_IDS.profileContext, formatVersion: FORMAT_VERSION, id,
        createdAt: nowIso(date), source: 'app', locale: 'es-ES', currency: 'EUR',
        payload: {
          profile: {
            version: profile.version, updatedAt: profile.updatedAt, sex: profile.sex, ageYears,
            heightCm: profile.heightCm, weightKg: weight.weightKg, weightDeclaredOn: weight.date,
            isNatural: profile.isNatural, workType: profile.workType, dailyStepsBand: profile.dailyStepsBand,
            trainingDaysPerWeek: profile.trainingDaysPerWeek, trainingType: profile.trainingType,
          },
          activeGoal: active ? {
            id: active.id, version: active.version, objective: active.objective,
            targetRateKgPerWeek: active.targetRateKgPerWeek, bmrFormula: active.bmrFormula,
            estimatedBmrKcal: active.estimatedBmrKcal, activityFactor: active.activityFactor,
            estimatedTdeeKcal: active.estimatedTdeeKcal, approvedAt: active.approvedAt,
          } : null,
          activeTargets: active?.targets ?? null,
          catalogSummary: foods.map((food) => ({
            foodId: food.id, name: food.name, brand: food.brand, kind: food.kind, baseUnit: food.baseUnit,
            defaultState: food.defaultState, nutrientsPer100: food.nutrientsPer100, verificationStatus: food.verificationStatus,
            equivalences: equivalents.filter((e) => e.foodId === food.id && e.baseQuantity !== null)
              .map((e) => ({ id: e.id, label: e.label, baseQuantity: e.baseQuantity })),
          })),
          pantrySummary: [...pantry.values()],
          recipeSummary: latestRecipes(recipes).map((recipe) => ({
            recipeId: recipe.id, name: recipe.name, version: recipe.version, servings: recipe.servings,
            totalCookedWeightG: recipe.totalCookedWeightG,
            nutrientsPerServing: nutrientsPerServing(recipe, ingredients.filter((i) => i.recipeId === recipe.id)),
            prepTimeMin: recipe.prepTimeMin, instructions: recipe.instructions,
            ingredients: ingredients.filter((i) => i.recipeId === recipe.id).sort((a, b) => a.sortOrder - b.sortOrder).map((i) => ({
              foodId: i.foodId, name: i.snapshot?.name ?? foods.find((food) => food.id === i.foodId)?.name ?? 'Alimento no disponible',
              quantity: i.quantity, unit: i.unit, state: i.state, isOptional: i.isOptional, equivalenceId: i.equivalenceId,
            })),
          })),
          aiInstructions: aiInstructions(id),
        },
      });
    });
}

export async function logContextExport(db: MiNutricionDB, document: ProfileContextDocument, fileName: string) {
  await db.transaction('rw', db.aiExchangeLog, async () => {
    if (await db.aiExchangeLog.get({ externalJsonId: document.id })) return;
    await db.aiExchangeLog.add({
      ...newBase(), externalJsonId: document.id, direction: 'export', schema: document.schema,
      formatVersion: document.formatVersion, source: 'app', fileName,
      documentCreatedAt: document.createdAt, status: 'exported',
      summary: `Contexto con ${document.payload.catalogSummary.length} alimentos`,
    });
  });
}
