import { useState, type FormEvent } from 'react';
import { db } from '../db/db';
import type { Food, FoodEquivalence, Recipe, RecipeIngredient } from '../db/types';
import { foodName, searchFoods, STATE_LABELS } from '../lib/catalog';
import { saveRecipe, type IngredientInput } from '../lib/recipes';
import { btnPrimary, btnSecondary, Card, Field, inputClass, Notice, numberText, parseNumber } from '../ui/kit';

type DraftIngredient = Omit<IngredientInput, 'quantity'> & { key: string; quantity: string };

function optionalNumber(text: string, label: string) {
  const value = parseNumber(text);
  if (text.trim() && value === null) throw new Error(`Revisa el campo «${label}».`);
  return value;
}

export function RecipeEditor({ recipe, ingredients, foods, equivalents, onSaved, onCancel }: {
  recipe?: Recipe;
  ingredients: RecipeIngredient[];
  foods: Food[];
  equivalents: FoodEquivalence[];
  onSaved: (recipe: Recipe) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? '');
  const [servings, setServings] = useState(recipe ? numberText(recipe.servings) : '2');
  const [weight, setWeight] = useState(numberText(recipe?.totalCookedWeightG));
  const [minutes, setMinutes] = useState(numberText(recipe?.prepTimeMin));
  const [instructions, setInstructions] = useState(recipe?.instructions.join('\n') ?? '');
  const [rows, setRows] = useState<DraftIngredient[]>(() => ingredients.map((ingredient) => ({
    key: ingredient.id, foodId: ingredient.foodId, unit: ingredient.unit, state: ingredient.state,
    isOptional: ingredient.isOptional, equivalenceId: ingredient.equivalenceId, quantity: numberText(ingredient.quantity),
  })));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function updateRow(key: string, change: Partial<DraftIngredient>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...change } : row));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await saveRecipe(db, {
        name, servings: parseNumber(servings) ?? NaN, totalCookedWeightG: optionalNumber(weight, 'Peso cocinado'),
        prepTimeMin: optionalNumber(minutes, 'Tiempo de preparación'),
        instructions: instructions.split('\n').map((line) => line.trim()).filter(Boolean),
      }, rows.map(({ key: _key, quantity, ...row }) => ({ ...row, quantity: parseNumber(quantity) ?? NaN })), recipe));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la receta.');
    } finally {
      setBusy(false);
    }
  }

  const matches = query.trim() ? searchFoods(foods, query) : [];
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {recipe && <Notice tone="info">Al guardar se crea una nueva versión con los datos vigentes del catálogo.</Notice>}
      <Card title="Receta">
        <Field label="Nombre"><input className={inputClass} value={name} required onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Raciones"><input className={inputClass} inputMode="decimal" required value={servings} onChange={(e) => setServings(e.target.value)} /></Field>
        <Field label="Peso cocinado total (g)" hint="Opcional">
          <input className={inputClass} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="Tiempo de preparación (min)" hint="Opcional">
          <input className={inputClass} inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
        <Field label="Preparación" hint="Escribe un paso por línea.">
          <textarea className={`${inputClass} py-2`} rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
      </Card>
      <Card title="Ingredientes">
        {rows.map((row) => {
          const food = foods.find((item) => item.id === row.foodId);
          const measures = equivalents.filter((e) => e.foodId === row.foodId && e.baseQuantity !== null);
          const selection = row.equivalenceId ?? row.unit;
          return (
            <div key={row.key} className="space-y-2 rounded-lg border border-stone-200 p-3">
              <p className="font-medium">{food ? foodName(food) : 'Alimento no disponible'}</p>
              {food?.defaultState && <p className="text-xs text-stone-600">{STATE_LABELS[food.defaultState]}</p>}
              {food?.verificationStatus === 'pending_review' && <p className="text-xs text-amber-900">Datos pendientes de verificar</p>}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Cantidad">
                  <input className={inputClass} inputMode="decimal" required value={row.quantity} onChange={(e) => updateRow(row.key, { quantity: e.target.value })} />
                </Field>
                <Field label="Unidad">
                  <select className={inputClass} value={selection} onChange={(e) => {
                    if (!food) return;
                    const value = e.target.value;
                    updateRow(row.key, value === food.baseUnit ? { unit: food.baseUnit, equivalenceId: undefined }
                      : { unit: 'unit', equivalenceId: value });
                  }}>
                    {food && <option value={food.baseUnit}>{food.baseUnit}</option>}
                    {measures.map((measure) => <option key={measure.id} value={measure.id}>{measure.label}</option>)}
                    {selection !== food?.baseUnit && !measures.some((measure) => measure.id === selection) &&
                      <option value={selection} disabled>Elige una unidad vigente</option>}
                  </select>
                </Field>
              </div>
              <button type="button" className={btnSecondary} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>Quitar ingrediente</button>
            </div>
          );
        })}
        <Field label="Añadir del catálogo" hint="Elige la ficha que corresponda a cómo has medido el ingrediente.">
          <input type="search" className={inputClass} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
        </Field>
        {query.trim() && !matches.length && <p className="text-sm text-stone-600">No hay coincidencias en el catálogo.</p>}
        {!!matches.length && (
          <ul className="divide-y divide-stone-100">
            {matches.slice(0, 12).map((food) => (
              <li key={food.id}>
                <button type="button" className="min-h-12 w-full py-2 text-left text-sm" onClick={() => {
                  setRows((current) => [...current, {
                    key: crypto.randomUUID(), foodId: food.id, unit: food.baseUnit, state: food.defaultState ?? 'raw',
                    quantity: '', isOptional: false,
                  }]);
                  setQuery('');
                }}>Añadir {foodName(food)}</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} disabled={busy}>{recipe ? 'Guardar nueva versión' : 'Guardar receta'}</button>
        <button className={btnSecondary} type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
