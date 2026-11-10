import type { DayTargets } from '../db/types';
import { fmt } from '../ui/kit';

const ROWS: { key: keyof DayTargets; label: string; unit: string }[] = [
  { key: 'energyKcal', label: 'Energía', unit: 'kcal' },
  { key: 'proteinG', label: 'Proteínas', unit: 'g' },
  { key: 'fatG', label: 'Grasas', unit: 'g' },
  { key: 'carbsG', label: 'Carbohidratos', unit: 'g' },
  { key: 'fiberG', label: 'Fibra', unit: 'g' },
];

/** Metas con cifra central e intervalo aceptable. */
export function TargetsTable({ targets }: { targets: DayTargets }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-stone-500">
          <th className="py-1 font-medium">Nutriente</th>
          <th className="py-1 text-right font-medium">Meta</th>
          <th className="py-1 text-right font-medium">Intervalo</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((r) => {
          const t = targets[r.key];
          return (
            <tr key={r.key} className="border-t border-stone-100">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">
                {fmt(t.central)} {r.unit}
              </td>
              <td className="py-1.5 text-right tabular-nums text-stone-600">
                {fmt(t.minTolerance)} – {fmt(t.maxTolerance)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const OBJECTIVE_LABEL = {
  maintain: 'Mantener',
  fat_loss: 'Perder grasa',
  muscle_gain: 'Ganar masa muscular',
} as const;
