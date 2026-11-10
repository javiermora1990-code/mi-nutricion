import type { Nutrients } from '../db/types';
import { NUTRIENT_KEYS, NUTRIENT_LABELS } from '../lib/catalog';
import { fmt } from '../ui/kit';

export function NutrientList({ nutrients }: { nutrients: Nutrients }) {
  return (
    <dl className="divide-y divide-stone-100 text-sm">
      {NUTRIENT_KEYS.map((key) => (
        <div key={key} className="flex justify-between gap-2 py-1">
          <dt>{NUTRIENT_LABELS[key]}</dt>
          <dd className="font-medium tabular-nums">
            {nutrients[key] == null ? 'Sin dato' : `${fmt(nutrients[key], 2)} ${key === 'energyKcal' ? 'kcal' : 'g'}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}
