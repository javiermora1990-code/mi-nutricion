import { useState } from 'react';
import type { Food, FoodEquivalence, Recipe } from '../db/types';
import type { AiProposalDocument } from '../schemas/aiProposal';
import { newFoodRef, previewRecipeNutrients, type ProposalReview as Review, type ProposedFood } from '../lib/aiImport';
import { foodName, NUTRIENT_KEYS, NUTRIENT_LABELS, STATE_LABELS } from '../lib/catalog';
import { formatLongDate } from '../lib/dates';
import { MEAL_LABELS } from '../lib/planning';
import { latestRecipes } from '../lib/recipes';
import { btnPrimary, btnSecondary, Card, Field, fmt, inputClass, Notice, numberText, parseNumber } from '../ui/kit';
import { NutrientList } from './NutrientList';

function NumericInput({ value, onChange, label, optional }: {
  value: number | null; onChange: (value: number | null) => void; label: string; optional?: boolean;
}) {
  const [text, setText] = useState(numberText(value));
  return (
    <Field label={label}>
      <input className={inputClass} inputMode="decimal" value={text} required={!optional} placeholder={optional ? 'Sin dato' : ''}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = parseNumber(event.target.value);
          onChange(parsed === null && event.target.value.trim() ? NaN : parsed);
        }} />
    </Field>
  );
}

function FoodSelect({ foods, proposed, value, onChange, label }: {
  foods: Food[]; proposed: ProposedFood[]; value: string | null; onChange: (id: string) => void; label: string;
}) {
  return (
    <Field label={label}>
      <select className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Selecciona un alimento</option>
        {value && !foods.some((food) => food.id === value) && !proposed.some((_, i) => newFoodRef(i) === value) &&
          <option value={value}>Referencia desconocida · elige un alimento</option>}
        {foods.map((food) => <option key={food.id} value={food.id}>{foodName(food)}</option>)}
        {proposed.map((food, i) => <option key={i} value={newFoodRef(i)}>Nuevo · {foodName(food)}</option>)}
      </select>
    </Field>
  );
}

function UnitSelect({ value, equivalenceId, measures, onChange, recipe }: {
  value: string; equivalenceId?: string; measures: FoodEquivalence[];
  onChange: (unit: 'g' | 'ml' | 'unit' | 'portion', equivalenceId?: string) => void; recipe?: boolean;
}) {
  const selected = equivalenceId ?? value;
  return (
    <Field label="Unidad">
      <select className={inputClass} value={selected} onChange={(e) => {
        const measure = measures.find((measure) => measure.id === e.target.value);
        if (measure) onChange('unit', measure.id);
        else onChange(e.target.value as 'g' | 'ml' | 'unit' | 'portion');
      }}>
        <option value="g">g</option>
        {!recipe && <option value="ml">ml</option>}
        {recipe && <option value="portion">Raciones</option>}
        {!recipe && measures.map((measure) => <option key={measure.id} value={measure.id}>{measure.label}</option>)}
        {selected !== 'g' && selected !== 'ml' && !(recipe && selected === 'portion') &&
          !measures.some((measure) => measure.id === selected) && <option value={selected}>Elige una equivalencia</option>}
      </select>
    </Field>
  );
}

