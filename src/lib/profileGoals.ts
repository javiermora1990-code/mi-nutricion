/**
 * Perfil versionado y ciclo de vida de las metas (secciones 5 y 5.1).
 * Regla: ninguna meta pasa a `active` sin una llamada explícita a `approveGoal`.
 */
import { z } from 'zod';
import { newBase, nowIso, type MiNutricionDB } from '../db/db';
import type { IsoDate, NutritionGoal, Profile } from '../db/types';
import { ageOn, localIsoDate } from './dates';
import { STEPS_BANDS, TRAINING_TYPES, type GoalInput, type GoalProposal, type StepsBand } from './goalCalculator';

export const profileInputSchema = z
  .object({
    sex: z.enum(['male', 'female']),
    birthDate: z.iso.date().nullable(),
    ageYears: z.number().int().min(14).max(110).nullable(),
    heightCm: z.number().min(100).max(250),
    declaredWeightKg: z.number().min(30).max(300),
    isNatural: z.boolean(),
    workType: z.enum(['seated', 'standing', 'physical']),
    dailyStepsBand: z.enum(STEPS_BANDS),
    trainingDaysPerWeek: z.number().int().min(0).max(7),
    trainingType: z.enum(TRAINING_TYPES),
    mealRoutine: z.string().trim().max(500).nullable().optional(),
  })
  .refine((p) => p.birthDate !== null || p.ageYears !== null, {
    message: 'Indica la edad o la fecha de nacimiento.',
    path: ['ageYears'],
  })
  .refine(
    (p) => {
      if (p.birthDate === null) return true;
      const age = ageOn(p.birthDate, localIsoDate());
      return age >= 14 && age <= 110;
    },
    { message: 'La fecha de nacimiento no es válida.', path: ['birthDate'] },
  );

export type ProfileInput = z.infer<typeof profileInputSchema>;

