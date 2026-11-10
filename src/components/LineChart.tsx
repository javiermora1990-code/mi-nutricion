import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { IsoDate } from '../db/types';
import { noonEpochSeconds } from '../lib/dates';

export interface ChartSeries {
  label: string;
  color: string;
  /** Un valor por fecha; `null` = día sin dato (se deja hueco, no se interpola). */
  values: (number | null)[];
}

const axisDate = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const axisNumber = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/**
 * Gráfica de líneas sobre uPlot. Los días sin dato se pasan como `null` y, con
 * `spanGaps: false`, la línea se corta: nunca se dibuja un valor que no existe.
 * Cada dato real lleva su punto para que un día aislado también se vea.
 */
export function LineChart({
  dates,
  series,
  yRange,
  height = 190,
}: {
  dates: IsoDate[];
  series: ChartSeries[];
  /** Escala fija (p. ej. [1, 5]); si se omite, se ajusta a los datos. */
  yRange?: [number, number];
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasData = series.some((s) => s.values.some((v) => v !== null));

  useEffect(() => {
    const el = ref.current;
    if (!el || !hasData) return;
    const options: uPlot.Options = {
      width: el.clientWidth || 320,
      height,
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, y: false },
      scales: {
        x: { time: true },
        y: yRange ? { range: yRange } : { range: (_u, min, max) => padRange(min, max) },
      },
      axes: [
        {
          stroke: '#57534e',
          grid: { stroke: '#e7e5e4', width: 1 },
          ticks: { stroke: '#e7e5e4', width: 1 },
          values: (_u, splits) => splits.map((s) => axisDate.format(new Date(s * 1000))),
          space: 64,
        },
        {
          stroke: '#57534e',
          grid: { stroke: '#e7e5e4', width: 1 },
          ticks: { stroke: '#e7e5e4', width: 1 },
          values: (_u, splits) => splits.map((s) => axisNumber.format(s)),
          size: 44,
        },
      ],
      series: [
        {},
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 2,
          spanGaps: false,
          points: { show: true, size: 6, fill: s.color, stroke: s.color },
        })),
      ],
    };
    const data: uPlot.AlignedData = [dates.map(noonEpochSeconds), ...series.map((s) => s.values)];
    const plot = new uPlot(options, data, el);
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) plot.setSize({ width: el.clientWidth, height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [dates, series, yRange, height, hasData]);

  if (!hasData) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-stone-300 text-sm text-stone-500"
        style={{ height }}
      >
        Sin datos en este periodo
      </div>
    );
  }

  return (
    <div>
      <div ref={ref} className="w-full" />
      {series.length > 1 && (
        <ul className="mt-1 flex flex-wrap gap-4 text-xs text-stone-600">
          {series.map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function padRange(min: number | null, max: number | null): [number, number] {
  if (min === null || max === null) return [0, 1];
  const pad = Math.max((max - min) * 0.15, 0.5);
  return [min - pad, max + pad];
}
