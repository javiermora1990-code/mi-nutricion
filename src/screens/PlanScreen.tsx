import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { NutrientList } from '../components/NutrientList';
import { db } from '../db/db';
import { STATE_LABELS } from '../lib/catalog';
import { addDays, formatLongDate, formatShortDate, localIsoDate, startOfWeek } from '../lib/dates';
import { MEAL_LABELS, MEAL_SLOTS, nextPlannedDate, planItemName, planNutrients, shoppingList } from '../lib/planning';
import { quantityLabel } from '../lib/recipes';
import type { Route } from '../routes';
import { btnPrimary, btnSecondary, Card, fmt, Notice, Screen, servingsText } from '../ui/kit';
import { RecipesScreen } from './RecipesScreen';

export function PlanScreen({ go }: { go: (route: Route) => void }) {
  const [view, setView] = useState<'menu' | 'recipes' | 'shopping'>('menu');
  // Sin elección del usuario, se abre la semana actual o, si está vacía, la del próximo menú.
  const initialWeek = useLiveQuery(async () => {
    const thisWeek = startOfWeek(localIsoDate());
    const next = await nextPlannedDate(db, thisWeek);
    return next ? startOfWeek(next) : thisWeek;
  }, []);
  const [chosenWeek, setWeek] = useState<string>();
  const week = chosenWeek ?? initialWeek ?? startOfWeek(localIsoDate());
  const query = useLiveQuery(async () => ({
    week, plans: await db.mealPlans.where('date').between(week, addDays(week, 6), true, true)
      .and((plan) => !plan.deletedAt).toArray(),
  }), [week]);
  const plans = query?.week === week ? query.plans : undefined;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const list = shoppingList(plans ?? []);
  const tabs = (
    <div className="flex flex-wrap gap-2">
      {([{ id: 'menu', label: 'Menú' }, { id: 'recipes', label: 'Recetas' }, { id: 'shopping', label: 'Lista de compra' }] as const)
        .map((tab) => <button key={tab.id} className={view === tab.id ? btnPrimary : btnSecondary}
          aria-pressed={view === tab.id} onClick={() => setView(tab.id)}>{tab.label}</button>)}
    </div>
  );
  if (view !== 'recipes' && !chosenWeek && initialWeek === undefined) return <Screen title="Plan" subtitle="Organiza las comidas de tu semana">{tabs}</Screen>;
  if (view === 'recipes') return <><div className="mx-auto max-w-xl px-4 pt-4">{tabs}</div><RecipesScreen /></>;
  return (
    <Screen title="Plan" subtitle="Organiza las comidas de tu semana">
      {tabs}
      <WeekNavigator week={week} onChange={(next) => { setWeek(next); setChecked(new Set()); }} />
      {!plans && <p className="text-sm">Cargando menú…</p>}
      {plans && !plans.length && (
        <Card>
          <p className="text-sm text-stone-700">Todavía no hay un menú para esta semana.</p>
          <button className={btnPrimary} onClick={() => go('ia')}>Preparar o importar con la IA</button>
        </Card>
      )}
      {view === 'shopping' ? (
        <>
          <Notice tone="info">Necesidades de ingredientes del menú. Podrás contrastarlas con tu despensa al incorporar ese módulo.</Notice>
          {list.incomplete && <Notice tone="warn">Hay cantidades sin equivalencia conocida. Revisa esas recetas antes de comprar.</Notice>}
          {!!list.items.length && (
            <Card title="Ingredientes de la semana">
              <ul className="divide-y divide-stone-100">
                {list.items.map((item) => (
                  <li key={item.key}>
                    <label className="flex min-h-12 items-center gap-3 py-2 text-sm">
                      <input type="checkbox" checked={checked.has(item.key)} onChange={(event) => {
                        const next = new Set(checked);
                        if (event.target.checked) next.add(item.key);
                        else next.delete(item.key);
                        setChecked(next);
                      }} />
                      <span className={checked.has(item.key) ? 'text-stone-500 line-through' : ''}>
                        {item.name} · {item.quantity === null ? 'Sin dato' : `${fmt(item.quantity, 2)} ${item.unit ?? ''}`}
                        {item.state && <span className="block text-xs text-stone-500">{STATE_LABELS[item.state]}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-stone-500">Las marcas de esta vista se mantienen mientras consultas esta semana.</p>
            </Card>
          )}
        </>
      ) : Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((date) => {
        const dayPlans = plans?.filter((plan) => plan.date === date) ?? [];
        if (!dayPlans.length) return null;
        return (
          <Card key={date} title={formatLongDate(date)}>
            <p className="text-xs text-stone-500">{dayPlans[0].dayType === 'training' ? 'Entrenamiento' : dayPlans[0].dayType === 'rest' ? 'Descanso' : 'Sin tipo de día'}</p>
            {MEAL_SLOTS.map((slot) => dayPlans.filter((plan) => plan.mealSlot === slot).map((plan) => (
              <div key={plan.id} className="text-sm">
                <h3 className="font-medium">{MEAL_LABELS[slot]}</h3>
                <ul className="space-y-1">
                  {plan.items.map((item, i) => <li key={i}>{planItemName(item)} · {item.itemType === 'recipe' && item.unit === 'portion' ? servingsText(item.quantity) : `${fmt(item.quantity, 2)} ${quantityLabel[item.unit]}`}</li>)}
                </ul>
                {!plan.items.length && <p className="text-stone-500">Toma vacía</p>}
              </div>
            )))}
            <details className="text-sm">
              <summary className="min-h-12 cursor-pointer py-3 font-medium">Nutrientes previstos para el día</summary>
              <NutrientList nutrients={planNutrients(dayPlans)} />
            </details>
          </Card>
        );
      })}
    </Screen>
  );
}

/** Semana mostrada con flechas a los lados; fuera de la semana actual ofrece volver a ella. */
function WeekNavigator({ week, onChange }: { week: string; onChange: (week: string) => void }) {
  const current = startOfWeek(localIsoDate());
  const offset = Math.round((Date.parse(week) - Date.parse(current)) / (7 * 86_400_000));
  const relative = offset === 0 ? 'Esta semana' : offset === 1 ? 'La semana que viene' : offset === -1 ? 'La semana pasada' : null;
  const arrow = 'inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-800 hover:bg-stone-100';
  return (
    <div className="flex items-center gap-2">
      <button className={arrow} aria-label="Semana anterior" onClick={() => onChange(addDays(week, -7))}><ChevronLeft size={22} aria-hidden /></button>
      <div className="min-w-0 flex-1 text-center">
        <p className="font-semibold text-stone-900">{formatShortDate(week)} – {formatShortDate(addDays(week, 6))}</p>
        {relative
          ? <p className="text-xs text-stone-600">{relative}</p>
          : <button className="text-xs font-medium text-emerald-800 underline" onClick={() => onChange(current)}>Volver a esta semana</button>}
      </div>
      <button className={arrow} aria-label="Semana siguiente" onClick={() => onChange(addDays(week, 7))}><ChevronRight size={22} aria-hidden /></button>
    </div>
  );
}
