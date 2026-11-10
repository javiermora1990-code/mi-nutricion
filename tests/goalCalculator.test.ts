import { describe, expect, it } from 'vitest';
import {
  activityFactor,
  calculateGoalProposal,
  mifflinStJeorKcal,
  referenceWeightKg,
  type GoalInput,
} from '../src/lib/goalCalculator';

/** Persona de ejemplo (datos ficticios): hombre, 30 años, 180 cm, 70 kg. */
const base: Omit<GoalInput, 'objective' | 'targetRateKgPerWeek'> = {
  sex: 'male',
  ageYears: 30,
  heightCm: 180,
  weightKg: 70,
  activity: { workType: 'seated', dailyStepsBand: '5000-7500', trainingDaysPerWeek: 3 },
};
const warningCodes = (p: ReturnType<typeof calculateGoalProposal>) => p.warnings.map((w) => w.code);

describe('Mifflin–St Jeor', () => {
  it('calcula el metabolismo basal de un hombre', () => {
    expect(mifflinStJeorKcal({ sex: 'male', weightKg: 70, heightCm: 180, ageYears: 30 })).toBe(1680);
  });

  it('calcula el metabolismo basal de una mujer (constante −161)', () => {
    expect(mifflinStJeorKcal({ sex: 'female', weightKg: 70, heightCm: 180, ageYears: 30 })).toBe(1514);
  });
});

describe('factor de actividad', () => {
  it('es 1,2 para una persona sedentaria que no entrena', () => {
    expect(activityFactor({ workType: 'seated', dailyStepsBand: '<5000', trainingDaysPerWeek: 0 })).toBe(1.2);
  });

  it('suma trabajo, pasos y días de entrenamiento', () => {
    expect(activityFactor({ workType: 'seated', dailyStepsBand: '7500-10000', trainingDaysPerWeek: 4 })).toBe(1.45);
    expect(activityFactor({ workType: 'standing', dailyStepsBand: '5000-7500', trainingDaysPerWeek: 2 })).toBe(1.43);
  });

  it('se mantiene prudente: nunca supera 1,9 ni baja de 1,2', () => {
    const max = activityFactor({ workType: 'physical', dailyStepsBand: '>10000', trainingDaysPerWeek: 7 });
    expect(max).toBe(1.86);
    expect(activityFactor({ workType: 'physical', dailyStepsBand: '>10000', trainingDaysPerWeek: 99 })).toBe(max);
    expect(activityFactor({ workType: 'seated', dailyStepsBand: '<5000', trainingDaysPerWeek: -3 })).toBe(1.2);
  });
});

describe('peso de referencia', () => {
  it('usa el peso actual si el IMC no supera 30', () => {
    expect(referenceWeightKg(70, 180)).toEqual({ kg: 70, adjusted: false });
  });

  it('usa un peso ajustado si el IMC supera 30', () => {
    expect(referenceWeightKg(100, 170)).toEqual({ kg: 79.2, adjusted: true });
  });

  it('respeta la elección manual de no ajustar', () => {
    expect(referenceWeightKg(100, 170, false)).toEqual({ kg: 100, adjusted: false });
  });
});

