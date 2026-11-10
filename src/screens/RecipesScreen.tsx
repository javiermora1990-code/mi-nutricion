import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { NutrientList } from '../components/NutrientList';
import { RecipeEditor } from '../components/RecipeEditor';
import { db } from '../db/db';
import type { Food, Recipe, RecipeIngredient } from '../db/types';
import { foodName, seedCatalog } from '../lib/catalog';
import { latestRecipes, nutrientsPerServing, quantityLabel, recipeRoot, recipeVersions, scaleNutrients } from '../lib/recipes';
import { btnPrimary, btnSecondary, Card, Field, fmt, inputClass, Notice, numberText, parseNumber, Screen } from '../ui/kit';

function RecipeDetails({ recipe, ingredients, foods }: { recipe: Recipe; ingredients: RecipeIngredient[]; foods: Food[] }) {
  const [servingsText, setServingsText] = useState(numberText(recipe.servings));
  const servings = parseNumber(servingsText);
  const factor = servings !== null && servings > 0 ? servings / recipe.servings : null;
  const perServing = nutrientsPerServing(recipe, ingredients);
  return (
    <>
      <Card title={recipe.name}>
        <p className="text-sm text-stone-600">Versión {fmt(recipe.version)} · {fmt(recipe.servings, 2)} raciones guardadas</p>
        {recipe.prepTimeMin !== null && <p className="text-sm text-stone-600">Preparación de {fmt(recipe.prepTimeMin, 2)} min en la receta original</p>}
        <Field label="Raciones a preparar">
          <input className={inputClass} inputMode="decimal" value={servingsText} onChange={(e) => setServingsText(e.target.value)} />
        </Field>
        {factor === null && <p className="text-sm text-red-700">Indica un número de raciones mayor que cero.</p>}
        {recipe.totalCookedWeightG !== null && factor !== null && (
          <p className="text-sm">Peso cocinado estimado de {fmt(recipe.totalCookedWeightG * factor, 2)} g</p>
        )}
      </Card>
      <Card title="Ingredientes">
        <ul className="divide-y divide-stone-100 text-sm">
          {ingredients.map((ingredient) => {
            const food = foods.find((item) => item.id === ingredient.foodId);
            return (
              <li key={ingredient.id} className="py-2">
                <span className="font-medium">{ingredient.snapshot?.name ?? (food ? foodName(food) : 'Alimento no disponible')}</span>
                {factor !== null && <span className="block">{fmt(ingredient.quantity * factor, 2)} {ingredient.snapshot?.unitLabel ?? quantityLabel[ingredient.unit]}</span>}
                {ingredient.snapshot?.pendingReview && <span className="block text-xs text-amber-900">Datos pendientes de verificar</span>}
              </li>
            );
          })}
        </ul>
      </Card>
      {recipe.instructions.length > 0 && (
        <Card title="Preparación"><ol className="list-decimal space-y-2 pl-5 text-sm">
          {recipe.instructions.map((step, i) => <li key={i}>{step}</li>)}
        </ol></Card>
      )}
      <Card title="Nutrientes por ración"><NutrientList nutrients={perServing} /></Card>
      {factor !== null && servings !== null && servings !== 1 && (
        <Card title={`Total para ${fmt(servings, 2)} raciones`}><NutrientList nutrients={scaleNutrients(perServing, servings)} /></Card>
      )}
    </>
  );
}

export function RecipesScreen() {
  const recipes = useLiveQuery(() => db.recipes.toArray());
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<'new' | 'edit'>();
  const [seedError, setSeedError] = useState(false);
  const foods = useLiveQuery(() => db.foods.filter((food) => !food.deletedAt).toArray());
  const equivalents = useLiveQuery(() => db.foodEquivalences.filter((e) => !e.deletedAt).toArray());
  const ingredientQuery = useLiveQuery(async () => ({
    id: selectedId,
    rows: selectedId ? await db.recipeIngredients.where('recipeId').equals(selectedId)
      .and((item) => !item.deletedAt).sortBy('sortOrder') : [],
  }), [selectedId]);
  const ingredients = ingredientQuery?.id === selectedId ? ingredientQuery?.rows : undefined;
  const selected = recipes?.find((recipe) => recipe.id === selectedId && !recipe.deletedAt);
  const versions = selected ? recipeVersions(recipes ?? [], recipeRoot(selected)) : [];

  async function loadSeed() {
    setSeedError(false);
    try {
      await seedCatalog(db);
    } catch {
      setSeedError(true);
    }
  }
  useEffect(() => { void loadSeed(); }, []);

  if (foods && equivalents && (editor === 'new' || (editor === 'edit' && selected && ingredients))) {
    return (
      <Screen title={editor === 'new' ? 'Nueva receta' : 'Editar receta'}>
        {seedError && <Notice tone="error">No se pudo cargar el catálogo inicial. <button className="underline" onClick={() => void loadSeed()}>Reintentar</button></Notice>}
        <RecipeEditor key={selectedId ?? 'new'} recipe={editor === 'edit' ? selected : undefined}
          ingredients={editor === 'edit' ? ingredients ?? [] : []} foods={foods} equivalents={equivalents}
          onSaved={(recipe) => { setSelectedId(recipe.id); setEditor(undefined); }}
          onCancel={() => setEditor(undefined)} />
      </Screen>
    );
  }
  if (selected) {
    return (
      <Screen title="Receta">
        <div className="flex flex-wrap gap-2">
          <button className={btnSecondary} onClick={() => setSelectedId(undefined)}>Volver a recetas</button>
          {versions[0]?.id === selected.id && (
            <button className={btnPrimary} disabled={!ingredients} onClick={() => setEditor('edit')}>Editar receta</button>
          )}
        </div>
        {versions.length > 1 && (
          <Field label="Historial de versiones">
            <select className={inputClass} value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>
              {versions.map((recipe, i) => (
                <option key={recipe.id} value={recipe.id}>Versión {fmt(recipe.version)}{i === 0 ? ' (actual)' : ''}</option>
              ))}
            </select>
          </Field>
        )}
        {ingredients && <RecipeDetails key={selected.id} recipe={selected} ingredients={ingredients} foods={foods ?? []} />}
      </Screen>
    );
  }

  const latest = latestRecipes(recipes ?? []);
  return (
    <Screen title="Recetas" subtitle="Guarda tus recetas y calcula las cantidades para las raciones que necesites">
      <button className={`${btnPrimary} self-start`} disabled={!foods || !equivalents} onClick={() => setEditor('new')}>Nueva receta</button>
      <Card>
        {recipes && !latest.length && <p className="text-sm text-stone-600">Todavía no has guardado ninguna receta.</p>}
        {!recipes && <p className="text-sm text-stone-600">Cargando recetas…</p>}
        <ul className="divide-y divide-stone-100">
          {latest.map((recipe) => (
            <li key={recipe.id}>
              <button className="min-h-12 w-full py-2 text-left" onClick={() => setSelectedId(recipe.id)}>
                {recipe.name}
                <span className="block text-xs text-stone-600">Versión {fmt(recipe.version)} · {fmt(recipe.servings, 2)} raciones</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  );
}
