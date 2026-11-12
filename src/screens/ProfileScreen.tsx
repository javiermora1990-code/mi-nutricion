import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { formatShortDate } from '../lib/dates';
import { type StepsBand, type TrainingType, type WorkType } from '../lib/goalCalculator';
import { getCurrentProfile, profileInputSchema, saveProfileVersion } from '../lib/profileGoals';
import { Card, Choice, Field, Notice, Screen, btnPrimary, inputClass, numberText, parseNumber } from '../ui/kit';

interface FormState {
  sex: 'male' | 'female' | null;
  birthDate: string;
  ageYears: string;
  heightCm: string;
  weightKg: string;
  isNatural: boolean | null;
  workType: WorkType | null;
  dailyStepsBand: StepsBand | null;
  trainingDaysPerWeek: number | null;
  trainingType: TrainingType | null;
  mealRoutine: string;
}

const EMPTY: FormState = {
  sex: null,
  birthDate: '',
  ageYears: '',
  heightCm: '',
  weightKg: '',
  isNatural: null,
  workType: null,
  dailyStepsBand: null,
  trainingDaysPerWeek: null,
  trainingType: null,
  mealRoutine: '',
};

const REQUIRED = 'Falta este dato.';

export function ProfileScreen({ onSaved }: { onSaved: () => void }) {
  const current = useLiveQuery(() => getCurrentProfile(db).then((p) => p ?? null), []);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!current || loadedVersion === current.version) return;
    setLoadedVersion(current.version);
    setForm({
      sex: current.sex,
      birthDate: current.birthDate ?? '',
      ageYears: numberText(current.ageYears),
      heightCm: numberText(current.heightCm),
      weightKg: numberText(current.declaredWeightKg),
      isNatural: current.isNatural,
      workType: current.workType,
      dailyStepsBand: current.dailyStepsBand as StepsBand,
      trainingDaysPerWeek: current.trainingDaysPerWeek,
      trainingType: current.trainingType as TrainingType,
      mealRoutine: current.mealRoutine ?? '',
    });
  }, [current, loadedVersion]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit() {
    const e: Record<string, string> = {};
    for (const key of ['sex', 'isNatural', 'workType', 'dailyStepsBand', 'trainingDaysPerWeek'] as const) {
      if (form[key] === null) e[key] = REQUIRED;
    }
    const days = form.trainingDaysPerWeek;
    const trainingType = days === 0 ? 'none' : form.trainingType;
    if (days !== null && days > 0 && (trainingType === null || trainingType === 'none')) e.trainingType = REQUIRED;
    const heightCm = parseNumber(form.heightCm);
    const weightKg = parseNumber(form.weightKg);
    if (heightCm === null) e.heightCm = REQUIRED;
    if (weightKg === null) e.weightKg = REQUIRED;
    if (Object.keys(e).length) return setErrors(e);

    const parsed = profileInputSchema.safeParse({
      sex: form.sex,
      birthDate: form.birthDate || null,
      ageYears: form.birthDate ? null : parseNumber(form.ageYears),
      heightCm,
      declaredWeightKg: weightKg,
      isNatural: form.isNatural,
      workType: form.workType,
      dailyStepsBand: form.dailyStepsBand,
      trainingDaysPerWeek: days,
      trainingType,
      mealRoutine: form.mealRoutine.trim() || null,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        e[key === 'declaredWeightKg' ? 'weightKg' : key] = MESSAGES[key] ?? 'Valor no válido.';
      }
      return setErrors(e);
    }
    setErrors({});
    await saveProfileVersion(db, parsed.data);
    onSaved();
  }

  return (
    <Screen title="Perfil y actividad" subtitle="Con estos datos se calcula tu propuesta de metas.">
      {current && (
        <Notice tone="info">
          Versión {current.version} del perfil, vigente desde el {formatShortDate(current.effectiveFrom)}. Al guardar se
          crea una versión nueva; las anteriores se conservan.
        </Notice>
      )}

      <Card title="Datos básicos">
        <Choice
          label="Sexo"
          value={form.sex}
          onChange={(v) => set('sex', v)}
          options={[
            { value: 'male', label: 'Hombre' },
            { value: 'female', label: 'Mujer' },
          ]}
          error={errors.sex}
        />
        <Field label="Fecha de nacimiento (opcional)" hint="Si la indicas, la edad se actualiza sola." error={errors.birthDate}>
          <input type="date" className={inputClass} value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
        </Field>
        {!form.birthDate && (
          <Field label="Edad (años)" error={errors.ageYears}>
            <input
              inputMode="numeric"
              className={inputClass}
              value={form.ageYears}
              onChange={(e) => set('ageYears', e.target.value)}
            />
          </Field>
        )}
        <Field label="Estatura (cm)" error={errors.heightCm}>
          <input inputMode="decimal" className={inputClass} value={form.heightCm} onChange={(e) => set('heightCm', e.target.value)} />
        </Field>
        <Field
          label="Peso (kg)"
          hint="Peso de partida. Después, el peso actual sale de tus registros en Progreso."
          error={errors.weightKg}
        >
          <input inputMode="decimal" className={inputClass} value={form.weightKg} onChange={(e) => set('weightKg', e.target.value)} />
        </Field>
        <Choice
          label="¿Entrenas de forma natural?"
          value={form.isNatural}
          onChange={(v) => set('isNatural', v)}
          options={[
            { value: true, label: 'Sí' },
            { value: false, label: 'No' },
          ]}
          error={errors.isNatural}
        />
      </Card>

      <Card title="Actividad">
        <Choice
          label="Tipo de trabajo"
          value={form.workType}
          onChange={(v) => set('workType', v)}
          options={[
            { value: 'seated', label: 'Sentado' },
            { value: 'standing', label: 'De pie' },
            { value: 'physical', label: 'Físico' },
          ]}
          error={errors.workType}
        />
        <Choice
          label="Pasos diarios aproximados"
          value={form.dailyStepsBand}
          onChange={(v) => set('dailyStepsBand', v)}
          options={[
            { value: '<5000', label: 'Menos de 5.000' },
            { value: '5000-7500', label: '5.000–7.500' },
            { value: '7500-10000', label: '7.500–10.000' },
            { value: '>10000', label: 'Más de 10.000' },
          ]}
          error={errors.dailyStepsBand}
        />
        <Choice
          label="Días de entrenamiento por semana"
          value={form.trainingDaysPerWeek}
          onChange={(v) => set('trainingDaysPerWeek', v)}
          options={[0, 1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: String(d) }))}
          error={errors.trainingDaysPerWeek}
        />
        {form.trainingDaysPerWeek !== null && form.trainingDaysPerWeek > 0 && (
          <Choice
            label="Tipo de entrenamiento"
            value={form.trainingType === 'none' ? null : form.trainingType}
            onChange={(v) => set('trainingType', v)}
            options={[
              { value: 'weights', label: 'Pesas' },
              { value: 'cardio', label: 'Cardio' },
              { value: 'mixed', label: 'Mixto' },
            ]}
            error={errors.trainingType}
          />
        )}
      </Card>

      <Card title="Horarios y rutina (opcional)">
        <Field
          label="Cómo y cuándo sueles comer"
          hint="Se envía a la IA para repartir el menú. Por ejemplo: desayuno a las 7:30, como en la oficina con táper, ceno tarde."
          error={errors.mealRoutine}
        >
          <textarea
            className={`${inputClass} min-h-24 py-2`}
            maxLength={500}
            value={form.mealRoutine}
            onChange={(event) => set('mealRoutine', event.target.value)}
          />
        </Field>
      </Card>

      {Object.keys(errors).length > 0 && <Notice tone="error">Revisa los campos marcados antes de guardar.</Notice>}
      <button className={btnPrimary} onClick={onSubmit}>
        Guardar perfil y calcular metas
      </button>
    </Screen>
  );
}

const MESSAGES: Record<string, string> = {
  ageYears: 'Indica una edad entre 14 y 110 años, o la fecha de nacimiento.',
  heightCm: 'Indica una estatura entre 100 y 250 cm.',
  declaredWeightKg: 'Indica un peso entre 30 y 300 kg.',
  birthDate: 'Fecha no válida.',
};
