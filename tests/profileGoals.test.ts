import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MiNutricionDB } from '../src/db/db';
import { calculateGoalProposal } from '../src/lib/goalCalculator';
import {
  approveGoal,
  discardProposal,
  getActiveGoal,
  getCurrentProfile,
  getCurrentWeight,
  getGoalHistory,
  getPendingProposal,
  goalInputFromProfile,
  profileAge,
  saveGoalProposal,
  saveProfileVersion,
  type ProfileInput,
} from '../src/lib/profileGoals';
import { saveProgressLog, EMPTY_PROGRESS } from '../src/lib/progress';

/** Datos ficticios de ejemplo. */
const profileInput: ProfileInput = {
  sex: 'male',
  birthDate: null,
  ageYears: 30,
  heightCm: 180,
  declaredWeightKg: 70,
  isNatural: true,
  workType: 'seated',
  dailyStepsBand: '5000-7500',
  trainingDaysPerWeek: 3,
  trainingType: 'weights',
};

let db: MiNutricionDB;
let n = 0;

beforeEach(async () => {
  db = createDb(`test-goals-${++n}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

async function proposal(objective: 'maintain' | 'fat_loss' = 'maintain') {
  const profile = await saveProfileVersion(db, profileInput, '2026-01-10');
  const input = goalInputFromProfile(profile, 70, '2026-01-10')!;
  return calculateGoalProposal({ ...input, objective, targetRateKgPerWeek: objective === 'maintain' ? null : 0.5 });
}

describe('perfil versionado', () => {
  it('no hay perfil ni peso actual antes de completar el cuestionario', async () => {
    expect(await getCurrentProfile(db)).toBeNull();
    expect(await getCurrentWeight(db)).toBeNull();
  });

  it('cada guardado crea una versión nueva y conserva las anteriores', async () => {
    const v1 = await saveProfileVersion(db, profileInput, '2026-01-10');
    const v2 = await saveProfileVersion(db, { ...profileInput, trainingDaysPerWeek: 4 }, '2026-02-01');
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);
    expect(await db.profiles.count()).toBe(2);
    expect((await db.profiles.get(v1.id))?.trainingDaysPerWeek).toBe(3);
    expect((await getCurrentProfile(db))?.id).toBe(v2.id);
    expect(v2.effectiveFrom).toBe('2026-02-01');
    // El peso no cambió: se conserva la fecha en que se declaró.
    expect(v2.weightDeclaredOn).toBe('2026-01-10');
  });

  it('rechaza valores fuera de rango y perfiles sin edad ni fecha de nacimiento', async () => {
    await expect(saveProfileVersion(db, { ...profileInput, heightCm: 20 })).rejects.toThrow();
    await expect(saveProfileVersion(db, { ...profileInput, ageYears: null })).rejects.toThrow();
    expect(await db.profiles.count()).toBe(0);
  });

  it('calcula la edad a partir de la fecha de nacimiento', () => {
    expect(profileAge({ birthDate: '1990-06-15', ageYears: null }, '2026-06-14')).toBe(35);
    expect(profileAge({ birthDate: '1990-06-15', ageYears: null }, '2026-06-15')).toBe(36);
    expect(profileAge({ birthDate: null, ageYears: 40 })).toBe(40);
  });

  it('el peso actual sale del último registro de progreso y, si no hay, del perfil', async () => {
    await saveProfileVersion(db, profileInput, '2026-01-10');
    expect(await getCurrentWeight(db)).toEqual({ weightKg: 70, date: '2026-01-10', source: 'profile' });

    await saveProgressLog(db, '2026-01-12', { ...EMPTY_PROGRESS, weightKg: 69.4 });
    // Un registro posterior SIN peso no borra el último peso conocido.
    await saveProgressLog(db, '2026-01-13', { ...EMPTY_PROGRESS, sleepHours: 7 });
    expect(await getCurrentWeight(db)).toEqual({ weightKg: 69.4, date: '2026-01-12', source: 'progress' });
  });
});

describe('metas: ninguna se activa sin aprobación', () => {
  it('guardar una propuesta no crea ninguna meta activa', async () => {
    const goal = await saveGoalProposal(db, await proposal());
    expect(goal.status).toBe('proposed');
    expect(goal.approvedAt).toBeNull();
    expect(goal.effectiveFrom).toBeNull();
    expect(goal.origin).toBe('app');
    expect(await getActiveGoal(db)).toBeNull();
    expect((await getPendingProposal(db))?.id).toBe(goal.id);
  });

  it('aprobar activa la propuesta con fecha de aprobación y vigencia', async () => {
    const goal = await saveGoalProposal(db, await proposal());
    const approved = await approveGoal(db, goal.id, '2026-01-11');
    expect(approved.status).toBe('active');
    expect(approved.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(approved.effectiveFrom).toBe('2026-01-11');
    expect(approved.revision).toBe(goal.revision + 1);
    expect((await getActiveGoal(db))?.id).toBe(goal.id);
    expect(await getPendingProposal(db)).toBeNull();
  });

  it('aprobar una meta nueva archiva la anterior con fecha de fin y sin tocar sus cifras', async () => {
    const first = await approveGoal(db, (await saveGoalProposal(db, await proposal())).id, '2026-01-11');
    const second = await saveGoalProposal(db, await proposal('fat_loss'));
    // Mientras la segunda es solo una propuesta, la activa sigue siendo la primera.
    expect((await getActiveGoal(db))?.id).toBe(first.id);

    await approveGoal(db, second.id, '2026-03-01');
    const old = await db.nutritionGoals.get(first.id);
    expect(old?.status).toBe('archived');
    expect(old?.effectiveTo).toBe('2026-03-01');
    expect(old?.approvedAt).toBe(first.approvedAt);
    expect(old?.targets).toEqual(first.targets);
    expect((await getActiveGoal(db))?.id).toBe(second.id);
    expect(await db.nutritionGoals.where('status').equals('active').count()).toBe(1);
  });

  it('no se puede aprobar dos veces ni aprobar una meta archivada o inexistente', async () => {
    const goal = await saveGoalProposal(db, await proposal());
    await approveGoal(db, goal.id);
    await expect(approveGoal(db, goal.id)).rejects.toThrow();
    await expect(approveGoal(db, crypto.randomUUID())).rejects.toThrow();

    const discarded = await saveGoalProposal(db, await proposal('fat_loss'));
    await discardProposal(db, discarded.id);
    await expect(approveGoal(db, discarded.id)).rejects.toThrow();
    expect((await getActiveGoal(db))?.id).toBe(goal.id);
  });

  it('una propuesta nueva sustituye a la pendiente, que queda archivada sin aprobar', async () => {
    const a = await saveGoalProposal(db, await proposal());
    const b = await saveGoalProposal(db, await proposal('fat_loss'));
    expect(b.version).toBe(a.version + 1);
    const archived = await db.nutritionGoals.get(a.id);
    expect(archived?.status).toBe('archived');
    expect(archived?.approvedAt).toBeNull();
    expect((await getPendingProposal(db))?.id).toBe(b.id);
    expect((await getGoalHistory(db)).map((g) => g.version)).toEqual([2, 1]);
  });

  it('descartar una propuesta no afecta a la meta activa', async () => {
    const active = await approveGoal(db, (await saveGoalProposal(db, await proposal())).id);
    const pending = await saveGoalProposal(db, await proposal('fat_loss'));
    await discardProposal(db, pending.id);
    expect(await getPendingProposal(db)).toBeNull();
    expect((await getActiveGoal(db))?.id).toBe(active.id);
    await expect(discardProposal(db, active.id)).rejects.toThrow();
  });

  it('registra el origen manual y los avisos cuando la persona edita la propuesta', async () => {
    const profile = await saveProfileVersion(db, profileInput, '2026-01-10');
    const input = goalInputFromProfile(profile, 70, '2026-01-10')!;
    const edited = calculateGoalProposal({
      ...input,
      objective: 'maintain',
      targetRateKgPerWeek: null,
      overrides: { fatG: 30 },
    });
    const goal = await saveGoalProposal(db, edited);
    expect(goal.origin).toBe('manual');
    expect(goal.targets.default.fatG.central).toBe(30);
    expect(goal.assumptions.some((a) => a.startsWith('Aviso:'))).toBe(true);
  });
});
