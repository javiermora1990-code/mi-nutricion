import { AlertTriangle, Check, CircleAlert } from 'lucide-react';
import type { ContextPreviewRow, PreviewTone } from '../lib/aiContextPreview';

const TONE: Record<PreviewTone, { icon: typeof Check; className: string; label: string }> = {
  ok: { icon: Check, className: 'text-emerald-700', label: 'Listo' },
  warn: { icon: AlertTriangle, className: 'text-amber-600', label: 'Conviene revisarlo' },
  block: { icon: CircleAlert, className: 'text-red-700', label: 'Impide exportar' },
};
const NOTE_CLASS: Record<PreviewTone, string> = { ok: 'text-amber-700', warn: 'text-amber-700', block: 'text-red-700' };

function RowContent({ row }: { row: ContextPreviewRow }) {
  const { icon: Icon, className, label } = TONE[row.tone];
  return (
    <>
      <span className="pt-0.5 text-stone-600">{row.label}</span>
      <span className="min-w-0">
        {row.summary}
        {row.note && <span className={`block text-xs ${NOTE_CLASS[row.tone]}`}>{row.note}</span>}
      </span>
      <Icon size={16} className={`mt-0.5 ${className}`} aria-label={label} />
    </>
  );
}

const rowGrid = 'grid grid-cols-[6.5rem_minmax(0,1fr)_1rem] gap-2 py-2.5';

/** Resumen de los datos que se envían a la IA: un bloque por fila, con el detalle desplegable. */
export function ContextPreviewTable({ rows }: { rows: ContextPreviewRow[] }) {
  return (
    <div className="divide-y divide-stone-100 text-sm">
      {rows.map((row) => {
        if (!row.details.length) return <div key={row.key} className={rowGrid}><RowContent row={row} /></div>;
        return (
          <details key={row.key} className="group">
            <summary className={`${rowGrid} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              <RowContent row={row} />
            </summary>
            <ul className="flex flex-col gap-1 pb-3 pl-[7rem] text-xs text-stone-700">
              {row.details.map((detail, index) => <li key={index}>{detail}</li>)}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
