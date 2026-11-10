import { useLiveQuery } from 'dexie-react-hooks';
import { OBJECTIVE_LABEL, TargetsTable } from '../components/TargetsTable';
import { db } from '../db/db';
import { formatLongDate, formatShortDate, localIsoDate } from '../lib/dates';
import { getActiveGoal, getCurrentProfile, getCurrentWeight, getPendingProposal } from '../lib/profileGoals';
import { getProgressLog } from '../lib/progress';
import type { Route } from '../routes';
import { Card, Notice, Screen, btnPrimary, btnSecondary, fmt } from '../ui/kit';

export function HomeScreen({ go }: { go: (route: Route) => void }) {
  const today = localIsoDate();
  const data = useLiveQuery(async () => {
    const [profile, weight, active, pending, log] = await Promise.all([
      getCurrentProfile(db),
      getCurrentWeight(db),
      getActiveGoal(db),
      getPendingProposal(db),
      getProgressLog(db, today),
    ]);
    return { profile, weight, active, pending, log };
  }, [today]);

  if (!data) return <Screen title="Mi Nutrición">{null}</Screen>;
  const { profile, weight, active, pending, log } = data;

  return (
    <Screen title="Mi Nutrición" subtitle={capitalize(formatLongDate(today))}>
      {!profile && (
        <Card title="Bienvenido">
          <p className="text-sm text-stone-700">
            Empieza por tu perfil y tu actividad. Con ellos la aplicación calcula una propuesta de metas que tú revisas y
            apruebas.
          </p>
          <button className={btnPrimary} onClick={() => go('config/perfil')}>
            Empezar: mi perfil
          </button>
        </Card>
      )}

      {pending && (
        <Notice tone="warn">
          Tienes una propuesta de metas pendiente de aprobar.{' '}
          <button className="font-medium underline" onClick={() => go('config/metas')}>
            Revisarla
          </button>
        </Notice>
      )}

      {profile && (
        <Card title="Meta activa">
          {active ? (
            <>
              <p className="text-sm text-stone-700">
                <strong>{OBJECTIVE_LABEL[active.objective]}</strong>
                {active.effectiveFrom && ` · desde el ${formatShortDate(active.effectiveFrom)}`}
              </p>
              <TargetsTable targets={active.targets.default} />
            </>
          ) : (
            <p className="text-sm text-stone-600">Todavía no hay ninguna meta aprobada.</p>
          )}
          <button className={btnSecondary} onClick={() => go('config/metas')}>
            {active ? 'Ver o cambiar metas' : 'Calcular mis metas'}
          </button>
        </Card>
      )}

      <Card title="Hoy">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Item label="Peso de hoy" value={log?.weightKg != null ? `${fmt(log.weightKg, 1)} kg` : 'Sin dato'} />
          <Item label="Sueño" value={log?.sleepHours != null ? `${fmt(log.sleepHours, 1)} h` : 'Sin dato'} />
          <Item label="Energía" value={log?.energyLevel1to5 != null ? `${log.energyLevel1to5} de 5` : 'Sin dato'} />
          <Item label="Hambre" value={log?.hungerLevel1to5 != null ? `${log.hungerLevel1to5} de 5` : 'Sin dato'} />
        </dl>
        {weight && (
          <p className="text-sm text-stone-600">
            Peso actual: <strong>{fmt(weight.weightKg, 1)} kg</strong> (
            {weight.source === 'progress' ? `registro del ${formatShortDate(weight.date)}` : 'declarado en el perfil'}).
          </p>
        )}
        <button className={btnPrimary} onClick={() => go('progreso')}>
          {log ? 'Editar el registro de hoy' : 'Registrar el día de hoy'}
        </button>
      </Card>
    </Screen>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-stone-50 p-2">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-stone-900">{value}</dd>
    </div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
