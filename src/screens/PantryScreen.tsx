import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { db } from '../db/db';
import type { Food, FoodEquivalence, InventoryBatch, InventoryMovement, StorageLocation } from '../db/types';
import { foodName, searchFoods } from '../lib/catalog';
import { formatShortDate, localIsoDate } from '../lib/dates';
import {
  addBatch, adjustBatch, CREATION_NOTE, daysToExpiry, fefo, LOCATION_LABELS, LOCATIONS, MOVEMENT_LABELS, reverseOperation,
  reversibleOperations, takeOut,
} from '../lib/inventory';
import { btnDanger, btnPrimary, btnSecondary, Card, Choice, Field, fmt, inputClass, Notice, parseNumber, Screen } from '../ui/kit';

const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : 'No se pudo completar la operación.');

export function amountText(quantity: number, unit: string): string {
  if ((unit === 'g' || unit === 'ml') && quantity >= 1000) return `${fmt(quantity / 1000, 2)} ${unit === 'g' ? 'kg' : 'l'}`;
  return `${fmt(quantity, quantity < 10 ? 1 : 0)} ${unit}`;
}

function expiryText(batch: InventoryBatch, today: string): { text: string; tone: string } | null {
  const days = daysToExpiry(batch.expiryDate, today);
  if (days === null) return null;
  if (days < 0) return { text: `Caducó el ${formatShortDate(batch.expiryDate!)}`, tone: 'text-red-700' };
  if (days === 0) return { text: 'Caduca hoy', tone: 'text-red-700' };
  if (days <= 3) return { text: days === 1 ? 'Caduca mañana' : `Caduca en ${days} días`, tone: 'text-amber-800' };
  return { text: `Caduca el ${formatShortDate(batch.expiryDate!)}`, tone: 'text-stone-500' };
}

