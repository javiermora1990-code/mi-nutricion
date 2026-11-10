/**
 * Calculadora de metas (diseño, secciones 5, 5.1 y 5.2 — tabla v1.12).
 * Funciones puras: no leen ni escriben la base de datos. El resultado es una
 * PROPUESTA; nada se activa sin aprobación explícita de la persona.
 *
 * Convención de intervalos: en `TargetRange`, `minTolerance` y `maxTolerance`
 * son los límites inferior y superior ABSOLUTOS del intervalo aceptable, en la
 * misma unidad que `central` (kcal o gramos).
 */
import type { DayTargets, Objective, TargetRange } from '../db/types';

export type Sex = 'male' | 'female';
export type WorkType = 'seated' | 'standing' | 'physical';

export const STEPS_BANDS = ['<5000', '5000-7500', '7500-10000', '>10000'] as const;
export type StepsBand = (typeof STEPS_BANDS)[number];

export const TRAINING_TYPES = ['none', 'weights', 'cardio', 'mixed'] as const;
export type TrainingType = (typeof TRAINING_TYPES)[number];

/** Ritmos ofrecidos (kg/semana). En mantenimiento no hay ritmo: null. */
export const RATE_OPTIONS: Record<Objective, number[]> = {
  maintain: [],
  fat_loss: [0.25, 0.5, 0.75],
  muscle_gain: [0.125, 0.25],
};

/** Equivalencia energética aproximada de 1 kg de peso corporal. */
export const KCAL_PER_KG = 7700;

/** Mifflin–St Jeor (kcal/día). Estimación, no medición. */
export function mifflinStJeorKcal(p: { sex: Sex; weightKg: number; heightCm: number; ageYears: number }): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.ageYears + (p.sex === 'male' ? 5 : -161);
}

export interface ActivityInput {
  workType: WorkType;
  dailyStepsBand: StepsBand;
  trainingDaysPerWeek: number;
}

const WORK_BONUS: Record<WorkType, number> = { seated: 0, standing: 0.1, physical: 0.25 };
const STEPS_BONUS: Record<StepsBand, number> = { '<5000': 0, '5000-7500': 0.05, '7500-10000': 0.1, '>10000': 0.15 };
const TRAINING_BONUS_PER_DAY = 0.0375;
export const ACTIVITY_FACTOR_MIN = 1.2;
export const ACTIVITY_FACTOR_MAX = 1.9;

/**
 * Factor de actividad prudente: 1,2 (sedentario) + trabajo + pasos + entrenamiento,
 * limitado a [1,2 – 1,9]. Es editable por la persona antes de aprobar.
 */
export function activityFactor(a: ActivityInput): number {
  const days = Math.min(7, Math.max(0, a.trainingDaysPerWeek));
  const raw = ACTIVITY_FACTOR_MIN + WORK_BONUS[a.workType] + STEPS_BONUS[a.dailyStepsBand] + TRAINING_BONUS_PER_DAY * days;
  return round(Math.min(ACTIVITY_FACTOR_MAX, Math.max(ACTIVITY_FACTOR_MIN, raw)), 2);
}

export const bmi = (weightKg: number, heightCm: number) => weightKg / (heightCm / 100) ** 2;

/**
 * Peso de referencia para los gramos por kg: el peso actual, o un peso ajustado
 * si el IMC supera 30 (peso a IMC 25 + 25 % del exceso), para no sobredimensionar.
 */
export function referenceWeightKg(weightKg: number, heightCm: number, useAdjusted?: boolean): { kg: number; adjusted: boolean } {
  const adjust = useAdjusted ?? bmi(weightKg, heightCm) > 30;
  if (!adjust) return { kg: weightKg, adjusted: false };
  const ideal = 25 * (heightCm / 100) ** 2;
  if (weightKg <= ideal) return { kg: weightKg, adjusted: false };
  return { kg: round(ideal + 0.25 * (weightKg - ideal), 1), adjusted: true };
}

interface PerKg {
  central: number;
  min: number;
  max: number;
}

/** Tabla v1.12 (sección 5.2). */
export const MACRO_TABLE: Record<Objective, { proteinGPerKg: PerKg; fatGPerKg: PerKg; kcalTolerance: { minDelta: number; maxDelta: number } }> = {
  maintain: {
    proteinGPerKg: { central: 1.5, min: 1.4, max: 1.8 },
    fatGPerKg: { central: 1.0, min: 0.8, max: 1.2 },
    kcalTolerance: { minDelta: -150, maxDelta: 150 },
  },
  fat_loss: {
    proteinGPerKg: { central: 1.8, min: 1.6, max: 2.2 },
    fatGPerKg: { central: 0.85, min: 0.7, max: 1.0 },
    kcalTolerance: { minDelta: -150, maxDelta: 100 },
  },
  muscle_gain: {
    proteinGPerKg: { central: 1.5, min: 1.4, max: 1.8 },
    fatGPerKg: { central: 1.0, min: 0.8, max: 1.2 },
    kcalTolerance: { minDelta: -100, maxDelta: 150 },
  },
};