/** Perfil vigente: la versión más alta no eliminada. */
export async function getCurrentProfile(db: MiNutricionDB): Promise<Profile | null> {
  const all = (await db.profiles.toArray()).filter((p) => p.deletedAt === null);
  return all.sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Guarda una versión NUEVA del perfil; las anteriores no se modifican. */
export async function saveProfileVersion(
  db: MiNutricionDB,
  input: ProfileInput,
  today: IsoDate = localIsoDate(),
): Promise<Profile> {
  const data = profileInputSchema.parse(input);
  return db.transaction('rw', db.profiles, async () => {
    const current = await getCurrentProfile(db);
    const weightChanged = !current || current.declaredWeightKg !== data.declaredWeightKg;
    const profile: Profile = {
      ...newBase(),
      version: (current?.version ?? 0) + 1,
      effectiveFrom: today,
      ...data,
      weightDeclaredOn: weightChanged ? today : (current?.weightDeclaredOn ?? today),
    };
    await db.profiles.add(profile);
    return profile;
  });
}

/** Edad del perfil en una fecha: sale de la fecha de nacimiento si existe. */
export function profileAge(profile: Pick<Profile, 'birthDate' | 'ageYears'>, on: IsoDate = localIsoDate()): number | null {
  if (profile.birthDate) return ageOn(profile.birthDate, on);
  return profile.ageYears;
}

/**
 * Peso actual: el último `progressLogs.weightKg` registrado; si aún no hay
 * ninguno, el peso declarado en el perfil. `null` si no hay ninguno de los dos.
 */
export async function getCurrentWeight(
  db: MiNutricionDB,
): Promise<{ weightKg: number; date: IsoDate; source: 'progress' | 'profile' } | null> {
  const logs = await db.progressLogs.orderBy('date').reverse().toArray();
  const last = logs.find((l) => l.deletedAt === null && l.weightKg !== null);
  if (last && last.weightKg !== null) return { weightKg: last.weightKg, date: last.date, source: 'progress' };
  const profile = await getCurrentProfile(db);
  if (profile) return { weightKg: profile.declaredWeightKg, date: profile.weightDeclaredOn, source: 'profile' };
  return null;
}

/** Datos del perfil listos para la calculadora; null si falta algo imprescindible. */
export function goalInputFromProfile(
  profile: Profile,
  weightKg: number,
  today: IsoDate = localIsoDate(),
): Omit<GoalInput, 'objective' | 'targetRateKgPerWeek'> | null {
  const ageYears = profileAge(profile, today);
  if (ageYears === null) return null;
  return {
    sex: profile.sex,
    ageYears,
    heightCm: profile.heightCm,
    weightKg,
    activity: {
      workType: profile.workType,
      dailyStepsBand: profile.dailyStepsBand as StepsBand,
      trainingDaysPerWeek: profile.trainingDaysPerWeek,
    },
  };
}

const live = (g: NutritionGoal) => g.deletedAt === null;

export async function getActiveGoal(db: MiNutricionDB): Promise<NutritionGoal | null> {
  return (await db.nutritionGoals.where('status').equals('active').toArray()).find(live) ?? null;
}

export async function getPendingProposal(db: MiNutricionDB): Promise<NutritionGoal | null> {
  const proposed = (await db.nutritionGoals.where('status').equals('proposed').toArray()).filter(live);
  return proposed.sort((a, b) => b.version - a.version)[0] ?? null;
}

/**
 * Guarda una propuesta (`proposed`). NO la activa. Si había otra propuesta
 * pendiente, queda archivada sin haber sido aprobada.
 */
export async function saveGoalProposal(
  db: MiNutricionDB,
  proposal: GoalProposal,
  origin: NutritionGoal['origin'] = proposal.edited ? 'manual' : 'app',
): Promise<NutritionGoal> {
  return db.transaction('rw', db.nutritionGoals, async () => {
    const all = await db.nutritionGoals.toArray();
    const now = nowIso();
    for (const g of all) {
      if (g.status === 'proposed' && live(g)) {
        await db.nutritionGoals.update(g.id, { status: 'archived', updatedAt: now, revision: g.revision + 1 });
      }
    }
    const goal: NutritionGoal = {
      ...newBase(now),
      version: all.reduce((max, g) => Math.max(max, g.version), 0) + 1,
      status: 'proposed',
      objective: proposal.objective,
      targetRateKgPerWeek: proposal.targetRateKgPerWeek,
      referenceWeightKg: proposal.referenceWeightKg,
      bmrFormula: 'Mifflin-St Jeor',
      estimatedBmrKcal: proposal.estimatedBmrKcal,
      activityFactor: proposal.activityFactor,
      estimatedTdeeKcal: proposal.estimatedTdeeKcal,
      targets: { default: proposal.targets },
      assumptions: [...proposal.assumptions, ...proposal.warnings.map((w) => `Aviso: ${w.message}`)],
      origin,
      effectiveFrom: null,
      effectiveTo: null,
      approvedAt: null,
    };
    await db.nutritionGoals.add(goal);
    return goal;
  });
}

/**
 * Aprobación explícita: la propuesta pasa a `active` y la meta activa anterior
 * se archiva con su fecha de fin. Solo se puede aprobar una meta `proposed`.
 */
export async function approveGoal(
  db: MiNutricionDB,
  goalId: string,
  today: IsoDate = localIsoDate(),
): Promise<NutritionGoal> {
  return db.transaction('rw', db.nutritionGoals, async () => {
    const goal = await db.nutritionGoals.get(goalId);
    if (!goal || !live(goal)) throw new Error('La propuesta no existe.');
    if (goal.status !== 'proposed') throw new Error('Solo se puede aprobar una meta en estado de propuesta.');
    const now = nowIso();
    const actives = await db.nutritionGoals.where('status').equals('active').toArray();
    for (const a of actives) {
      await db.nutritionGoals.update(a.id, {
        status: 'archived',
        effectiveTo: today,
        updatedAt: now,
        revision: a.revision + 1,
      });
    }
    const approved: NutritionGoal = {
      ...goal,
      status: 'active',
      approvedAt: now,
      effectiveFrom: today,
      updatedAt: now,
      revision: goal.revision + 1,
    };
    await db.nutritionGoals.put(approved);
    return approved;
  });
}

/** Descarta una propuesta pendiente: queda archivada sin aprobar. */
export async function discardProposal(db: MiNutricionDB, goalId: string): Promise<void> {
  await db.transaction('rw', db.nutritionGoals, async () => {
    const goal = await db.nutritionGoals.get(goalId);
    if (!goal || goal.status !== 'proposed') throw new Error('Solo se puede descartar una propuesta pendiente.');
    await db.nutritionGoals.update(goalId, { status: 'archived', updatedAt: nowIso(), revision: goal.revision + 1 });
  });
}

/** Historial de metas, de la más reciente a la más antigua. */
export async function getGoalHistory(db: MiNutricionDB): Promise<NutritionGoal[]> {
  return (await db.nutritionGoals.toArray()).filter(live).sort((a, b) => b.version - a.version);
}
