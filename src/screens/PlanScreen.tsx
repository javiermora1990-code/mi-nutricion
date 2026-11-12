import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { NutrientList } from '../components/NutrientList';
import { db } from '../db/db';
import { addDays, formatLongDate, formatShortDate, localIsoDate, startOfWeek } from '../lib/dates';
import { applyPantry } from '../lib/inventory';
import { MEAL_LABELS, MEAL_SLOTS, nextPlannedDate, planItemName, planNutrients, shoppingList } from '../lib/planning';
import { quantityLabel } from '../lib/recipes';
import type { Route } from '../routes';
import { btnPrimary, btnSecondary, Card, fmt, Notice, Screen, servingsText } from '../ui/kit';
import { PantryScreen } from './PantryScreen';
import { RecipesScreen } from './RecipesScreen';

export function PlanScreen({ go }: { go: (route: Route) => void }) {
  const [view, setView] = useState<'menu' | 'recipes' | 'shopping' | 'pantry'>('menu');
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
  const batches = useLiveQuery(() => db.inventoryBatches.where('status').equals('available').toArray(), []);
  const list = shoppingList(plans ?? []);
  const lines = applyPantry(list.items, batches ?? []);
  const toBuy = lines.filter((line) => line.toBuy !== 0);
  const covered = lines.filter((line) => line.toBuy === 0);
  const tabs = (
    <div className="grid grid-cols-4 gap-1 rounded-xl bg-stone-200/70 p-1" role="tablist">
      {([{ id: 'menu', label: 'Menú' }, { id: 'recipes', label: 'Recetas' }, { id: 'shopping', label: 'Compra' }, { id: 'pantry', label: 'Despensa' }] as const)
        .map((tab) => (
          <button key={tab.id} role="tab" aria-selected={view === tab.id} onClick={() => setView(tab.id)}
            className={`min-h-11 rounded-lg px-1 text-sm font-medium transition ${view === tab.id ? 'bg-white text-emerald-800 shadow-sm' : 'text-stone-700'}`}>
            {tab.label}
          </button>
        ))}
    </div>
  );
  if (view === 'recipes') return <><div className="mx-auto max-w-xl px-4 pt-4">{tabs}</div><RecipesScreen /></>;
  if (view === 'pantry') return <><div className="mx-auto max-w-xl px-4 pt-4">{tabs}</div><PantryScreen /></>;
  if (!chosenWeek && initialWeek === undefined) return <div className="mx-auto max-w-xl px-4 pt-4">{tabs}</div>;
  return (
    <>
    <div className="mx-auto max-w-xl px-4 pt-4">{tabs}</div>
    <Screen title={view === 'shopping' ? 'Lista de compra' : 'Menú'} subtitle={view === 'shopping' ? 'Lo que falta para el menú de la semana' : 'Las comidas de tu semana'}>
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
          {list.incomplete && <Notice tone="warn">Hay cantidades sin equivalencia conocida. Revisa esas recetas antes de comprar.</Notice>}
          {!!toBuy.length && (
            <Card title="Por comprar">
              <ul className="divide-y divide-stone-100">
                {toBuy.map((item) => (
                  <li key={item.key}>
                    <label className="flex min-h-12 items-center gap-3 py-2 text-sm">
                      <input type="checkbox" className="size-5 shrink-0" checked={checked.has(item.key)} onChange={(event) => {
                        const next = new Set(checked);
                        if (event.target.checked) next.add(item.key);
                        else next.delete(item.key);
                        setChecked(next);
                      }} />
                      <span className={`flex-1 ${checked.has(item.key) ? 'text-stone-500 line-through' : ''}`}>
                        {item.name}{item.state === 'cooked' && <span className="text-stone-500"> · cocinado</span>}
                        {item.have > 0 && <span className="block text-xs text-stone-500">Necesitas {amount(item.quantity, item.unit)} · tienes {amount(item.have, item.unit)}</span>}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{amount(item.toBuy, item.unit)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-stone-500">Las marcas se mantienen mientras consultas esta semana.</p>
            </Card>
          )}
          {!!covered.length && (
            <Card title="Ya lo tienes en casa">
              <ul className="divide-y divide-stone-100 text-sm">
                {covered.map((item) => (
                  <li key={item.key} className="flex justify-between gap-3 py-2 text-stone-600">
                    <span>{item.name}{item.state === 'cooked' && ' · cocinado'}</span>
                    <span className="shrink-0 tabular-nums">{amount(item.quantity, item.unit)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {!!list.items.length && (
            <button className={btnSecondary} onClick={() => setView('pantry')}>Ver o actualizar la despensa</button>
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
    </>
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

function amount(quantity: number | null, unit: string | null): string {
  if (quantity === null) return 'Sin dato';
  if (unit === 'g' && quantity >= 1000) return `${fmt(quantity / 1000, 2)} kg`;
  if (unit === 'ml' && quantity >= 1000) return `${fmt(quantity / 1000, 2)} l`;
  return `${fmt(quantity)} ${unit ?? ''}`;
}
