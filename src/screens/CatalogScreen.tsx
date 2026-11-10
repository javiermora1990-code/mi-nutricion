import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, type FormEvent } from 'react';
import { FoodEditor } from '../components/FoodEditor';
import { NutrientList } from '../components/NutrientList';
import { db } from '../db/db';
import {
  FOOD_CATEGORIES, FOOD_SOURCES, STATE_LABELS, foodName, saveFood, searchFoods, seedCatalog, type FoodDetails,
} from '../lib/catalog';
import { searchOpenFoodFacts, type OffSearchMode } from '../lib/openFoodFacts';
import { btnPrimary, btnSecondary, Card, Field, fmt, inputClass, Notice, Screen } from '../ui/kit';

const offLink = 'https://world.openfoodfacts.org';
const licenseLink = 'https://opendatacommons.org/licenses/odbl/1-0/';
const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });

export function CatalogAttribution() {
  return (
    <div className="text-sm text-stone-600">
      <p>Datos base procedentes de <a className="underline" href="https://fdc.nal.usda.gov/">USDA FoodData Central</a>, dominio público (CC0).</p>
      <p>Datos de productos comerciales procedentes de <a className="underline" href={offLink}>Open Food Facts</a> bajo licencia <a className="underline" href={licenseLink}>ODbL</a>.</p>
    </div>
  );
}

function FoodCard({ food }: { food: FoodDetails }) {
  const sourceUrl = food.source === 'usda'
    ? `https://fdc.nal.usda.gov/food-details/${encodeURIComponent(food.externalId ?? '')}/nutrients`
    : `${offLink}/product/${encodeURIComponent(food.externalId ?? '')}`;
  return (
    <>
      <Card title={foodName(food)}>
        <p className="text-sm text-stone-600">{[food.category, food.defaultState && STATE_LABELS[food.defaultState]].filter(Boolean).join(' · ')}</p>
        <p className="text-sm">
          {food.externalId && (food.source === 'usda' || food.source === 'off')
            ? <a className="underline" href={sourceUrl}>{FOOD_SOURCES[food.source]} · {food.externalId}</a>
            : [FOOD_SOURCES[food.source], food.externalId].filter(Boolean).join(' · ')}
        </p>
        {food.sourceVersion && <p className="text-sm text-stone-600">Versión de origen {food.sourceVersion}</p>}
        {food.sourceFetchedAt && <p className="text-sm text-stone-600">Consulta del {dateFormat.format(new Date(food.sourceFetchedAt))}</p>}
        {food.verificationStatus === 'pending_review' && (
          <Notice tone="warn">{food.source === 'off'
            ? 'Pendiente de verificar. Comprueba los valores y si la etiqueta indica 100 g o 100 ml.'
            : 'Pendiente de verificar.'}</Notice>
        )}
      </Card>
      <Card title={`Nutrientes por 100 ${food.baseUnit}`}><NutrientList nutrients={food.nutrientsPer100} /></Card>
    </>
  );
}