export function PantryScreen() {
  const today = localIsoDate();
  const [mode, setMode] = useState<'list' | 'add' | { batchId: string }>('list');
  const [message, setMessage] = useState('');
  const data = useLiveQuery(async () => ({
    batches: fefo((await db.inventoryBatches.where('status').equals('available').toArray()).filter((b) => !b.deletedAt)),
    foods: await db.foods.filter((food) => !food.deletedAt).toArray(),
    equivalents: await db.foodEquivalences.filter((e) => !e.deletedAt && e.baseQuantity !== null).toArray(),
  }));
  const done = (text: string) => { setMessage(text); setMode('list'); };

  if (!data) return <Screen title="Despensa">{null}</Screen>;
  const foodById = new Map(data.foods.map((food) => [food.id, food]));

  if (mode === 'add') {
    return <AddBatch foods={data.foods} equivalents={data.equivalents} onCancel={() => setMode('list')} onDone={done} />;
  }
  if (typeof mode === 'object') {
    return <BatchDetail batchId={mode.batchId} foodById={foodById} today={today} onBack={() => setMode('list')} onDone={done} />;
  }

  const expiring = data.batches.filter((batch) => (daysToExpiry(batch.expiryDate, today) ?? 99) <= 3);
  return (
    <Screen title="Despensa" subtitle="Lo que tienes en casa. La lista de compra lo descuenta.">
      {message && <Notice tone="ok">{message}</Notice>}
      <button className={`${btnPrimary} self-start`} onClick={() => { setMessage(''); setMode('add'); }}>
        <Plus size={18} aria-hidden /> Añadir a la despensa
      </button>
      {!!expiring.length && (
        <Notice tone="warn">
          {expiring.length === 1 ? 'Un producto caduca' : `${fmt(expiring.length)} productos caducan`} pronto o ya ha caducado:{' '}
          {expiring.map((batch) => foodById.get(batch.foodId)?.name ?? 'Alimento').join(', ')}.
        </Notice>
      )}
      {!data.batches.length && (
        <Card>
          <p className="text-sm text-stone-700">
            Todavía no has guardado nada. Añade lo que tengas en la despensa, la nevera o el congelador y la lista de
            compra te dirá solo lo que falta.
          </p>
        </Card>
      )}
      {LOCATIONS.map((location) => {
        const batches = data.batches.filter((batch) => batch.location === location);
        if (!batches.length) return null;
        return (
          <Card key={location} title={`${LOCATION_LABELS[location]} · ${fmt(batches.length)}`}>
            <ul className="-my-2 divide-y divide-stone-100">
              {batches.map((batch) => {
                const food = foodById.get(batch.foodId);
                const expiry = expiryText(batch, today);
                return (
                  <li key={batch.id}>
                    <button className="flex min-h-12 w-full items-center gap-3 py-2 text-left" onClick={() => { setMessage(''); setMode({ batchId: batch.id }); }}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-stone-900">{food ? foodName(food) : 'Alimento no disponible'}</span>
                        {expiry && <span className={`block text-xs ${expiry.tone}`}>{expiry.text}</span>}
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums">{amountText(batch.remainingQuantity, batch.unit)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
    </Screen>
  );
}

function AddBatch({ foods, equivalents, onCancel, onDone }: {
  foods: Food[]; equivalents: FoodEquivalence[]; onCancel: () => void; onDone: (message: string) => void;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState('');
  const [food, setFood] = useState<Food>();
  const [quantityText, setQuantityText] = useState('');
  const [unit, setUnit] = useState('base');
  const [location, setLocation] = useState<StorageLocation | null>('pantry');
  const [expiryDate, setExpiryDate] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const measures = food ? equivalents.filter((e) => e.foodId === food.id) : [];
  const measure = measures.find((m) => m.id === unit);
  const typed = parseNumber(quantityText);
  const baseQuantity = typed === null ? null : measure ? typed * measure.baseQuantity! : typed;
  const results = query.trim() ? searchFoods(foods, query).slice(0, 8) : [];
  const valid = !!food && baseQuantity !== null && baseQuantity > 0 && !!location;

  async function confirm() {
    if (!food || baseQuantity === null || !location || busy) return;
    setBusy(true);
    setError('');
    try {
      await addBatch(db, { foodId: food.id, quantity: baseQuantity, location, expiryDate: expiryDate || null }, key);
      onDone(`${foodName(food)} añadido a ${LOCATION_LABELS[location].toLowerCase()}.`);
    } catch (cause) { setError(errorText(cause)); setBusy(false); }
  }

  return (
    <Screen title="Añadir a la despensa">
      <button className={`${btnSecondary} self-start`} onClick={onCancel}><ArrowLeft size={18} aria-hidden /> Volver</button>
      {error && <Notice tone="error">{error}</Notice>}
      <Card>
        {food ? (
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{foodName(food)}</span>
            <button className="text-sm font-medium text-emerald-800 underline" disabled={reviewing}
              onClick={() => { setFood(undefined); setUnit('base'); }}>Cambiar</button>
          </div>
        ) : (
          <>
            <Field label="Alimento">
              <div className="relative">
                <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
                <input className={`${inputClass} pl-10`} value={query} autoFocus placeholder="Busca: arroz, huevo, leche…"
                  onChange={(e) => setQuery(e.target.value)} />
              </div>
            </Field>
            {!!results.length && (
              <ul className="-mt-1 divide-y divide-stone-100 rounded-lg border border-stone-200">
                {results.map((result) => (
                  <li key={result.id}>
                    <button className="min-h-12 w-full px-3 py-2 text-left text-sm" onClick={() => { setFood(result); setQuery(''); }}>
                      {foodName(result)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim() && !results.length && <p className="text-sm text-stone-600">No hay coincidencias en tu catálogo.</p>}
          </>
        )}
        {food && (
          <fieldset disabled={reviewing} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Cantidad">
                <input className={inputClass} inputMode="decimal" value={quantityText} onChange={(e) => setQuantityText(e.target.value)} />
              </Field>
              <Field label="Unidad">
                <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="base">{food.baseUnit}</option>
                  {measures.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </Field>
            </div>
            {measure && baseQuantity !== null && <p className="-mt-2 text-xs text-stone-600">Equivale a {amountText(baseQuantity, food.baseUnit)}.</p>}
            <Choice label="Dónde lo guardas" value={location} onChange={setLocation}
              options={LOCATIONS.map((l) => ({ value: l, label: LOCATION_LABELS[l] }))} />
            <Field label="Caducidad (opcional)">
              <input className={inputClass} type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </Field>
          </fieldset>
        )}
      </Card>
      {reviewing && valid ? (
        <Card title="Confirmar">
          <p className="text-sm">
            Se añadirán <strong>{amountText(baseQuantity!, food!.baseUnit)}</strong> de <strong>{foodName(food!)}</strong> a{' '}
            {LOCATION_LABELS[location!].toLowerCase()}{expiryDate && <> con caducidad el {formatShortDate(expiryDate)}</>}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className={btnPrimary} disabled={busy} onClick={() => void confirm()}>Confirmar</button>
            <button className={btnSecondary} disabled={busy} onClick={() => setReviewing(false)}>Modificar</button>
          </div>
        </Card>
      ) : (
        food && <button className={`${btnPrimary} self-start`} disabled={!valid} onClick={() => setReviewing(true)}>Revisar</button>
      )}
    </Screen>
  );
}

type Action = 'use' | 'waste' | 'count';
const ACTION_LABELS: Record<Action, string> = { use: 'He usado', waste: 'Lo he tirado', count: 'Corregir' };

function BatchDetail({ batchId, foodById, today, onBack, onDone }: {
  batchId: string; foodById: Map<string, Food>; today: string; onBack: () => void; onDone: (message: string) => void;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [action, setAction] = useState<Action | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [undoing, setUndoing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const data = useLiveQuery(async () => {
    const batch = await db.inventoryBatches.get(batchId);
    const movements = await db.inventoryMovements.where('batchId').equals(batchId).toArray();
    const operations = await db.inventoryMovements.where('operationId').anyOf([...new Set(movements.map((m) => m.operationId))]).toArray();
    const reversals = await db.inventoryMovements.where('reversedOperationId').anyOf([...new Set(movements.map((m) => m.operationId))]).toArray();
    return { batch, movements: movements.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt)), all: [...operations, ...reversals] };
  }, [batchId]);
  if (!data) return <Screen title="Despensa">{null}</Screen>;
  const { batch, movements, all } = data;
  if (!batch) return <Screen title="Despensa"><Notice tone="error">Ese lote ya no existe.</Notice></Screen>;
  const food = foodById.get(batch.foodId);
  const name = food ? foodName(food) : 'Alimento no disponible';
  const expiry = expiryText(batch, today);
  const reversible = reversibleOperations(all);
  const typed = action === 'waste' && !quantityText.trim() ? batch.remainingQuantity : parseNumber(quantityText);
  const valid = typed !== null && (action === 'count' ? typed >= 0 : typed > 0);

  async function run(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try { await work(); onDone(message); }
    catch (cause) { setError(errorText(cause)); setBusy(false); setUndoing(undefined); setKey(crypto.randomUUID()); }
  }
  function confirmAction() {
    if (!action || typed === null || busy) return;
    if (action === 'count') void run(() => adjustBatch(db, batch!.id, typed, key), `${name}: ahora quedan ${amountText(typed, batch!.unit)}.`);
    else void run(() => takeOut(db, { foodId: batch!.foodId, batchId: batch!.id, quantity: typed, type: action === 'use' ? 'consumption_out' : 'waste_out' }, key),
      `${name}: ${action === 'use' ? 'descontados' : 'desechados'} ${amountText(typed, batch!.unit)}.`);
  }
  const summary = action === 'count'
    ? `Quedarán ${amountText(typed ?? 0, batch.unit)} (ahora hay ${amountText(batch.remainingQuantity, batch.unit)}).`
    : `Se ${action === 'use' ? 'descontarán' : 'desecharán'} ${amountText(typed ?? 0, batch.unit)} de este lote.`;

  return (
    <Screen title={name} subtitle={`${LOCATION_LABELS[batch.location]}${expiry ? ` · ${expiry.text}` : ''}`}>
      <button className={`${btnSecondary} self-start`} onClick={onBack}><ArrowLeft size={18} aria-hidden /> Volver</button>
      {error && <Notice tone="error">{error}</Notice>}
      <Card>
        <p className="text-sm text-stone-600">Quedan</p>
        <p className="-mt-2 text-2xl font-semibold tabular-nums">{amountText(batch.remainingQuantity, batch.unit)}
          <span className="text-sm font-normal text-stone-500"> de {amountText(batch.initialQuantity, batch.unit)}</span></p>
        {batch.status !== 'available' && <Notice tone="info">Este lote está {batch.status === 'discarded' ? 'desechado' : 'agotado'}.</Notice>}
        {batch.status === 'available' && (
          <>
            <Choice label="¿Qué ha pasado?" value={action} options={(Object.keys(ACTION_LABELS) as Action[]).map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
              onChange={(next) => { setAction(next); setQuantityText(''); setReviewing(false); }} />
            {action && (
              <fieldset disabled={reviewing} className="flex flex-col gap-3">
                <Field label={action === 'count' ? `Cantidad que queda (${batch.unit})` : `Cantidad (${batch.unit})`}
                  hint={action === 'waste' ? 'Déjalo vacío para tirar todo lo que queda.' : undefined}>
                  <input className={inputClass} inputMode="decimal" value={quantityText} onChange={(e) => setQuantityText(e.target.value)} />
                </Field>
              </fieldset>
            )}
            {action && (reviewing && valid ? (
              <div className="flex flex-col gap-2">
                <Notice tone="warn">{summary}</Notice>
                <div className="flex flex-wrap gap-2">
                  <button className={btnPrimary} disabled={busy} onClick={confirmAction}>Confirmar</button>
                  <button className={btnSecondary} disabled={busy} onClick={() => setReviewing(false)}>Modificar</button>
                </div>
              </div>
            ) : <button className={`${btnPrimary} self-start`} disabled={!valid} onClick={() => setReviewing(true)}>Revisar</button>)}
          </>
        )}
      </Card>
      <Card title="Historial">
        <ul className="-my-2 divide-y divide-stone-100 text-sm">
          {movements.map((m) => (
            <MovementRow key={m.id} movement={m}
              annulled={all.some((x) => x.reversedMovementId === m.id)}
              annuls={m.reversedMovementId ? all.find((x) => x.id === m.reversedMovementId) : undefined} canUndo={reversible.has(m.operationId) && !(m.note === CREATION_NOTE && batch.remainingQuantity < batch.initialQuantity)} confirming={undoing === m.operationId}
              busy={busy} othersInOperation={all.filter((x) => x.operationId === m.operationId && x.batchId !== batch.id).length}
              onAsk={() => setUndoing(m.operationId)} onCancel={() => setUndoing(undefined)}
              onConfirm={() => void run(() => reverseOperation(db, m.operationId, key), 'Movimiento deshecho.')} />
          ))}
        </ul>
        <p className="text-xs text-stone-500">El historial no se borra: deshacer añade un movimiento compensatorio.</p>
      </Card>
    </Screen>
  );
}

function movementLabel(movement: InventoryMovement): string {
  if (movement.note === CREATION_NOTE) return 'Alta';
  if (movement.note === 'Recuento') return 'Recuento';
  return MOVEMENT_LABELS[movement.type];
}

function MovementRow({ movement, annulled, annuls, canUndo, confirming, busy, othersInOperation, onAsk, onCancel, onConfirm }: {
  movement: InventoryMovement; annulled: boolean; annuls?: InventoryMovement; canUndo: boolean; confirming: boolean; busy: boolean; othersInOperation: number;
  onAsk: () => void; onCancel: () => void; onConfirm: () => void;
}) {
  const label = annuls ? `Anulación: ${movementLabel(annuls).toLowerCase()}` : movementLabel(movement);
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span className={annulled ? 'text-stone-500 line-through' : ''}>
          {label}
          <span className="block text-xs text-stone-500">{dateTime.format(new Date(movement.occurredAt))}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className={`tabular-nums ${movement.quantityDelta < 0 ? 'text-stone-700' : 'text-emerald-800'}`}>
            {movement.quantityDelta > 0 ? '+' : '−'}{amountText(Math.abs(movement.quantityDelta), movement.unit)}
          </span>
          {canUndo && !confirming && <button className="min-h-11 px-1 text-sm font-medium text-emerald-800 underline" onClick={onAsk}>Deshacer</button>}
        </span>
      </div>
      {confirming && (
        <div className="mt-2 flex flex-col gap-2">
          <Notice tone="warn">
            Se anulará este movimiento{othersInOperation > 0 && ` y ${othersInOperation === 1 ? 'otro de la misma operación en otro lote' : `${othersInOperation} más de la misma operación en otros lotes`}`}.
          </Notice>
          <div className="flex gap-2">
            <button className={btnDanger} disabled={busy} onClick={onConfirm}>Deshacer</button>
            <button className={btnSecondary} disabled={busy} onClick={onCancel}>Cancelar</button>
          </div>
        </div>
      )}
    </li>
  );
}
