import { useState, type FormEvent } from 'react';
import { db } from '../db/db';
import type { Food, FoodEquivalence } from '../db/types';
import {
  FOOD_CATEGORIES, FOOD_SOURCES, NUTRIENT_KEYS, NUTRIENT_LABELS, STATE_LABELS, mapNutrients, saveFood,
  type EquivalenceDetails, type FoodDetails,
} from '../lib/catalog';
import { btnPrimary, btnSecondary, Card, Field, inputClass, Notice, numberText, parseNumber } from '../ui/kit';

const EMPTY_FOOD: FoodDetails = {
  name: '', brand: null, kind: 'generic', category: null, baseUnit: 'g', defaultState: null,
  source: 'estimate', externalId: null, sourceFetchedAt: null, sourceVersion: null,
  verificationStatus: 'pending_review', nutrientsPer100: mapNutrients(() => null),
};

export function FoodEditor({ food, equivalents, onSaved, onCancel }: {
  food?: Food;
  equivalents: FoodEquivalence[];
  onSaved: (food: Food) => void;
  onCancel: () => void;
}) {
  const [original] = useState(food);
  const [details, setDetails] = useState<FoodDetails>(food ?? EMPTY_FOOD);
  const [values, setValues] = useState(() => Object.fromEntries(
    NUTRIENT_KEYS.map((key) => [key, numberText(details.nutrientsPer100[key])]),
  ));
  const [measureLabel, setMeasureLabel] = useState('');
  const [measureAmount, setMeasureAmount] = useState('');
  const [yieldFactor, setYieldFactor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const imported = food?.source === 'off' || food?.source === 'usda';
  const categories = details.category && !FOOD_CATEGORIES.includes(details.category)
    ? [...FOOD_CATEGORIES, details.category] : FOOD_CATEGORIES;

  function set<K extends keyof FoodDetails>(key: K, value: FoodDetails[K]) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const nutrientsPer100 = mapNutrients((key) => {
        const value = parseNumber(values[key]);
        if (values[key].trim() && value === null) throw new Error(`Revisa el valor de ${NUTRIENT_LABELS[key].toLowerCase()}.`);
        return value;
      });
      const measures: EquivalenceDetails[] = [];
      if (measureLabel.trim() || measureAmount.trim()) {
        measures.push({
          label: measureLabel, baseQuantity: parseNumber(measureAmount), rawToCookedYieldFactor: null,
          source: 'Edición manual', precision: 'approximate',
        });
      }
      if (yieldFactor.trim()) {
        measures.push({
          label: 'Rendimiento de cocción', baseQuantity: null, rawToCookedYieldFactor: parseNumber(yieldFactor),
          source: 'Edición manual', precision: 'approximate',
        });
      }
      onSaved(await saveFood(db, { ...details, nutrientsPer100 }, original, measures));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el alimento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Card title="Ficha">
        <Field label="Nombre"><input className={inputClass} required value={details.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Marca"><input className={inputClass} value={details.brand ?? ''} onChange={(e) => set('brand', e.target.value)} /></Field>
        <Field label="Tipo">
          <select className={inputClass} value={details.kind} onChange={(e) => set('kind', e.target.value === 'commercial' ? 'commercial' : 'generic')}>
            <option value="generic">Genérico</option><option value="commercial">Comercial</option>
          </select>
        </Field>
        <Field label="Categoría">
          <select className={inputClass} value={details.category ?? ''} onChange={(e) => set('category', e.target.value || null)}>
            <option value="">Sin dato</option>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </Field>
        <Field label="Estado de la ficha">
          <select className={inputClass} value={details.defaultState ?? ''} onChange={(e) => set('defaultState', (e.target.value || null) as Food['defaultState'])}>
            <option value="">Tal como se vende o sin dato</option>
            <option value="raw">{STATE_LABELS.raw}</option><option value="cooked">{STATE_LABELS.cooked}</option>
          </select>
        </Field>
        <Field label="Unidad base">
          <select className={inputClass} value={details.baseUnit}
            disabled={equivalents.some((e) => e.baseQuantity !== null)}
            onChange={(e) => set('baseUnit', e.target.value === 'ml' ? 'ml' : 'g')}>
            <option value="g">Gramos</option><option value="ml">Mililitros</option>
          </select>
        </Field>
        <Field label="Fuente de los datos">
          <select className={inputClass} value={details.source} disabled={imported}
            onChange={(e) => setDetails((current) => ({ ...current, source: e.target.value as Food['source'], externalId: null }))}>
            {(['user_label', 'bedca', 'estimate'] as const).map((source) => <option key={source} value={source}>{FOOD_SOURCES[source]}</option>)}
            {imported && <option value={details.source}>{FOOD_SOURCES[details.source]}</option>}
          </select>
        </Field>
        {details.source === 'bedca' && (
          <Field label="Referencia de BEDCA">
            <input className={inputClass} value={details.externalId ?? ''} onChange={(e) => set('externalId', e.target.value || null)} />
          </Field>
        )}
        <label className="flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" checked={details.verificationStatus === 'verified'}
            onChange={(e) => set('verificationStatus', e.target.checked ? 'verified' : 'pending_review')} />
          {details.source === 'off' ? 'He comprobado los valores y la unidad con la etiqueta' : 'Datos verificados'}
        </label>
      </Card>
      <Card title={`Nutrientes por 100 ${details.baseUnit}`}>
        <p className="text-sm text-stone-600">Deja en blanco los valores desconocidos.</p>
        <div className="grid grid-cols-2 gap-3">
          {NUTRIENT_KEYS.map((key) => (
            <Field key={key} label={`${NUTRIENT_LABELS[key]} (${key === 'energyKcal' ? 'kcal' : 'g'})`}>
              <input className={inputClass} inputMode="decimal" value={values[key]} placeholder="Sin dato"
                onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
      </Card>
      <Card title="Equivalencias opcionales">
        <p className="text-sm text-stone-600">Para actualizar una medida existente, usa el mismo nombre.</p>
        {equivalents.map((e) => (
          <button key={e.id} className={`${btnSecondary} self-start`} type="button" onClick={() => {
            if (e.baseQuantity !== null) {
              setMeasureLabel(e.label);
              setMeasureAmount(numberText(e.baseQuantity));
            } else setYieldFactor(numberText(e.rawToCookedYieldFactor));
          }}>Editar {e.label.toLocaleLowerCase('es-ES')}</button>
        ))}
        <Field label="Medida casera" hint="Por ejemplo, rebanada o cucharada.">
          <input className={inputClass} value={measureLabel} onChange={(e) => setMeasureLabel(e.target.value)} />
        </Field>
        <Field label={`${details.baseUnit} por medida`}>
          <input className={inputClass} inputMode="decimal" value={measureAmount} onChange={(e) => setMeasureAmount(e.target.value)} />
        </Field>
        {details.baseUnit === 'g' && (
          <Field label="Rendimiento de cocción" hint="Peso cocinado dividido por peso crudo.">
            <input className={inputClass} inputMode="decimal" value={yieldFactor} onChange={(e) => setYieldFactor(e.target.value)} />
          </Field>
        )}
      </Card>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} disabled={busy}>Guardar alimento</button>
        <button className={btnSecondary} type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
