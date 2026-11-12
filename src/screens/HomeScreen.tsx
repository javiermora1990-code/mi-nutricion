import { useLiveQuery } from 'dexie-react-hooks';
import { OBJECTIVE_LABEL } from '../components/TargetsTable';
import { db } from '../db/db';
import type { MealPlan } from '../db/types';
import { formatLongDate, localIsoDate } from '../lib/dates';
import { MEAL_LABELS, nextPlannedDate, planItemName, planNutrients, sortByMealSlot } from '../lib/planning';
import { getActiveGoal, getCurrentProfile, getPendingProposal } from '../lib/profileGoals';
import { quantityLabel } from '../lib/recipes';
import type { Route } from '../routes';
import { btnPrimary, btnSecondary, Card, fmt, Notice, Screen, servingsText } from '../ui/kit';

export function HomeScreen({ go }: { go: (route: Route) => void }) {
  const today = localIsoDate();
  const data = useLiveQuery(async () => {
    const [profile, active, pending, menuDate] = await Promise.all([
      getCurrentProfile(db), getActiveGoal(db), getPendingProposal(db), nextPlannedDate(db, today),
    ]);
    const plans = menuDate
      ? await db.mealPlans.where('date').equals(menuDate).and((plan) => !plan.deletedAt).toArray()
      : [];
    return { profile, active, pending, menuDate, plans: sortByMealSlot(plans) };
  }, [today]);

  if (!data) return <Screen title="Mi Nutrición">{null}</Screen>;
  const { profile, active, pending, menuDate, plans } = data;

  return (
    <Screen title="Mi Nutrición" subtitle={capitalize(formatLongDate(today))}>
      {pending && (
        <Notice tone="warn">
          Tienes una propuesta de metas pendiente de aprobar.{' '}
          <button className="font-medium underline" onClick={() => go('config/metas')}>Revisarla</button>
        </Notice>
      )}

      {menuDate ? (
        <Card title={menuDate === today ? 'Hoy' : 'Tu próximo menú'}>
          {menuDate !== today && <p className="-mt-2 text-sm text-stone-600">Empieza el {formatLongDate(menuDate)}.</p>}
          <DayMenu plans={plans} />
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => go('plan')}>Ver la semana</button>
            <button className={btnSecondary} onClick={() => go('ia')}>Nuevo menú con la IA</button>
          </div>
        </Card>
      ) : (
        <Card title="Planifica tu semana">
          <p className="text-sm text-stone-700">
            No tienes ningún menú pendiente. Prepara tu contexto, pide a ChatGPT o Gemini las recetas y el menú de la
            semana, e importa aquí su propuesta.
          </p>
          <button className={btnPrimary} onClick={() => go('ia')}>Preparar menú con la IA</button>
        </Card>
      )}

      {active && (
        <button className="flex min-h-12 items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-2 text-left text-sm shadow-sm"
          onClick={() => go('config/metas')}>
          <span>Meta activa: <strong>{OBJECTIVE_LABEL[active.objective]}</strong></span>
          <span className="tabular-nums text-stone-600">
            {fmt(active.targets.default.energyKcal.central)} kcal · {fmt(active.targets.default.proteinG.central)} g proteína
          </span>
        </button>
      )}
      {!profile && (
        <p className="text-sm text-stone-600">
          Sin perfil, la IA no conocerá tus metas.{' '}
          <button className="font-medium text-emerald-800 underline" onClick={() => go('config/perfil')}>Completar en Configuración</button>
        </p>
      )}
    </Screen>
  );
}

function DayMenu({ plans }: { plans: MealPlan[] }) {
  const nutrients = planNutrients(plans);
  const dayType = plans[0]?.dayType;
  return (
    <>
      {dayType && <p className="text-xs text-stone-500">{dayType === 'training' ? 'Día de entrenamiento' : 'Día de descanso'}</p>}
      <dl className="divide-y divide-stone-100 text-sm">
        {plans.map((plan) => (
          <div key={plan.id} className="py-2">
            <dt className="text-xs font-medium text-stone-600">{MEAL_LABELS[plan.mealSlot]}</dt>
            <dd>
              {plan.items.length ? plan.items.map((item, i) => (
                <span key={i} className="block">
                  {planItemName(item)}
                  <span className="text-stone-500">
                    {' · '}{item.itemType === 'recipe' && item.unit === 'portion' ? servingsText(item.quantity) : `${fmt(item.quantity, 2)} ${quantityLabel[item.unit]}`}
                  </span>
                </span>
              )) : <span className="text-stone-500">Toma vacía</span>}
            </dd>
          </div>
        ))}
      </dl>
      {nutrients.energyKcal == null && nutrients.proteinG == null ? (
        <p className="text-sm text-stone-600">Previsto: sin dato de energía ni proteína porque falta información de algún alimento.</p>
      ) : (
        <p className="text-sm text-stone-700">
          Previsto: <strong className="tabular-nums">{nutrients.energyKcal == null ? 'Sin dato' : `${fmt(nutrients.energyKcal)} kcal`}</strong>
          {' · '}<strong className="tabular-nums">{nutrients.proteinG == null ? 'Sin dato' : `${fmt(nutrients.proteinG)} g proteína`}</strong>
        </p>
      )}
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