export const FAT_FLOOR_G_PER_KG = 0.6;
export const FAT_FLOOR_ENERGY_FRACTION = 0.2;
export const FIBER_TARGET: TargetRange = { central: 30, minTolerance: 25, maxTolerance: 40 };
export const CARBS_WARNING_G_PER_KG = 2.0;

export type WarningCode =
  | 'carbs_below_2g_per_kg'
  | 'carbs_negative'
  | 'fat_raised_to_floor'
  | 'fat_below_floor'
  | 'energy_below_bmr'
  | 'deficit_over_25_percent';

export interface GoalWarning {
  code: WarningCode;
  message: string;
}

export interface GoalInput {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityInput;
  objective: Objective;
  /** kg/semana, siempre positivo; null en mantenimiento. */
  targetRateKgPerWeek: number | null;
  /** Por defecto se ajusta solo si el IMC supera 30. */
  useAdjustedWeight?: boolean;
  /** Ediciones de la persona sobre la propuesta calculada. */
  overrides?: GoalOverrides;
}

export interface GoalOverrides {
  activityFactor?: number;
  energyKcal?: number;
  proteinG?: number;
  fatG?: number;
  fiberG?: number;
}

export interface GoalProposal {
  objective: Objective;
  targetRateKgPerWeek: number | null;
  referenceWeightKg: number;
  referenceWeightAdjusted: boolean;
  estimatedBmrKcal: number;
  activityFactor: number;
  estimatedTdeeKcal: number;
  /** Diferencia diaria respecto al gasto estimado (negativa = déficit). */
  dailyEnergyDeltaKcal: number;
  targets: DayTargets;
  assumptions: string[];
  warnings: GoalWarning[];
  /** true si la persona cambió algún valor calculado. */
  edited: boolean;
}

const num = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