export function ProposalReview({ review, foods, equivalents, recipes, busy, onChange, onConfirm, onCancel }: {
  review: Review; foods: Food[]; equivalents: FoodEquivalence[]; recipes: Recipe[]; busy: boolean;
  onChange: (document: AiProposalDocument) => void;
  onConfirm: (replace: boolean) => void; onCancel: () => void;
}) {
  const [approved, setApproved] = useState(false);
  const [replace, setReplace] = useState(false);
  const payload = review.document.payload;
  const proposedFoods = payload.catalogItems ?? [];
  function edit(change: (document: AiProposalDocument) => void) {
    const document = structuredClone(review.document);
    change(document);
    setApproved(false);
    setReplace(false);
    onChange(document);
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (approved && !busy) onConfirm(replace); }}>
      <Notice tone="info">Revisa la propuesta antes de guardarla. Las cantidades de ingredientes son para todas las raciones de cada receta.</Notice>
      <fieldset disabled={busy} className="flex flex-col gap-4">
        {proposedFoods.map((food, index) => (
          <Card key={index} title={`Alimento nuevo · ${food.name}`}>
            <Notice tone="warn">Se guardará como pendiente de verificar.</Notice>
            <Field label="Nombre">
              <input className={inputClass} required value={food.name} onChange={(e) => edit((doc) => { doc.payload.catalogItems![index].name = e.target.value; })} />
            </Field>
            <p className="text-sm text-stone-600">{food.brand} · {food.source} · por 100 {food.baseUnit}</p>
            <div className="grid grid-cols-2 gap-2">
              {NUTRIENT_KEYS.map((key) => (
                <NumericInput key={key} label={`${NUTRIENT_LABELS[key]} (${key === 'energyKcal' ? 'kcal' : 'g'})`}
                  value={food.nutrientsPer100[key] ?? null} optional
                  onChange={(value) => edit((doc) => { doc.payload.catalogItems![index].nutrientsPer100[key] = value; })} />
              ))}
            </div>
          </Card>
        ))}
        {(payload.recipes ?? []).map((recipe, index) => (
          <Card key={recipe.tempId} title={`Receta · ${recipe.name}`}>
            <Field label="Guardar como">
              <select className={inputClass} value={recipe.existingRecipeId ?? ''} onChange={(e) => edit((doc) => {
                doc.payload.recipes![index].existingRecipeId = e.target.value || null;
              })}>
                <option value="">Receta nueva</option>
                {recipe.existingRecipeId && !latestRecipes(recipes).some((r) => r.id === recipe.existingRecipeId) &&
                  <option value={recipe.existingRecipeId}>Versión anterior · selecciona la actual</option>}
                {latestRecipes(recipes).map((r) => <option key={r.id} value={r.id}>Nueva versión de {r.name} · v{fmt(r.version)}</option>)}
              </select>
            </Field>
            <Field label="Nombre de la receta">
              <input className={inputClass} required value={recipe.name} onChange={(e) => edit((doc) => { doc.payload.recipes![index].name = e.target.value; })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <NumericInput label="Raciones" value={recipe.servings}
                onChange={(value) => edit((doc) => { doc.payload.recipes![index].servings = value ?? NaN; })} />
              <NumericInput label="Peso cocinado total (g)" value={recipe.totalCookedWeightG} optional
                onChange={(value) => edit((doc) => { doc.payload.recipes![index].totalCookedWeightG = value; })} />
            </div>
            {recipe.ingredients.map((ingredient, ingredientIndex) => {
              const food = foods.find((food) => food.id === ingredient.foodId);
              const measures = equivalents.filter((e) => e.foodId === ingredient.foodId && e.baseQuantity !== null);
              const set = (change: Partial<typeof ingredient>) => edit((doc) => {
                Object.assign(doc.payload.recipes![index].ingredients[ingredientIndex], change);
              });
              return (
                <div key={ingredientIndex} className="space-y-2 rounded-lg border border-stone-200 p-3">
                  <FoodSelect label={`Ingrediente · ${ingredient.proposedName}`} value={ingredient.foodId}
                    foods={foods} proposed={proposedFoods} onChange={(foodId) => {
                      const next = foods.find((food) => food.id === foodId) ?? proposedFoods.find((_, i) => newFoodRef(i) === foodId);
                      set({ foodId, unit: next?.baseUnit ?? 'g', state: next?.defaultState ?? ingredient.state, equivalenceId: undefined });
                    }} />
                  <div className="grid grid-cols-2 gap-2">
                    <NumericInput label="Cantidad" value={ingredient.quantity} onChange={(value) => set({ quantity: value ?? NaN })} />
                    <UnitSelect value={ingredient.unit} equivalenceId={ingredient.equivalenceId} measures={measures}
                      onChange={(unit, equivalenceId) => set({ unit, equivalenceId })} />
                  </div>
                  <Field label="Estado medido">
                    <select className={inputClass} value={ingredient.state} onChange={(e) => set({ state: e.target.value as 'raw' | 'cooked' })}>
                      <option value="raw">{STATE_LABELS.raw}</option><option value="cooked">{STATE_LABELS.cooked}</option>
                    </select>
                  </Field>
                  {food?.defaultState && food.defaultState !== ingredient.state &&
                    <p className="text-sm text-red-700">El estado no coincide. Selecciona la ficha correspondiente.</p>}
                </div>
              );
            })}
            <Field label="Preparación">
              <textarea className={`${inputClass} py-2`} rows={3} value={recipe.instructions.join('\n')}
                onChange={(e) => edit((doc) => { doc.payload.recipes![index].instructions = e.target.value.split('\n'); })} />
            </Field>
            <details className="text-sm">
              <summary className="min-h-12 cursor-pointer py-3 font-medium">Nutrientes por ración de la propuesta</summary>
              <NutrientList nutrients={previewRecipeNutrients(recipe, foods, equivalents, proposedFoods)} />
            </details>
          </Card>
        ))}
        {payload.mealPlan?.days.map((day, dayIndex) => (
          <Card key={day.date} title={formatLongDate(day.date)}>
            <p className="text-sm text-stone-600">{day.dayType === 'training' ? 'Entrenamiento' : 'Descanso'}</p>
            {day.meals.map((meal, mealIndex) => (
              <div key={meal.mealSlot} className="space-y-2">
                <h3 className="font-medium">{MEAL_LABELS[meal.mealSlot]}</h3>
                {!meal.items.length && <p className="text-sm">Se dejará esta toma vacía.</p>}
                {meal.items.map((item, itemIndex) => {
                  const set = (change: Partial<typeof item>) => edit((doc) => {
                    Object.assign(doc.payload.mealPlan!.days[dayIndex].meals[mealIndex].items[itemIndex], change);
                  });
                  return (
                    <div key={itemIndex} className="space-y-2 rounded-lg border border-stone-200 p-3">
                      {item.itemType === 'food' ? (
                        <FoodSelect label="Alimento del menú" foods={foods} proposed={proposedFoods} value={item.refId}
                          onChange={(refId) => {
                            const next = foods.find((food) => food.id === refId) ?? proposedFoods.find((_, i) => newFoodRef(i) === refId);
                            set({ refId, unit: next?.baseUnit ?? 'g', equivalenceId: undefined });
                          }} />
                      ) : (
                        <Field label="Receta del menú">
                          <select className={inputClass} value={item.refId} onChange={(e) => set({ refId: e.target.value })} required>
                            <option value="">Selecciona una receta</option>
                            {!recipes.some((r) => r.id === item.refId) && !payload.recipes?.some((r) => r.tempId === item.refId) &&
                              <option value={item.refId}>Referencia desconocida · selecciona una receta</option>}
                            {recipes.filter((r) => !r.deletedAt).map((r) => <option key={r.id} value={r.id}>{r.name} · v{fmt(r.version)}</option>)}
                            {payload.recipes?.map((r) => <option key={r.tempId} value={r.tempId}>Propuesta · {r.name}</option>)}
                          </select>
                        </Field>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <NumericInput label="Cantidad del menú" value={item.quantity} onChange={(value) => set({ quantity: value ?? NaN })} />
                        <UnitSelect value={item.unit} recipe={item.itemType === 'recipe'} equivalenceId={item.equivalenceId}
                          measures={equivalents.filter((e) => e.foodId === item.refId && e.baseQuantity !== null)}
                          onChange={(unit, equivalenceId) => set({ unit, equivalenceId })} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </Card>
        ))}
        {!!review.conflicts.length && (
          <Card title="Tomas que se sustituirán">
            <ul className="text-sm">
              {review.conflicts.map((plan) => <li key={plan.id}>{formatLongDate(plan.date)} · {MEAL_LABELS[plan.mealSlot]} · {plan.items.map((item) => item.snapshot?.name ?? 'Elemento guardado').join(', ') || 'Vacía'}</li>)}
            </ul>
            <label className="flex min-h-12 items-center gap-2 text-sm">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Confirmo sustituir estas tomas por las de la propuesta
            </label>
          </Card>
        )}
        <Card title="Confirmación">
          <p className="text-sm">{fmt(payload.recipes?.length ?? 0)} recetas, {fmt(proposedFoods.length)} alimentos nuevos y {fmt(payload.mealPlan?.days.reduce((total, day) => total + day.meals.length, 0) ?? 0)} tomas.</p>
          <label className="flex min-h-12 items-center gap-2 text-sm">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
            He revisado la propuesta y quiero guardarla
          </label>
        </Card>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} disabled={busy || !approved || (!!review.conflicts.length && !replace)}>Confirmar importación</button>
        <button className={btnSecondary} type="button" disabled={busy} onClick={onCancel}>Descartar vista previa</button>
      </div>
    </form>
  );
}