function OffSearch({ onSaved, onBack }: { onSaved: (id: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<OffSearchMode>('brand');
  const [results, setResults] = useState<FoodDetails[]>();
  const [selected, setSelected] = useState<FoodDetails>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function search(event: FormEvent) {
    event.preventDefault();
    if (busy || !query.trim()) return;
    setBusy(true);
    setResults(undefined);
    setError('');
    try {
      setResults(await searchOpenFoodFacts(query, mode));
    } catch (cause) {
      setError(cause instanceof TypeError || cause instanceof DOMException
        ? mode === 'name'
          ? 'La búsqueda por nombre no está disponible dentro de la app. Puedes usar el buscador oficial y traer el código de barras.'
          : 'No se pudo conectar con Open Food Facts. Comprueba la conexión y vuelve a intentarlo.'
        : cause instanceof Error ? cause.message : 'No se pudo realizar la búsqueda.');
    } finally {
      setBusy(false);
    }
  }

  async function save(food: FoodDetails) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onSaved((await saveFood(db, food)).id);
    } catch {
      setError('No se pudo guardar el producto en este dispositivo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Open Food Facts" subtitle="Busca productos en línea y guárdalos en tu catálogo">
      <button className={`${btnSecondary} self-start`} disabled={busy} onClick={() => {
        if (!selected) onBack();
        else { setSelected(undefined); setError(''); }
      }}>{selected ? 'Volver a los resultados' : 'Volver al catálogo'}</button>
      {selected ? (
        <>
          <FoodCard food={selected} />
          <button className={btnPrimary} disabled={busy} onClick={() => void save(selected)}>
            Guardar como pendiente de verificar
          </button>
        </>
      ) : (
        <>
          <form className="flex flex-col gap-2" onSubmit={search}>
            <Field label="Buscar por">
              <select className={inputClass} value={mode} disabled={busy} onChange={(e) => {
                setMode(e.target.value as OffSearchMode);
                setQuery('');
                setResults(undefined);
                setError('');
              }}>
                <option value="brand">Marca (España)</option>
                <option value="name">Nombre</option>
                <option value="barcode">Código de barras</option>
              </select>
            </Field>
            <Field label={mode === 'brand' ? 'Marca' : mode === 'name' ? 'Nombre' : 'Código de barras'}>
              <input type="search" className={inputClass} inputMode={mode === 'barcode' ? 'numeric' : 'search'}
                value={query} required onChange={(e) => setQuery(e.target.value)} />
            </Field>
            <button className={btnPrimary} disabled={busy || !query.trim()}>{busy ? 'Buscando…' : 'Buscar en línea'}</button>
          </form>
          {mode !== 'barcode' && (
            <Card title="Buscador oficial">
              <p className="text-sm text-stone-600">Si la consulta no funciona aquí, busca en Open Food Facts, copia el código de barras de la ficha y pégalo en la búsqueda por código.</p>
              <a className={`${btnSecondary} self-start`} href="https://search.openfoodfacts.org/static/off.html"
                target="_blank" rel="noreferrer">Abrir el buscador de Open Food Facts</a>
            </Card>
          )}
          {results && (results.length ? (
            <Card title="Resultados">
              <ul className="divide-y divide-stone-100">
                {results.map((food) => (
                  <li key={food.externalId}>
                    <button className="min-h-12 w-full py-2 text-left" onClick={() => setSelected(food)}>
                      {foodName(food)} <span className="block text-xs text-stone-500">{food.externalId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : <Notice tone="info">No se encontraron productos para esa búsqueda.</Notice>)}
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <CatalogAttribution />
    </Screen>
  );
}

export function CatalogScreen() {
  const foods = useLiveQuery(() => db.foods.toArray());
  const [selectedId, setSelectedId] = useState<string>();
  const measures = useLiveQuery(async () => ({
    id: selectedId,
    rows: selectedId ? await db.foodEquivalences.where('foodId').equals(selectedId).and((e) => !e.deletedAt).toArray() : [],
  }), [selectedId]);
  const equivalents = measures?.id === selectedId ? measures?.rows : undefined;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [editor, setEditor] = useState<'new' | 'edit'>();
  const [off, setOff] = useState(false);
  const [limit, setLimit] = useState(30);
  const [seedError, setSeedError] = useState(false);
  const selected = foods?.find((food) => food.id === selectedId && !food.deletedAt);

  async function loadSeed() {
    setSeedError(false);
    try {
      await seedCatalog(db);
    } catch {
      setSeedError(true);
    }
  }
  useEffect(() => { void loadSeed(); }, []);

  if (off) return <OffSearch onBack={() => setOff(false)} onSaved={(id) => { setSelectedId(id); setOff(false); }} />;
  if (editor === 'new' || (editor === 'edit' && selected && equivalents)) {
    return (
      <Screen title={editor === 'new' ? 'Nuevo alimento' : 'Editar alimento'}>
        <FoodEditor key={selected?.id ?? 'new'} food={editor === 'edit' ? selected : undefined}
          equivalents={editor === 'edit' ? equivalents ?? [] : []}
          onCancel={() => setEditor(undefined)}
          onSaved={(food) => { setSelectedId(food.id); setEditor(undefined); }} />
      </Screen>
    );
  }
  if (selected) {
    return (
      <Screen title="Alimento">
        <div className="flex flex-wrap gap-2">
          <button className={btnSecondary} onClick={() => setSelectedId(undefined)}>Volver al catálogo</button>
          <button className={btnPrimary} disabled={!equivalents} onClick={() => setEditor('edit')}>Editar alimento</button>
        </div>
        <FoodCard food={selected} />
        {!!equivalents?.length && (
          <Card title="Equivalencias">
            <ul className="space-y-2 text-sm">
              {equivalents.map((e) => (
                <li key={e.id}>
                  <p>{e.label} · {e.baseQuantity !== null ? `${fmt(e.baseQuantity, 2)} ${selected.baseUnit}` : `×${fmt(e.rawToCookedYieldFactor, 2)} (cocinado/crudo)`}</p>
                  <p className="text-xs text-stone-600">{e.precision === 'approximate' ? 'Aproximada' : 'Exacta'} · v{e.version} · {e.source}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Screen>
    );
  }

  const results = searchFoods(foods ?? [], query, category);
  return (
    <Screen title="Catálogo" subtitle="Alimentos disponibles en este dispositivo">
      <div className="flex flex-wrap gap-2">
        <button className={btnPrimary} onClick={() => setEditor('new')}>Nuevo alimento</button>
        <button className={btnSecondary} onClick={() => setOff(true)}>Buscar en Open Food Facts</button>
      </div>
      {seedError && <Notice tone="error">No se pudo cargar el catálogo inicial. <button className="underline" onClick={() => void loadSeed()}>Reintentar</button></Notice>}
      <Field label="Buscar en el catálogo">
        <input type="search" className={inputClass} value={query} placeholder="Nombre, marca o identificador"
          onChange={(e) => { setQuery(e.target.value); setLimit(30); }} />
      </Field>
      <Field label="Categoría">
        <select className={inputClass} value={category} onChange={(e) => { setCategory(e.target.value); setLimit(30); }}>
          <option value="">Todas</option>
          {FOOD_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
      </Field>
      <Card title={foods ? `${fmt(results.length)} alimentos` : 'Cargando catálogo…'}>
        {foods && !results.length && <p className="text-sm text-stone-600">No hay coincidencias.</p>}
        <ul className="divide-y divide-stone-100">
          {results.slice(0, limit).map((food) => (
            <li key={food.id}>
              <button className="min-h-12 w-full py-2 text-left" onClick={() => setSelectedId(food.id)}>
                {foodName(food)}
                <span className="block text-xs text-stone-600">
                  {FOOD_SOURCES[food.source]}{food.verificationStatus === 'pending_review' && ' · Pendiente de verificar'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {results.length > limit && <button className={btnSecondary} onClick={() => setLimit((n) => n + 30)}>Ver más alimentos</button>}
      </Card>
    </Screen>
  );
}
