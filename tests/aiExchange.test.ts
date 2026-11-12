import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, DB_SCHEMA_VERSION, newBase, type MiNutricionDB } from '../src/db/db';
import type { Food } from '../src/db/types';
import { createProfileContext, exchangeBaseName, logContextExport } from '../src/lib/aiContext';
import { applyProposal, prepareProposal, previewRecipeNutrients, proposalIssues, type ProposedRecipe } from '../src/lib/aiImport';
import { mapNutrients, saveFood } from '../src/lib/catalog';
import { shareText } from '../src/lib/fileExchange';
import { calculateGoalProposal } from '../src/lib/goalCalculator';
import { planNutrients, shoppingList, snapshotPlanItem } from '../src/lib/planning';
import { approveGoal, goalInputFromProfile, saveGoalProposal, saveProfileVersion, type ProfileInput } from '../src/lib/profileGoals';
import { EMPTY_PROGRESS, saveProgressLog } from '../src/lib/progress';
import { saveRecipe } from '../src/lib/recipes';
import { aiProposalSchema, type AiProposalDocument } from '../src/schemas/aiProposal';
import { parseDocumentText } from '../src/schemas';

const when = '2026-01-12T12:00:00Z';
const date = new Date(2026, 0, 12, 13, 14, 15);
const profileInput: ProfileInput = {
  sex: 'female', birthDate: null, ageYears: 35, heightCm: 168, declaredWeightKg: 65, isNatural: true,
  workType: 'seated', dailyStepsBand: '5000-7500', trainingDaysPerWeek: 3, trainingType: 'weights',
};
let db: MiNutricionDB;
let food: Food;

function recipe(foodId: string): ProposedRecipe {
  return {
    tempId: 'receta-prueba', name: 'Receta ficticia', servings: 2, prepTimeMin: null, totalCookedWeightG: 150, instructions: ['Preparar.'],
    ingredients: [{ foodId, proposedName: 'Alimento ficticio', quantity: 100, unit: 'g', state: 'raw', isOptional: false }],
  };
}

function proposal(): AiProposalDocument {
  return {
    schema: 'mi-nutricion/ai-proposal', formatVersion: '1.0', id: crypto.randomUUID(), createdAt: when,
    source: 'chatgpt', locale: 'es-ES', currency: 'EUR',
    payload: {
      basedOnContextId: null, proposalKind: 'combined', recipes: [recipe(food.id)],
      mealPlan: {
        startDate: '2026-01-12', endDate: '2026-01-18',
        days: [{
          date: '2026-01-12', dayType: 'rest',
          meals: [{ mealSlot: 'dinner', items: [{ itemType: 'recipe', refId: 'receta-prueba', quantity: 3, unit: 'portion' }] }],
        }],
        shoppingSuggestions: [],
      },
    },
  };
}

beforeEach(async () => {
  db = createDb(`ai-exchange-${crypto.randomUUID()}`);
  food = await saveFood(db, {
    name: 'Alimento ficticio', brand: null, kind: 'generic', category: null, baseUnit: 'g', defaultState: 'raw',
    source: 'user_label', externalId: null, sourceFetchedAt: null, sourceVersion: null, verificationStatus: 'verified',
    nutrientsPer100: { ...mapNutrients(() => null), energyKcal: 200, proteinG: 10, fatG: 0 },
  });
});
afterEach(async () => { vi.unstubAllGlobals(); await db.delete(); });

