import { AlertTriangle, CircleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import type { ContextSummary, SummarySection } from '../lib/aiContextPreview';

const NOTE: Record<SummarySection['tone'], { icon: typeof X; className: string } | null> = {
  ok: null,
  warn: { icon: AlertTriangle, className: 'text-amber-700' },
  block: { icon: CircleAlert, className: 'text-red-700' },
};

function SectionTable({ section }: { section: SummarySection }) {
  if (!section.rows.length) return null;
  const keyValue = section.columns.length === 0;
  return (
    <table className="w-full table-fixed text-sm">
      {!keyValue && (
        <thead>
          <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
            {section.columns.map((column, index) => (
              <th key={index} scope="col" className={`py-1.5 font-medium ${index ? 'text-right' : ''} ${index === 0 ? 'w-[40%]' : ''}`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody className="divide-y divide-stone-100">
        {section.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              c === 0 && keyValue
                ? <th key={c} scope="row" className="w-[38%] py-2 pr-3 text-left align-top font-normal text-stone-500">{cell}</th>
                : <td key={c} className={`py-2 align-top text-stone-900 ${!keyValue && c ? 'text-right tabular-nums' : 'break-words'} ${cell === 'Sin dato' ? 'text-stone-400' : ''}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ section }: { section: SummarySection }) {
  const note = NOTE[section.tone];
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4">
      <h3 className="flex items-baseline justify-between gap-3">
        <span className="font-semibold text-stone-900">{section.title}</span>
        {section.subtitle && <span className="text-sm text-stone-500">{section.subtitle}</span>}
      </h3>
      {section.note && (
        <p className={`flex items-start gap-1.5 text-sm ${note?.className ?? 'text-stone-600'}`}>
          {note && <note.icon size={16} className="mt-0.5 shrink-0" aria-hidden />}
          {section.note}
        </p>
      )}
      <SectionTable section={section} />
      {section.footer.map((line, index) => <p key={index} className="text-xs text-stone-500">{line}</p>)}
    </section>
  );
}

/** Hoja a pantalla completa con el resumen del contexto, una tabla por bloque. */
export function ContextSummarySheet({ summary, onClose }: { summary: ContextSummary; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="context-summary-title" className="fixed inset-0 z-20 overflow-y-auto bg-stone-50">
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-4 pb-12">
        <header className="flex items-center justify-between">
          <h2 id="context-summary-title" className="text-xl font-semibold text-emerald-900">Resumen del contexto</h2>
          <button className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100" onClick={onClose} aria-label="Cerrar">
            <X size={22} />
          </button>
        </header>
        {summary.sections.map((section) => <Section key={section.key} section={section} />)}
      </div>
    </div>
  );
}
