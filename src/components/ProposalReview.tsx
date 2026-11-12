import { ChevronDown, CircleCheck, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Food, FoodEquivalence, Recipe } from '../db/types';
import type { AiProposalDocument } from '../schemas/aiProposal';
import { newFoodRef, previewRecipeNutrients, proposalIssues, type ProposalReview as Review, type ProposedFood } from '../lib/aiImport';
import { FOOD_SOURCES, foodName, mapNutrients, NUTRIENT_KEYS, NUTRIENT_LABELS, STATE_LABELS } from '../lib/catalog';
import { formatLongDate } from '../lib/dates';
import { MEAL_LABELS } from '../lib/planning';
import { latestRecipes, quantityLabel } from '../lib/recipes';
import { btnPrimary, btnSecondary, Card, Field, fmt, inputClass, Notice, numberText, parseNumber, servingsText } from '../ui/kit';
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

/**
 * Fila plegable de la revisión: muestra un resumen de una línea y, al abrirla, la lectura del elemento.
 * Los campos editables solo se montan al pulsar «Editar» (o de entrada si hay algo que corregir).
 */
function ReviewItem({ title, detail, issues, notes = [], children, editor }: {
  title: string; detail: string; issues: string[]; notes?: string[]; children: ReactNode; editor: () => ReactNode;
}) {
  const [open, setOpen] = useState(issues.length > 0);
  const [editing, setEditing] = useState(issues.length > 0);
  return (
    <section className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left">
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-stone-900">{title}</span>
          <span className="block text-xs text-stone-600">{detail}</span>
        </span>
        {issues.length > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-800">
            <TriangleAlert size={14} aria-hidden /> {fmt(issues.length)}
            <span className="sr-only">{issues.length === 1 ? 'problema' : 'problemas'}</span>
          </span>
        ) : notes.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
            <TriangleAlert size={14} aria-hidden /> Aviso
          </span>
        )}
        <ChevronDown size={20} aria-hidden className={`shrink-0 text-stone-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-stone-100 px-4 py-3">
          {issues.length > 0 && <Notice tone="error"><ul className="list-disc space-y-1 pl-4">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></Notice>}
          {notes.length > 0 && <Notice tone="warn"><ul className="space-y-1">{notes.map((note, i) => <li key={i}>{note}</li>)}</ul></Notice>}
          {editing ? editor() : children}
          <button type="button" className={`${btnSecondary} self-start`} onClick={() => setEditing(!editing)}>
            {editing ? 'Ver resumen' : 'Editar'}
          </button>
        </div>
      )}
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-stone-600">{children}</h2>;
}

const dayMonth = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const shortDate = (date: string) => dayMonth.format(new Date(`${date}T12:00:00`));

export function ProposalReview({ review, foods, equivalents, recipes, busy, onChange, onConfirm, onCancel }: {
  review: Review; foods: Food[]; equivalents: FoodEquivalence[]; recipes: Recipe[]; busy: boolean;
  onChange: (document: AiProposalDocument) => void;
  onConfirm: (replace: boolean) => void; onCancel: () => void;
}) {
  const [approved, setApproved] = useState(false);
  const [replace, setReplace] = useState(false);
  const payload = review.document.payload;
  const proposedFoods = payload.catalogItems ?? [];
  const issues = proposalIssues(review.document, foods, recipes.filter((recipe) => !recipe.deletedAt));
  const foodWarnings = issues.foods.filter((list) => list.length).length;
  const mealCount = payload.mealPlan?.days.reduce((total, day) => total + day.meals.length, 0) ?? 0;

  function edit(change: (document: AiProposalDocument) => void) {
    const document = structuredClone(review.document);
    change(document);
    setApproved(false);
    setReplace(false);
    onChange(document);
  }
  function anyFoodName(id: string | null): string | undefined {
    const food = foods.find((food) => food.id === id) ?? proposedFoods.find((_, i) => newFoodRef(i) === id);
    return food && foodName(food);
  }
  function recipeName(ref: string): string {
    return payload.recipes?.find((recipe) => recipe.tempId === ref)?.name ?? recipes.find((recipe) => recipe.id === ref)?.name ?? 'Receta desconocida';
  }
  function amountText(quantity: number, unit: keyof typeof quantityLabel, equivalenceId?: string, recipe?: boolean): string {
    if (recipe && unit === 'portion') return servingsText(quantity);
    const measure = equivalenceId ? equivalents.find((e) => e.id === equivalenceId) : undefined;
    return `${fmt(quantity, 2)} ${measure ? measure.label : quantityLabel[unit]}`;
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (approved && !busy) onConfirm(replace); }}>
      <Card title="Resumen de la propuesta">
        <p className="text-sm">
          {fmt(payload.recipes?.length ?? 0)} recetas · {fmt(proposedFoods.length)} alimentos nuevos · {fmt(mealCount)} tomas
          {payload.mealPlan && <> del {shortDate(payload.mealPlan.startDate)} al {shortDate(payload.mealPlan.endDate)}</>}
        </p>
        {issues.total > 0
          ? <Notice tone="error">Hay {fmt(issues.total)} {issues.total === 1 ? 'cosa' : 'cosas'} por corregir. Las fichas afectadas están abiertas más abajo.</Notice>
          : <p className="flex items-center gap-2 text-sm text-emerald-800"><CircleCheck size={18} aria-hidden className="shrink-0" /> Todo encaja con tu catálogo. Toca cualquier fila para ver el detalle o editarla.</p>}
        {foodWarnings > 0 && <Notice tone="warn">{fmt(foodWarnings)} {foodWarnings === 1 ? 'alimento nuevo llega' : 'alimentos nuevos llegan'} sin nutrientes. Puedes completarlos ahora o más tarde en el catálogo; mientras tanto, las recetas que los usan saldrán con «Sin dato».</Notice>}
        <p className="text-xs text-stone-600">Las cantidades de ingredientes son para todas las raciones de cada receta.</p>
      </Card>
      <fieldset disabled={busy} className="flex flex-col gap-3">
        {proposedFoods.length > 0 && <SectionTitle>Alimentos nuevos</SectionTitle>}
        {proposedFoods.map((food, index) => (
          <ReviewItem key={index} title={foodName(food)} issues={[]} notes={issues.foods[index]}
            detail={`${FOOD_SOURCES[food.source]} · se guardará pendiente de verificar`}
            editor={() => (
              <>
                <Field label="Nombre">
                  <input className={inputClass} required value={food.name} onChange={(e) => edit((doc) => { doc.payload.catalogItems![index].name = e.target.value; })} />
                </Field>
                <p className="text-sm text-stone-600">Valores por 100 {food.baseUnit}. Deja vacío lo que no sepas.</p>
                <div className="grid grid-cols-2 gap-2">
                  {NUTRIENT_KEYS.map((key) => (
                    <NumericInput key={key} label={`${NUTRIENT_LABELS[key]} (${key === 'energyKcal' ? 'kcal' : 'g'})`}
                      value={food.nutrientsPer100[key] ?? null} optional
                      onChange={(value) => edit((doc) => { doc.payload.catalogItems![index].nutrientsPer100[key] = value; })} />
                  ))}
                </div>
              </>
            )}>
            <p className="text-sm text-stone-600">Por 100 {food.baseUnit}</p>
            <NutrientList nutrients={mapNutrients((key) => food.nutrientsPer100[key] ?? null)} />
          </ReviewItem>
        ))}

        {!!payload.recipes?.length && <SectionTitle>Recetas</SectionTitle>}
        {(payload.recipes ?? []).map((recipe, index) => {
          const nutrients = previewRecipeNutrients(recipe, foods, equivalents, proposedFoods);
          const target = recipe.existingRecipeId ? recipes.find((r) => r.id === recipe.existingRecipeId) : undefined;
          return (
            <ReviewItem key={recipe.tempId} title={recipe.name || 'Receta sin nombre'} issues={issues.recipes[index]}
              detail={[
                servingsText(recipe.servings),
                nutrients.energyKcal == null ? 'kcal sin dato' : `${fmt(nutrients.energyKcal)} kcal/ración`,
                target ? `nueva versión de ${target.name}` : 'receta nueva',
              ].join(' · ')}
              editor={() => (
                <>
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
                    const unresolved = !anyFoodName(ingredient.foodId) || (!!food?.defaultState && food.defaultState !== ingredient.state);
                    return (
                      <div key={ingredientIndex} className={`space-y-2 rounded-lg border p-3 ${unresolved ? 'border-red-300 bg-red-50' : 'border-stone-200'}`}>
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
                </>
              )}>
              <ul className="divide-y divide-stone-100 text-sm">
                {recipe.ingredients.map((ingredient, i) => (
                  <li key={i} className="flex justify-between gap-3 py-1">
                    <span>
                      {anyFoodName(ingredient.foodId) ?? <span className="text-red-700">{ingredient.proposedName} (sin identificar)</span>}
                      {ingredient.state === 'cooked' && <span className="text-stone-500"> · cocinado</span>}
                      {ingredient.isOptional && <span className="text-stone-500"> · opcional</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{amountText(ingredient.quantity, ingredient.unit, ingredient.equivalenceId)}</span>
                  </li>
                ))}
              </ul>
              {recipe.instructions.some((step) => step.trim()) && (
                <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700">
                  {recipe.instructions.filter((step) => step.trim()).map((step, i) => <li key={i}>{step}</li>)}
                </ol>
              )}
              <details className="text-sm">
                <summary className="min-h-12 cursor-pointer py-3 font-medium">Nutrientes por ración</summary>
                <NutrientList nutrients={nutrients} />
              </details>
            </ReviewItem>
          );
        })}

        {!!payload.mealPlan?.days.length && <SectionTitle>Menú</SectionTitle>}
        {payload.mealPlan?.days.map((day, dayIndex) => (
          <ReviewItem key={day.date} title={formatLongDate(day.date)} issues={issues.days[dayIndex]}
            detail={`${day.dayType === 'training' ? 'Entrenamiento' : 'Descanso'} · ${day.meals.length === 1 ? '1 toma' : `${fmt(day.meals.length)} tomas`}`}
            editor={() => day.meals.map((meal, mealIndex) => (
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
            ))}>
            <dl className="divide-y divide-stone-100 text-sm">
              {day.meals.map((meal) => (
                <div key={meal.mealSlot} className="py-1">
                  <dt className="text-xs font-medium text-stone-600">{MEAL_LABELS[meal.mealSlot]}</dt>
                  <dd>
                    {meal.items.length ? meal.items.map((item, i) => (
                      <span key={i} className="block">
                        {item.itemType === 'recipe' ? recipeName(item.refId) : anyFoodName(item.refId) ?? 'Alimento desconocido'}
                        <span className="text-stone-500"> · {amountText(item.quantity, item.unit, item.equivalenceId, item.itemType === 'recipe')}</span>
                      </span>
                    )) : <span className="text-stone-500">Vacía</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </ReviewItem>
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
          {issues.total > 0 && <p className="text-sm text-red-700">Corrige antes {issues.total === 1 ? 'el problema marcado' : `los ${fmt(issues.total)} problemas marcados`}.</p>}
          <label className="flex min-h-12 items-center gap-2 text-sm">
            <input type="checkbox" checked={approved} disabled={issues.total > 0} onChange={(e) => setApproved(e.target.checked)} />
            He revisado la propuesta y quiero guardarla
          </label>
        </Card>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} disabled={busy || !approved || issues.total > 0 || (!!review.conflicts.length && !replace)}>Confirmar importación</button>
        <button className={btnSecondary} type="button" disabled={busy} onClick={onCancel}>Descartar vista previa</button>
      </div>
    </form>
  );
}