describe('propuesta de metas — tabla v1.12', () => {
  it('mantenimiento: 1,5 g/kg de proteínas, 1,0 g/kg de grasas y tolerancia simétrica ±150 kcal', () => {
    const p = calculateGoalProposal({ ...base, objective: 'maintain', targetRateKgPerWeek: null });
    expect(p.estimatedBmrKcal).toBe(1680);
    expect(p.activityFactor).toBe(1.36);
    expect(p.estimatedTdeeKcal).toBe(2285);
    expect(p.targets.energyKcal).toEqual({ central: 2280, minTolerance: 2130, maxTolerance: 2430 });
    expect(p.targets.proteinG).toEqual({ central: 105, minTolerance: 98, maxTolerance: 126 });
    expect(p.targets.fatG).toEqual({ central: 70, minTolerance: 56, maxTolerance: 84 });
    expect(p.targets.fiberG).toEqual({ central: 30, minTolerance: 25, maxTolerance: 40 });
    // Energía restante / 4: (2280 − 4·105 − 9·70) / 4 = 307,5
    expect(p.targets.carbsG).toEqual({ central: 308, minTolerance: 270, maxTolerance: 345 });
    expect(p.warnings).toEqual([]);
    expect(p.edited).toBe(false);
    expect(p.targetRateKgPerWeek).toBeNull();
  });

  it('pérdida de grasa: 1,8 g/kg de proteínas, 0,85 g/kg de grasas y tolerancia asimétrica −150/+100', () => {
    const p = calculateGoalProposal({ ...base, objective: 'fat_loss', targetRateKgPerWeek: 0.5 });
    // 0,5 kg/semana × 7.700 / 7 = 550 kcal/día de déficit
    expect(p.targets.energyKcal).toEqual({ central: 1730, minTolerance: 1580, maxTolerance: 1830 });
    expect(p.dailyEnergyDeltaKcal).toBe(-555);
    expect(p.targets.proteinG).toEqual({ central: 126, minTolerance: 112, maxTolerance: 154 });
    expect(p.targets.fatG).toEqual({ central: 60, minTolerance: 49, maxTolerance: 70 });
    expect(p.targets.carbsG.central).toBe(172);
    expect(p.warnings).toEqual([]);
  });

  it('ganancia muscular: mismos macros que mantenimiento y tolerancia asimétrica −100/+150', () => {
    const p = calculateGoalProposal({ ...base, objective: 'muscle_gain', targetRateKgPerWeek: 0.25 });
    // 0,25 kg/semana × 7.700 / 7 = 275 kcal/día de superávit
    expect(p.targets.energyKcal).toEqual({ central: 2560, minTolerance: 2460, maxTolerance: 2710 });
    expect(p.targets.proteinG).toEqual({ central: 105, minTolerance: 98, maxTolerance: 126 });
    // El mínimo de la tabla (0,8 g/kg = 56 g) sube al suelo del 20 % de la energía: 2.560 × 0,2 / 9 = 56,9 → 57 g.
    expect(p.targets.fatG).toEqual({ central: 70, minTolerance: 57, maxTolerance: 84 });
  });

  it('en mantenimiento se ignora cualquier ritmo', () => {
    const p = calculateGoalProposal({ ...base, objective: 'maintain', targetRateKgPerWeek: 0.5 });
    expect(p.targetRateKgPerWeek).toBeNull();
    expect(p.targets.energyKcal.central).toBe(2280);
  });

  it('la energía cuadra con los macros: 4·P + 9·G + 4·C ≈ kcal', () => {
    for (const objective of ['maintain', 'fat_loss', 'muscle_gain'] as const) {
      const p = calculateGoalProposal({ ...base, objective, targetRateKgPerWeek: objective === 'maintain' ? null : 0.25 });
      const t = p.targets;
      const kcal = 4 * t.proteinG.central + 9 * t.fatG.central + 4 * t.carbsG.central;
      expect(Math.abs(kcal - t.energyKcal.central)).toBeLessThanOrEqual(2);
    }
  });

  it('usa el peso ajustado para los gramos por kg si el IMC supera 30', () => {
    const p = calculateGoalProposal({ ...base, weightKg: 100, heightCm: 170, objective: 'maintain', targetRateKgPerWeek: null });
    expect(p.referenceWeightAdjusted).toBe(true);
    expect(p.referenceWeightKg).toBe(79.2);
    expect(p.targets.proteinG.central).toBe(119); // 1,5 × 79,2
    // El metabolismo basal sí usa el peso real.
    expect(p.estimatedBmrKcal).toBe(Math.round(10 * 100 + 6.25 * 170 - 5 * 30 + 5));
  });
});