describe('Contexto real e instrucciones', () => {
  it('exporta el peso más reciente, catálogo e instrucciones y solo metas aprobadas', async () => {
    const profile = await saveProfileVersion(db, profileInput, '2026-01-01');
    await saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, weightKg: 64.5 });
    const goal = await saveGoalProposal(db, calculateGoalProposal({
      ...goalInputFromProfile(profile, 64.5, '2026-01-12')!, objective: 'maintain', targetRateKgPerWeek: null,
    }));
    const first = await createProfileContext(db, date);
    expect(first.payload.profile).toMatchObject({ weightKg: 64.5, weightDeclaredOn: '2026-01-10', ageYears: 35 });
    expect(first.payload.activeGoal).toBeNull();
    expect(first.payload.profile.mealRoutine).toBeUndefined();
    expect(first.payload.weeklySummary?.weeks).toEqual([expect.objectContaining({
      weekStart: '2026-01-05', loggedDays: 0, avgWeightKg: 64.5, avgEnergyKcal: null,
    })]);
    expect(first.payload.catalogSummary).toHaveLength(119);
    expect(first.payload.catalogSummary.find((item) => item.foodId === food.id)?.nutrientsPer100.fiberG).toBeNull();
    expect(first.payload.aiInstructions).toContain(first.id);
    expect(first.payload.aiInstructions).toContain('existingRecipeId');
    expect(first.payload.aiInstructions).toContain('null');
    await approveGoal(db, goal.id, '2026-01-12');
    const second = await createProfileContext(db, date);
    expect(second.payload.activeGoal?.id).toBe(goal.id);
    expect(second.payload.activeTargets).toEqual(goal.targets);
    expect(second.id).not.toBe(first.id);
    expect(DB_SCHEMA_VERSION).toBe(1);
    expect(await db.aiExchangeLog.count()).toBe(0);
  });

  it('envía los horarios del perfil y omite el resumen semanal si no hay registros', async () => {
    await saveProfileVersion(db, { ...profileInput, mealRoutine: 'Como en la oficina' }, '2026-01-01');
    const context = await createProfileContext(db, date);
    expect(context.payload.profile.mealRoutine).toBe('Como en la oficina');
    expect(context.payload.weeklySummary).toBeUndefined();
    expect(context.payload.aiInstructions).toContain('weeklySummary');
  });

  it('agrupa existencias por alimento y unidad conservando la primera caducidad', async () => {
    await saveProfileVersion(db, profileInput, '2026-01-01');
    for (const [remainingQuantity, expiryDate] of [[100, '2026-02-01'], [40, '2026-01-20']] as const) {
      await db.inventoryBatches.add({
        ...newBase(when), foodId: food.id, purchaseLineId: null, location: 'pantry', unit: 'g',
        initialQuantity: 100, remainingQuantity, expiryDate, openedAt: null, status: 'available',
      });
    }
    const context = await createProfileContext(db, date);
    expect(context.payload.pantrySummary).toEqual([expect.objectContaining({ availableQuantity: 140, nearestExpiryDate: '2026-01-20' })]);
  });

  it('incluye las cantidades y preparación de las recetas guardadas para que la IA pueda revisarlas', async () => {
    await saveProfileVersion(db, profileInput, '2026-01-01');
    await saveRecipe(db, {
      name: 'Receta ficticia guardada', servings: 2, prepTimeMin: 10, totalCookedWeightG: null, instructions: ['Preparar.'],
    }, [{ foodId: food.id, quantity: 100, unit: 'g', state: 'raw', isOptional: false }]);
    const context = await createProfileContext(db, date);
    expect(context.payload.recipeSummary).toEqual([expect.objectContaining({
      name: 'Receta ficticia guardada', instructions: ['Preparar.'], prepTimeMin: 10,
      ingredients: [expect.objectContaining({ foodId: food.id, quantity: 100, unit: 'g' })],
      nutrientsPerServing: expect.objectContaining({ energyKcal: 100 }),
    })]);
  });

  it('conserva el formato Android al compartir y registra cada contexto una sola vez', async () => {
    await saveProfileVersion(db, profileInput, '2026-01-01');
    const context = await createProfileContext(db, date);
    const name = exchangeBaseName('contexto', context.id, date);
    expect(name).toBe(`contexto_2026-01-12_13-14-15_${context.id.slice(0, 8)}`);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { canShare: () => true, share });
    const text = JSON.stringify(context);
    expect((await shareText(text, name, 'txt')).status).toBe('shared');
    const argument = share.mock.calls[0][0];
    expect(argument.title).toBe(`${name}.json.txt`);
    expect(argument.files[0].type).toBe('text/plain');
    expect(await argument.files[0].text()).toBe(text);
    await Promise.all([logContextExport(db, context, argument.title), logContextExport(db, context, argument.title)]);
    expect(await db.aiExchangeLog.count()).toBe(1);
  });
});