export function calculateGoalProposal(input: GoalInput): GoalProposal {
  const o = input.overrides ?? {};
  const table = MACRO_TABLE[input.objective];
  const assumptions: string[] = [];
  const warnings: GoalWarning[] = [];

  const bmr = mifflinStJeorKcal(input);
  const computedFactor = activityFactor(input.activity);
  const factor = o.activityFactor ?? computedFactor;
  const tdee = bmr * factor;

  const rate = input.objective === 'maintain' ? null : input.targetRateKgPerWeek;
  const magnitude = rate === null ? 0 : (rate * KCAL_PER_KG) / 7;
  const delta = input.objective === 'fat_loss' ? -magnitude : magnitude;
  const computedEnergy = roundTo(tdee + delta, 10);
  const energy = o.energyKcal ?? computedEnergy;

  const ref = referenceWeightKg(input.weightKg, input.heightCm, input.useAdjustedWeight);

  // Proteínas
  const proteinComputed = Math.round(table.proteinGPerKg.central * ref.kg);
  const protein = o.proteinG ?? proteinComputed;
  const proteinRange = shiftedRange(protein, proteinComputed, table.proteinGPerKg.min * ref.kg, table.proteinGPerKg.max * ref.kg);

  // Grasas, con suelo de seguridad (0,6 g/kg o 20 % de la energía, lo que sea mayor)
  const fatFloor = Math.ceil(Math.max(FAT_FLOOR_G_PER_KG * ref.kg, (FAT_FLOOR_ENERGY_FRACTION * energy) / 9));
  let fatComputed = Math.round(table.fatGPerKg.central * ref.kg);
  if (fatComputed < fatFloor) {
    fatComputed = fatFloor;
    warnings.push({
      code: 'fat_raised_to_floor',
      message: `Las grasas se han subido al suelo de seguridad (${fatFloor} g: 0,6 g/kg o 20 % de la energía).`,
    });
  }
  const fat = o.fatG ?? fatComputed;
  if (fat < fatFloor) {
    warnings.push({
      code: 'fat_below_floor',
      message: `Las grasas quedan por debajo del suelo de seguridad (${fatFloor} g).`,
    });
  }
  const fatRange = shiftedRange(fat, fatComputed, Math.max(table.fatGPerKg.min * ref.kg, fatFloor), table.fatGPerKg.max * ref.kg);

  // Fibra
  const fiber = o.fiberG ?? FIBER_TARGET.central;
  const fiberRange = shiftedRange(fiber, FIBER_TARGET.central, FIBER_TARGET.minTolerance, FIBER_TARGET.maxTolerance);

  // Energía
  const energyRange: TargetRange = {
    central: energy,
    minTolerance: energy + table.kcalTolerance.minDelta,
    maxTolerance: energy + table.kcalTolerance.maxDelta,
  };

  // Carbohidratos: energía restante / 4. El intervalo sale de la tolerancia de energía.
  const fixedKcal = 4 * protein + 9 * fat;
  const carbsRaw = (energy - fixedKcal) / 4;
  if (carbsRaw < 0) {
    warnings.push({
      code: 'carbs_negative',
      message: 'La energía no alcanza para las proteínas y grasas indicadas: revisa los valores.',
    });
  }
  const carbs = Math.max(0, Math.round(carbsRaw));
  const carbsRange: TargetRange = {
    central: carbs,
    minTolerance: Math.max(0, Math.round((energyRange.minTolerance - fixedKcal) / 4)),
    maxTolerance: Math.max(0, Math.round((energyRange.maxTolerance - fixedKcal) / 4)),
  };
  const carbsThreshold = CARBS_WARNING_G_PER_KG * ref.kg;
  if (carbsRaw >= 0 && input.objective !== 'muscle_gain' && carbs < carbsThreshold) {
    warnings.push({
      code: 'carbs_below_2g_per_kg',
      message: `Los carbohidratos (${carbs} g) quedan por debajo de 2,0 g/kg (${Math.round(carbsThreshold)} g).`,
    });
  }

  if (energy < bmr) {
    warnings.push({
      code: 'energy_below_bmr',
      message: `La meta de energía queda por debajo del metabolismo basal estimado (${Math.round(bmr)} kcal).`,
    });
  }
  if (tdee - energy > 0.25 * tdee) {
    warnings.push({
      code: 'deficit_over_25_percent',
      message: 'El déficit supera el 25 % del gasto estimado: considera un ritmo más lento.',
    });
  }

  assumptions.push(
    `Metabolismo basal estimado con Mifflin–St Jeor: ${Math.round(bmr)} kcal/día (estimación, no medición).`,
    o.activityFactor === undefined || o.activityFactor === computedFactor
      ? `Factor de actividad ${num.format(factor)}, calculado con prudencia a partir del trabajo, los pasos y los días de entrenamiento.`
      : `Factor de actividad ${num.format(factor)}, fijado a mano (el cálculo proponía ${num.format(computedFactor)}).`,
    `Gasto diario estimado: ${Math.round(tdee)} kcal.`,
    rate === null
      ? 'Objetivo de mantenimiento: energía igual al gasto estimado.'
      : `Ritmo de ${num.format(rate)} kg/semana ≈ ${Math.round(magnitude)} kcal/día de ${input.objective === 'fat_loss' ? 'déficit' : 'superávit'} (7.700 kcal por kg).`,
    ref.adjusted
      ? `Peso de referencia ajustado: ${num.format(ref.kg)} kg (IMC superior a 30).`
      : `Peso de referencia: ${num.format(ref.kg)} kg (peso actual).`,
    `Proteínas ${num.format(table.proteinGPerKg.central)} g/kg y grasas ${num.format(table.fatGPerKg.central)} g/kg (tabla v1.12); carbohidratos por energía restante.`,
  );
  if (o.energyKcal !== undefined && o.energyKcal !== computedEnergy) {
    assumptions.push(`Energía fijada a mano (el cálculo proponía ${computedEnergy} kcal).`);
  }

  const edited =
    (o.activityFactor !== undefined && o.activityFactor !== computedFactor) ||
    (o.energyKcal !== undefined && o.energyKcal !== computedEnergy) ||
    (o.proteinG !== undefined && o.proteinG !== proteinComputed) ||
    (o.fatG !== undefined && o.fatG !== fatComputed) ||
    (o.fiberG !== undefined && o.fiberG !== FIBER_TARGET.central);

  return {
    objective: input.objective,
    targetRateKgPerWeek: rate,
    referenceWeightKg: ref.kg,
    referenceWeightAdjusted: ref.adjusted,
    estimatedBmrKcal: Math.round(bmr),
    activityFactor: factor,
    estimatedTdeeKcal: Math.round(tdee),
    dailyEnergyDeltaKcal: Math.round(energy - tdee),
    targets: { energyKcal: energyRange, proteinG: proteinRange, fatG: fatRange, carbsG: carbsRange, fiberG: fiberRange },
    assumptions,
    warnings,
    edited,
  };
}

/** Intervalo de la tabla; si la persona edita la cifra central, el intervalo se desplaza con ella. */
function shiftedRange(central: number, computedCentral: number, min: number, max: number): TargetRange {
  const shift = central - computedCentral;
  return {
    central,
    minTolerance: Math.max(0, Math.round(min + shift)),
    maxTolerance: Math.round(max + shift),
  };
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