describe('avisos y suelos de seguridad', () => {
  it('avisa si los carbohidratos quedan por debajo de 2,0 g/kg, si la energía baja del basal y si el déficit supera el 25 %', () => {
    const p = calculateGoalProposal({ ...base, objective: 'fat_loss', targetRateKgPerWeek: 0.75 });
    expect(p.targets.energyKcal.central).toBe(1460);
    expect(p.targets.carbsG.central).toBe(104);
    expect(warningCodes(p)).toEqual(
      expect.arrayContaining(['carbs_below_2g_per_kg', 'energy_below_bmr', 'deficit_over_25_percent']),
    );
  });

  it('no avisa de carbohidratos bajos en ganancia muscular', () => {
    const p = calculateGoalProposal({
      ...base,
      objective: 'muscle_gain',
      targetRateKgPerWeek: 0.25,
      overrides: { energyKcal: 1500 },
    });
    expect(p.targets.carbsG.central).toBeLessThan(140);
    expect(warningCodes(p)).not.toContain('carbs_below_2g_per_kg');
  });

  it('sube las grasas al suelo del 20 % de la energía cuando 1,0 g/kg se queda corto', () => {
    const p = calculateGoalProposal({
      ...base,
      objective: 'maintain',
      targetRateKgPerWeek: null,
      overrides: { energyKcal: 4000 },
    });
    // 20 % de 4.000 kcal = 800 kcal = 88,9 g → 89 g
    expect(p.targets.fatG.central).toBe(89);
    expect(p.targets.fatG.minTolerance).toBeGreaterThanOrEqual(89);
    expect(warningCodes(p)).toContain('fat_raised_to_floor');
  });

  it('avisa si la persona fija las grasas por debajo del suelo de 0,6 g/kg', () => {
    const p = calculateGoalProposal({ ...base, objective: 'maintain', targetRateKgPerWeek: null, overrides: { fatG: 30 } });
    expect(p.targets.fatG.central).toBe(30);
    expect(warningCodes(p)).toContain('fat_below_floor');
  });

  it('avisa si la energía no alcanza para proteínas y grasas, sin inventar carbohidratos negativos', () => {
    const p = calculateGoalProposal({
      ...base,
      objective: 'maintain',
      targetRateKgPerWeek: null,
      overrides: { energyKcal: 800 },
    });
    expect(p.targets.carbsG.central).toBe(0);
    expect(warningCodes(p)).toContain('carbs_negative');
  });
});

describe('ediciones de la persona', () => {
  it('desplaza el intervalo con la cifra editada y recalcula los carbohidratos', () => {
    const p = calculateGoalProposal({
      ...base,
      objective: 'maintain',
      targetRateKgPerWeek: null,
      overrides: { proteinG: 130 },
    });
    expect(p.edited).toBe(true);
    expect(p.targets.proteinG).toEqual({ central: 130, minTolerance: 123, maxTolerance: 151 });
    expect(p.targets.carbsG.central).toBe(Math.round((2280 - 4 * 130 - 9 * 70) / 4));
  });

  it('un factor de actividad manual cambia el gasto y la energía', () => {
    const p = calculateGoalProposal({
      ...base,
      objective: 'maintain',
      targetRateKgPerWeek: null,
      overrides: { activityFactor: 1.5 },
    });
    expect(p.activityFactor).toBe(1.5);
    expect(p.estimatedTdeeKcal).toBe(2520);
    expect(p.targets.energyKcal.central).toBe(2520);
    expect(p.edited).toBe(true);
  });

  it('no marca como editada una propuesta cuyos valores coinciden con los calculados', () => {
    const p = calculateGoalProposal({
      ...base,
      objective: 'maintain',
      targetRateKgPerWeek: null,
      overrides: { energyKcal: 2280, proteinG: 105 },
    });
    expect(p.edited).toBe(false);
  });
});