describe('Revisión e importación atómica', () => {
  it('la vista previa no escribe y reconoce el documento por contenido', async () => {
    const document = proposal();
    const parsed = parseDocumentText(JSON.stringify(document));
    expect(parsed.ok).toBe(true);
    await prepareProposal(db, document);
    expect(await db.recipes.count()).toBe(0);
    expect(await db.mealPlans.count()).toBe(0);
    expect(await db.aiExchangeLog.count()).toBe(0);
  });

  it('recalcula los nutrientes de la vista previa y muestra desconocidos si no puede resolver un ingrediente', () => {
    const draft = recipe(food.id);
    expect(previewRecipeNutrients(draft, [food], [], [])).toMatchObject({ energyKcal: 100, proteinG: 5, fiberG: null });
    draft.ingredients[0].quantity = 200;
    expect(previewRecipeNutrients(draft, [food], [], []).energyKcal).toBe(200);
    draft.ingredients[0].foodId = null;
    expect(previewRecipeNutrients(draft, [food], [], [])).toEqual(mapNutrients(() => null));
  });

  it('aplica la edición revisada y vincula las recetas temporales al menú', async () => {
    const review = await prepareProposal(db, proposal());
    review.document.payload.recipes![0].ingredients[0].quantity = 200;
    await applyProposal(db, review, 'propuesta.json.txt', false, when);
    const [recipe] = await db.recipes.toArray();
    const [plan] = await db.mealPlans.toArray();
    expect(plan.items[0].refId).toBe(recipe.id);
    expect(plan.items[0].snapshot?.nutrients).toMatchObject({ energyKcal: 600, proteinG: 30, fiberG: null, fatG: 0 });
    expect(shoppingList([plan]).items[0]).toMatchObject({ foodId: food.id, quantity: 300, unit: 'g', state: 'raw' });
    expect(planNutrients([plan]).energyKcal).toBe(600);
    expect(await db.aiExchangeLog.get({ externalJsonId: review.document.id })).toMatchObject({ status: 'applied', fileName: 'propuesta.json.txt' });
  });

  it('resuelve alimentos nuevos por nombre y los guarda pendientes de verificar', async () => {
    const document = proposal();
    document.payload.catalogItems = [{
      name: 'Nuevo alimento ficticio', brand: null, kind: 'generic', baseUnit: 'g', defaultState: 'raw',
      source: 'estimate', verificationStatus: 'pending_review', nutrientsPer100: mapNutrients(() => null),
    }];
    document.payload.recipes![0].ingredients[0].foodId = null;
    document.payload.recipes![0].ingredients[0].proposedName = 'Nuevo alimento ficticio';
    const review = await prepareProposal(db, document);
    expect(review.document.payload.recipes![0].ingredients[0].foodId).toBe('catalog:0');
    await applyProposal(db, review, 'recetas.json', false);
    expect(await db.foods.get({ name: 'Nuevo alimento ficticio' })).toMatchObject({ verificationStatus: 'pending_review' });
    const [plan] = await db.mealPlans.toArray();
    expect(plan.items[0].snapshot?.nutrients.energyKcal).toBeNull();
  });

  it('resuelve por nombre un identificador de otro dispositivo y conserva el desconocido si no coincide', async () => {
    const document = proposal();
    document.payload.recipes![0].ingredients[0].foodId = crypto.randomUUID();
    const review = await prepareProposal(db, document);
    expect(review.document.payload.recipes![0].ingredients[0].foodId).toBe(food.id);
    const other = proposal();
    const foreignId = crypto.randomUUID();
    other.payload.recipes![0].ingredients[0] = { ...other.payload.recipes![0].ingredients[0], foodId: foreignId, proposedName: 'Sin coincidencia' };
    expect((await prepareProposal(db, other)).document.payload.recipes![0].ingredients[0].foodId).toBe(foreignId);
  });

  it('señala solo lo que hay que corregir y avisa de alimentos nuevos sin nutrientes', async () => {
    const clean = proposal();
    expect(proposalIssues(clean, [food], []).total).toBe(0);
    const document = proposal();
    document.payload.catalogItems = [{
      name: 'Nuevo alimento ficticio', brand: null, kind: 'generic', baseUnit: 'g', defaultState: 'raw',
      source: 'estimate', verificationStatus: 'pending_review', nutrientsPer100: mapNutrients(() => null),
    }];
    document.payload.recipes![0].ingredients.push(
      { foodId: null, proposedName: 'Ingrediente inventado', quantity: 10, unit: 'g', state: 'raw', isOptional: false },
      { foodId: food.id, proposedName: 'Alimento ficticio', quantity: 10, unit: 'g', state: 'cooked', isOptional: false },
    );
    document.payload.mealPlan!.days[0].meals[0].items.push({ itemType: 'recipe', refId: 'no-existe', quantity: 1, unit: 'portion' });
    const issues = proposalIssues(document, [food], []);
    expect(issues.foods[0]).toHaveLength(1);
    expect(issues.recipes[0]).toEqual([
      expect.stringContaining('Ingrediente inventado'),
      expect.stringContaining('estado'),
    ]);
    expect(issues.days[0]).toHaveLength(1);
    expect(issues.total).toBe(3);
  });

  it('revierte alimentos y recetas si falla una referencia del menú', async () => {
    const document = proposal();
    document.payload.catalogItems = [{
      name: 'Alimento nuevo de prueba', brand: null, kind: 'generic', baseUnit: 'g',
      source: 'estimate', verificationStatus: 'pending_review', nutrientsPer100: mapNutrients(() => null),
    }];
    document.payload.mealPlan!.days[0].meals[0].items[0].refId = 'receta-ausente';
    const review = await prepareProposal(db, document);
    await expect(applyProposal(db, review, 'propuesta.json', false)).rejects.toThrow('no está disponible');
    expect(await db.foods.count()).toBe(1);
    expect(await db.recipes.count()).toBe(0);
    expect(await db.recipeIngredients.count()).toBe(0);
    expect(await db.mealPlans.count()).toBe(0);
    expect(await db.aiExchangeLog.count()).toBe(0);
  });

  it('impide doble importación incluso con otro nombre o dos confirmaciones concurrentes', async () => {
    const review = await prepareProposal(db, proposal());
    const results = await Promise.allSettled([
      applyProposal(db, review, 'uno.json', false), applyProposal(db, review, 'otro.txt', false),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await db.recipes.count()).toBe(1);
    expect(await db.mealPlans.count()).toBe(1);
    await expect(prepareProposal(db, review.document)).rejects.toThrow('ya se ha importado');
  });

  it('sustituye solo tomas aprobadas y conserva las versiones anteriores del menú', async () => {
    await applyProposal(db, await prepareProposal(db, proposal()), 'original.json', false, when);
    const [original] = await db.mealPlans.toArray();
    await db.mealPlans.add({ ...original, ...newBase(when), mealSlot: 'lunch' });
    const review = await prepareProposal(db, proposal());
    expect(review.conflicts).toHaveLength(1);
    await expect(applyProposal(db, review, 'revision.json', false)).rejects.toThrow('Confirma');
    expect(await db.recipes.count()).toBe(1);
    await applyProposal(db, review, 'revision.json', true);
    expect(await db.mealPlans.get(original.id)).toMatchObject({ deletedAt: expect.any(String), revision: 2 });
    expect(await db.mealPlans.filter((plan) => !plan.deletedAt).count()).toBe(2);
  });

  it('rechaza un menú cambiado desde la vista previa antes de escribir', async () => {
    const document = proposal();
    const review = await prepareProposal(db, document);
    await applyProposal(db, await prepareProposal(db, proposal()), 'paralelo.json', false);
    await expect(applyProposal(db, review, 'anterior.json', true)).rejects.toThrow('ha cambiado');
    expect(await db.recipes.count()).toBe(1);
  });

  it('crea una nueva versión de receta y mantiene el menú anterior congelado', async () => {
    const original = proposal();
    await applyProposal(db, await prepareProposal(db, original), 'original.json', false);
    const [recipe] = await db.recipes.toArray();
    const [oldPlan] = await db.mealPlans.toArray();
    const update = proposal();
    update.payload.recipes![0].existingRecipeId = recipe.id;
    update.payload.recipes![0].ingredients[0].quantity = 200;
    await applyProposal(db, await prepareProposal(db, update), 'revision.json', true);
    const recipes = await db.recipes.toArray();
    expect(recipes).toEqual(expect.arrayContaining([expect.objectContaining({ parentRecipeId: recipe.id, version: 2 })]));
    expect((await db.mealPlans.get(oldPlan.id))?.items[0].snapshot?.nutrients.energyKcal).toBe(300);
  });

  it('rechaza fechas repetidas o fuera del intervalo, recetas duplicadas y secciones vacías', async () => {
    const outside = proposal();
    outside.payload.mealPlan!.days[0].date = '2027-01-01';
    await expect(prepareProposal(db, outside)).rejects.toThrow('fuera');
    const duplicate = proposal();
    duplicate.payload.recipes!.push(duplicate.payload.recipes![0]);
    await expect(prepareProposal(db, duplicate)).rejects.toThrow('repetidos');
    const repeated = proposal();
    repeated.payload.mealPlan!.days.push(structuredClone(repeated.payload.mealPlan!.days[0]));
    await expect(prepareProposal(db, repeated)).rejects.toThrow('fecha');
    const empty = proposal();
    empty.payload = { basedOnContextId: null, proposalKind: 'recipes', recipes: [] };
    await expect(prepareProposal(db, empty)).rejects.toThrow('no contiene');
  });
});

describe('Cantidades y menú histórico', () => {
  it('escala por peso cocinado, agrega ingredientes y conserva instantáneas tras editar alimentos', async () => {
    const recipe = await saveRecipe(db, {
      name: 'Receta de prueba', servings: 2, prepTimeMin: null, totalCookedWeightG: 200, instructions: [],
    }, [{ foodId: food.id, quantity: 100, unit: 'g', state: 'raw', isOptional: false }]);
    const item = await snapshotPlanItem(db, { itemType: 'recipe', refId: recipe.id, quantity: 100, unit: 'g' });
    const direct = await snapshotPlanItem(db, { itemType: 'food', refId: food.id, quantity: 50, unit: 'g' });
    const plan = {
      ...newBase(), date: '2026-01-12', mealSlot: 'dinner', dayType: 'rest',
      items: [item, direct], sourceJsonId: null, notes: null,
    } as const;
    expect(item.snapshot?.nutrients.energyKcal).toBe(100);
    expect(shoppingList([{ ...plan, items: [item, direct] }]).items[0].quantity).toBe(100);
    await saveFood(db, { ...food, nutrientsPer100: mapNutrients(() => null) }, food);
    expect(item.snapshot?.nutrients.energyKcal).toBe(100);
  });

  it('mantiene compatibilidad con las recetas previas y señala equivalencias desconocidas', async () => {
    const review = await prepareProposal(db, proposal());
    await applyProposal(db, review, 'plan.json', false);
    const [ingredient] = await db.recipeIngredients.toArray();
    const snapshot = { ...ingredient.snapshot! };
    delete snapshot.baseQuantity;
    delete snapshot.baseUnit;
    await db.recipeIngredients.update(ingredient.id, { snapshot });
    const [recipe] = await db.recipes.toArray();
    const compatible = await snapshotPlanItem(db, { itemType: 'recipe', refId: recipe.id, quantity: 2, unit: 'portion' });
    expect(compatible.snapshot?.ingredients[0]).toMatchObject({ quantity: 100, unit: 'g' });
    await db.recipeIngredients.update(ingredient.id, { unit: 'unit', equivalenceId: undefined });
    const unknown = await snapshotPlanItem(db, { itemType: 'recipe', refId: recipe.id, quantity: 2, unit: 'portion' });
    expect(unknown.snapshot?.ingredients[0].quantity).toBeNull();
    expect(aiProposalSchema.safeParse(review.document).success).toBe(true);
  });
});
