import type { ReactNode } from 'react';

const btnBase =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50';
export const btnPrimary = `${btnBase} bg-emerald-700 text-white hover:bg-emerald-800`;
export const btnSecondary = `${btnBase} border border-stone-300 bg-white text-stone-800 hover:bg-stone-100`;
export const btnDanger = `${btnBase} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
export const inputClass =
  'min-h-12 w-full rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 focus:border-emerald-600 focus:outline-none';

export function Screen({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4 pb-28">
      <header>
        <h1 className="text-2xl font-semibold text-emerald-900">{title}</h1>
        {subtitle && <p className="text-sm text-stone-600">{subtitle}</p>}
      </header>
      {children}
    </div>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      {title && <h2 className="text-base font-semibold text-stone-900">{title}</h2>}
      {children}
    </section>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'error' | 'info'; children: ReactNode }) {
  const tones = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    info: 'border-stone-200 bg-stone-50 text-stone-700',
  };
  return (
    <div role="status" className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-stone-800">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-stone-500">{hint}</span>}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </label>
  );
}

/** Grupo de opciones excluyentes con botones grandes. `null` = sin elegir. */
export function Choice<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  allowClear,
  error,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T | null) => void;
  /** Tocar la opción elegida la deja de nuevo sin dato. */
  allowClear?: boolean;
  error?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className="mb-1 font-medium text-stone-800">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected && allowClear ? null : o.value)}
              className={`min-h-12 min-w-12 flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                selected
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-stone-300 bg-white text-stone-800'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </fieldset>
  );
}

/** Convierte el texto de un campo numérico: vacío → null (sin dato), nunca 0. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export const numberText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

/** «1 ración», «1,5 raciones», «2 raciones». */
export const servingsText = (n: number | null | undefined) => `${fmt(n, 2)} ${n === 1 ? 'ración' : 'raciones'}`;

/** Formatea un número o muestra «Sin dato» si es null. */
export function fmt(n: number | null | undefined, decimals: 0 | 1 | 2 = 0): string {
  if (n === null || n === undefined) return 'Sin dato';
  return (decimals === 0 ? nf0 : decimals === 1 ? nf1 : nf2).format(n);
}
