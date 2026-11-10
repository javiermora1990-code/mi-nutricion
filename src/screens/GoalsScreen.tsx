import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { OBJECTIVE_LABEL, TargetsTable } from '../components/TargetsTable';
import { db } from '../db/db';
import type { NutritionGoal, Objective } from '../db/types';
import { formatShortDate } from '../lib/dates';
import {
  ACTIVITY_FACTOR_MAX,
  ACTIVITY_FACTOR_MIN,
  RATE_OPTIONS,
  calculateGoalProposal,
  type GoalOverrides,
} from '../lib/goalCalculator';
import {
  approveGoal,
  discardProposal,
  getCurrentProfile,
  getCurrentWeight,
  getGoalHistory,
  goalInputFromProfile,
  saveGoalProposal,
} from '../lib/profileGoals';
import { Card, Choice, Field, Notice, Screen, btnDanger, btnPrimary, btnSecondary, fmt, inputClass, numberText, parseNumber } from '../ui/kit';

const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

export function GoalsScreen({ onEditProfile }: { onEditProfile: () => void }) {
  const data = useLiveQuery(async () => {
    const [profile, weight, goals] = await Promise.all([getCurrentProfile(db), getCurrentWeight(db), getGoalHistory(db)]);
    return { profile, weight, goals };
  }, []);

  if (!data) return <Screen title="Metas">{null}</Screen>;
  const { profile, weight, goals } = data;
  const active = goals.find((g) => g.status === 'active') ?? null;
  const pending = goals.find((g) => g.status === 'proposed') ?? null;
  const archived = goals.filter((g) => g.status === 'archived');

  return (
    <Screen title="Metas" subtitle="La aplicación propone; tú apruebas. Ninguna meta se activa sola.">
      {active ? (
        <Card title="Meta activa">
          <GoalDetails goal={active} />
        </Card>
      ) : (
        <Notice tone="info">Todavía no hay ninguna meta aprobada.</Notice>
      )}

      {pending && <PendingProposal goal={pending} hasActive={!!active} />}

      {!profile || !weight ? (
        <Card title="Calcular una propuesta">
          <p className="text-sm text-stone-600">Para calcular tus metas hace falta completar antes el perfil.</p>
          <button className={btnPrimary} onClick={onEditProfile}>
            Completar perfil
          </button>
        </Card>
      ) : (
        <Calculator
          key={`${profile.id}-${weight.weightKg}`}
          input={goalInputFromProfile(profile, weight.weightKg)}
          weightNote={
            weight.source === 'progress'
              ? `Peso actual: ${fmt(weight.weightKg, 1)} kg (registro del ${formatShortDate(weight.date)}).`
              : `Peso: ${fmt(weight.weightKg, 1)} kg (declarado en el perfil el ${formatShortDate(weight.date)}).`
          }
          onEditProfile={onEditProfile}
        />
      )}

      {archived.length > 0 && (
        <Card title="Historial">
          <ul className="flex flex-col gap-2 text-sm">
            {archived.map((g) => (
              <li key={g.id} className="rounded-lg border border-stone-200 p-3">
                <details>
                  <summary className="cursor-pointer">
                    v{g.version} · {OBJECTIVE_LABEL[g.objective]} · {fmt(g.targets.default.energyKcal.central)} kcal ·{' '}
                    {g.approvedAt
                      ? `vigente del ${g.effectiveFrom ? formatShortDate(g.effectiveFrom) : '—'} al ${g.effectiveTo ? formatShortDate(g.effectiveTo) : '—'}`
                      : 'propuesta no aprobada'}
                  </summary>
                  <div className="mt-2">
                    <GoalDetails goal={g} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Screen>
  );
}

function GoalDetails({ goal }: { goal: NutritionGoal }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">
        <strong>{OBJECTIVE_LABEL[goal.objective]}</strong>
        {goal.targetRateKgPerWeek !== null && ` · ${fmt(goal.targetRateKgPerWeek, 2)} kg/semana`}
        {goal.approvedAt && ` · aprobada el ${dateTime.format(new Date(goal.approvedAt))}`}
      </p>
      <TargetsTable targets={goal.targets.default} />
      <details className="text-sm text-stone-600">
        <summary className="cursor-pointer text-stone-700">Cómo se ha calculado</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Basal {fmt(goal.estimatedBmrKcal)} kcal × factor {fmt(goal.activityFactor, 2)} = gasto estimado{' '}
            {fmt(goal.estimatedTdeeKcal)} kcal ({goal.bmrFormula}).
          </li>
          <li>Peso de referencia: {fmt(goal.referenceWeightKg, 1)} kg.</li>
          {goal.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function PendingProposal({ goal, hasActive }: { goal: NutritionGoal; hasActive: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await approveGoal(db, goal.id);
      dialog.current?.close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-950">Propuesta pendiente de tu aprobación</h2>
      <p className="text-sm text-amber-900">Esta propuesta no está en uso. Solo se activará si la apruebas.</p>
      <div className="rounded-lg bg-white p-3">
        <GoalDetails goal={goal} />
      </div>
      <div className="flex flex-col gap-2">
        <button className={btnPrimary} onClick={() => dialog.current?.showModal()}>
          Aprobar y activar esta meta
        </button>
        <button className={btnDanger} onClick={() => discardProposal(db, goal.id)}>
          Descartar propuesta
        </button>
      </div>

      <dialog ref={dialog} className="m-auto w-[min(92vw,26rem)] rounded-xl p-0 backdrop:bg-black/40">
        <div className="flex flex-col gap-3 p-5">
          <h3 className="text-lg font-semibold text-stone-900">¿Activar esta meta?</h3>
          <p className="text-sm text-stone-700">
            {OBJECTIVE_LABEL[goal.objective]} · {fmt(goal.targets.default.energyKcal.central)} kcal ·{' '}
            {fmt(goal.targets.default.proteinG.central)} g de proteínas.
          </p>
          <p className="text-sm text-stone-600">
            {hasActive
              ? 'La meta activa actual quedará archivada en el historial con su fecha de fin.'
              : 'Pasará a ser tu meta activa desde hoy.'}{' '}
            Los días ya registrados no cambian.
          </p>
          <div className="flex flex-col gap-2">
            <button className={btnPrimary} disabled={busy} onClick={confirm}>
              Sí, aprobar y activar
            </button>
            <button className={btnSecondary} onClick={() => dialog.current?.close()}>
              Cancelar
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

type OverrideKey = keyof GoalOverrides;

function Calculator({
  input,
  weightNote,
  onEditProfile,
}: {
  input: ReturnType<typeof goalInputFromProfile>;
  weightNote: string;
  onEditProfile: () => void;
}) {
  const [objective, setObjective] = useState<Objective | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [edits, setEdits] = useState<Partial<Record<OverrideKey, string>>>({});
  const [saved, setSaved] = useState(false);

  const overrides = useMemo(() => {
    const o: GoalOverrides = {};
    for (const [k, text] of Object.entries(edits)) {
      const n = parseNumber(text ?? '');
      if (n === null || n <= 0) continue;
      // Un factor fuera de [1,2 – 1,9] se ignora (también mientras se está escribiendo).
      if (k === 'activityFactor' && (n < ACTIVITY_FACTOR_MIN || n > ACTIVITY_FACTOR_MAX)) continue;
      o[k as OverrideKey] = n;
    }
    return o;
  }, [edits]);

  const ready = input !== null && objective !== null && (objective === 'maintain' || rate !== null);
  const proposal = useMemo(
    () => (ready ? calculateGoalProposal({ ...input, objective, targetRateKgPerWeek: rate, overrides }) : null),
    [ready, input, objective, rate, overrides],
  );

  if (input === null) {
    return (
      <Card title="Calcular una propuesta">
        <p className="text-sm text-stone-600">Falta la edad o la fecha de nacimiento en el perfil.</p>
        <button className={btnPrimary} onClick={onEditProfile}>
          Completar perfil
        </button>
      </Card>
    );
  }

  const edit = (key: OverrideKey, text: string) => {
    setSaved(false);
    setEdits((e) => ({ ...e, [key]: text }));
  };
  const value = (key: OverrideKey, computed: number) => edits[key] ?? numberText(computed);

  async function save() {
    if (!proposal) return;
    await saveGoalProposal(db, proposal);
    setSaved(true);
    setEdits({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <Card title="Calcular una propuesta">
      <p className="text-sm text-stone-600">
        {weightNote}{' '}
        <button className="text-emerald-800 underline" onClick={onEditProfile}>
          Editar perfil
        </button>
      </p>
      <Choice
        label="Objetivo"
        value={objective}
        onChange={(v) => {
          setObjective(v);
          setRate(null);
          setEdits({});
          setSaved(false);
        }}
        options={[
          { value: 'maintain', label: 'Mantener' },
          { value: 'fat_loss', label: 'Perder grasa' },
          { value: 'muscle_gain', label: 'Ganar músculo' },
        ]}
      />
      {objective !== null && objective !== 'maintain' && (
        <Choice
          label="Ritmo deseado (kg por semana)"
          value={rate}
          onChange={(v) => {
            setRate(v);
            setEdits({});
            setSaved(false);
          }}
          options={RATE_OPTIONS[objective].map((r) => ({ value: r, label: fmt(r, 2) }))}
        />
      )}

      {proposal && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="Basal estimado" value={`${fmt(proposal.estimatedBmrKcal)} kcal`} />
            <Stat label="Factor" value={fmt(proposal.activityFactor, 2)} />
            <Stat label="Gasto estimado" value={`${fmt(proposal.estimatedTdeeKcal)} kcal`} />
          </dl>

          <TargetsTable targets={proposal.targets} />

          {proposal.warnings.map((w) => (
            <Notice key={w.code} tone="warn">
              {w.message}
            </Notice>
          ))}

          <details className="rounded-lg border border-stone-200 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-stone-800">Ajustar valores a mano</summary>
            <div className="mt-3 flex flex-col gap-3">
              <Field label="Factor de actividad" hint="Entre 1,2 (sedentario) y 1,9.">
                <input
                  inputMode="decimal"
                  className={inputClass}
                  value={value('activityFactor', proposal.activityFactor)}
                  onChange={(e) => edit('activityFactor', e.target.value)}
                />
              </Field>
              <Field label="Energía (kcal)">
                <input
                  inputMode="numeric"
                  className={inputClass}
                  value={value('energyKcal', proposal.targets.energyKcal.central)}
                  onChange={(e) => edit('energyKcal', e.target.value)}
                />
              </Field>
              <Field label="Proteínas (g)">
                <input
                  inputMode="numeric"
                  className={inputClass}
                  value={value('proteinG', proposal.targets.proteinG.central)}
                  onChange={(e) => edit('proteinG', e.target.value)}
                />
              </Field>
              <Field label="Grasas (g)">
                <input
                  inputMode="numeric"
                  className={inputClass}
                  value={value('fatG', proposal.targets.fatG.central)}
                  onChange={(e) => edit('fatG', e.target.value)}
                />
              </Field>
              <Field label="Fibra (g)" hint="Los carbohidratos se recalculan con la energía restante.">
                <input
                  inputMode="numeric"
                  className={inputClass}
                  value={value('fiberG', proposal.targets.fiberG.central)}
                  onChange={(e) => edit('fiberG', e.target.value)}
                />
              </Field>
              {Object.keys(edits).length > 0 && (
                <button className={btnSecondary} onClick={() => setEdits({})}>
                  Volver a los valores calculados
                </button>
              )}
            </div>
          </details>

          <details className="text-sm text-stone-600">
            <summary className="cursor-pointer text-stone-700">Cómo se ha calculado</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {proposal.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>

          <button className={btnPrimary} onClick={save}>
            Guardar como propuesta
          </button>
          <p className="text-xs text-stone-500">
            Guardar no activa nada: la propuesta aparecerá arriba para que la apruebes o la descartes.
          </p>
        </>
      )}
      {saved && <Notice tone="ok">Propuesta guardada. Revísala arriba y apruébala si estás de acuerdo.</Notice>}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-stone-900">{value}</dd>
    </div>
  );
}
