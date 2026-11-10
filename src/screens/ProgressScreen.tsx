import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { LineChart, type ChartSeries } from '../components/LineChart';
import { db } from '../db/db';
import { formatLongDate, formatShortDate, localIsoDate, startOfWeek } from '../lib/dates';
import {
  EMPTY_PROGRESS,
  WINDOWS,
  getLogInWeek,
  getProgressLog,
  loadSeries,
  progressInputSchema,
  saveProgressLog,
  summarize,
  type ProgressInput,
  type WindowDays,
} from '../lib/progress';
import { Card, Choice, Field, Notice, Screen, btnPrimary, fmt, inputClass, numberText, parseNumber } from '../ui/kit';

const SCALE = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));

export function ProgressScreen() {
  return (
    <Screen title="Progreso" subtitle="Un registro por semana basta. Todo es opcional: rellena solo lo que sepas.">
      <DayForm />
      <Charts />
    </Screen>
  );
}

// ───────────── Registro del día ─────────────

function DayForm() {
  const today = localIsoDate();
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState('');
  const [sleep, setSleep] = useState('');
  const [values, setValues] = useState<ProgressInput>(EMPTY_PROGRESS);
  const [notes, setNotes] = useState('');
  const [exists, setExists] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Si ya hay un registro de esta semana, se abre ese para corregirlo en lugar de crear otro.
  useEffect(() => {
    getLogInWeek(db, today).then((log) => log && setDate(log.date));
  }, [today]);

  useEffect(() => {
    let cancelled = false;
    getProgressLog(db, date).then((log) => {
      if (cancelled) return;
      setExists(!!log);
      setWeight(numberText(log?.weightKg));
      setSleep(numberText(log?.sleepHours));
      setNotes(log?.notes ?? '');
      setValues(
        log
          ? {
              ...EMPTY_PROGRESS,
              sleepQuality1to5: log.sleepQuality1to5,
              energyLevel1to5: log.energyLevel1to5,
              hungerLevel1to5: log.hungerLevel1to5,
              trained: log.trained,
            }
          : EMPTY_PROGRESS,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const set = <K extends keyof ProgressInput>(key: K, value: ProgressInput[K]) => {
    setMessage(null);
    setValues((v) => ({ ...v, [key]: value }));
  };

  async function save() {
    const weightKg = parseNumber(weight);
    const sleepHours = parseNumber(sleep);
    if (weight.trim() !== '' && weightKg === null) return setMessage({ ok: false, text: 'El peso no es un número válido.' });
    if (sleep.trim() !== '' && sleepHours === null) return setMessage({ ok: false, text: 'Las horas de sueño no son un número válido.' });
    const input: ProgressInput = { ...values, weightKg, sleepHours, notes: notes.trim() || null };
    const parsed = progressInputSchema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      return setMessage({
        ok: false,
        text:
          field === 'weightKg'
            ? 'El peso debe estar entre 30 y 300 kg.'
            : field === 'sleepHours'
              ? 'Las horas de sueño deben estar entre 0 y 24.'
              : 'Hay un valor no válido.',
      });
    }
    const hasAnything = Object.values(parsed.data).some((v) => v !== null);
    if (!hasAnything && !exists) return setMessage({ ok: false, text: 'No hay ningún dato que guardar.' });
    await saveProgressLog(db, date, parsed.data);
    setExists(true);
    setMessage({ ok: true, text: 'Registro guardado.' });
  }

  return (
    <Card
      title={
        startOfWeek(date) === startOfWeek(today)
          ? 'Registro de esta semana'
          : `Registro de la semana del ${formatShortDate(startOfWeek(date))}`
      }
    >
      <Field label="Fecha del registro" hint={formatLongDate(date)}>
        <input
          type="date"
          className={inputClass}
          value={date}
          max={today}
          onChange={(e) => {
            if (e.target.value && e.target.value <= today) {
              setMessage(null);
              setDate(e.target.value);
            }
          }}
        />
      </Field>
      {exists && <Notice tone="info">Ya hay un registro con esta fecha: al guardar se actualiza.</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Peso (kg)">
          <input inputMode="decimal" className={inputClass} value={weight} placeholder="Sin dato" onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="Sueño medio (h/noche)">
          <input inputMode="decimal" className={inputClass} value={sleep} placeholder="Sin dato" onChange={(e) => setSleep(e.target.value)} />
        </Field>
      </div>
      <Choice label="Calidad del sueño esta semana (1 mala – 5 muy buena)" value={values.sleepQuality1to5} options={SCALE} allowClear onChange={(v) => set('sleepQuality1to5', v)} />
      <Choice label="Energía esta semana (1 muy baja – 5 muy alta)" value={values.energyLevel1to5} options={SCALE} allowClear onChange={(v) => set('energyLevel1to5', v)} />
      <Choice label="Hambre esta semana (1 nada – 5 mucha)" value={values.hungerLevel1to5} options={SCALE} allowClear onChange={(v) => set('hungerLevel1to5', v)} />
      <Field label="Notas (opcional)">
        <textarea className={`${inputClass} py-2`} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <p className="text-xs text-stone-500">Lo que dejes vacío se guarda como «sin dato», no como cero. Toca de nuevo una opción para quitarla.</p>
      <button className={btnPrimary} onClick={save}>
        Guardar registro
      </button>
      {message && <Notice tone={message.ok ? 'ok' : 'error'}>{message.text}</Notice>}
    </Card>
  );
}

// ───────────── Gráficas ─────────────

const GREEN = '#047857';
const BLUE = '#1d4ed8';
const ORANGE = '#c2410c';
const SCALE_RANGE: [number, number] = [0.5, 5.5];

function Charts() {
  const [days, setDays] = useState<WindowDays>(90);
  const today = localIsoDate();
  const series = useLiveQuery(() => loadSeries(db, today, days), [today, days]);

  const charts = useMemo(() => {
    if (!series) return null;
    const v = series.values;
    return {
      weight: [{ label: 'Peso', color: GREEN, values: v.weightKg }] satisfies ChartSeries[],
      sleep: [{ label: 'Sueño', color: BLUE, values: v.sleepHours }] satisfies ChartSeries[],
      feel: [
        { label: 'Energía', color: GREEN, values: v.energyLevel1to5 },
        { label: 'Hambre', color: ORANGE, values: v.hungerLevel1to5 },
      ] satisfies ChartSeries[],
      summary: {
        weight: summarize(v.weightKg),
        sleep: summarize(v.sleepHours),
        quality: summarize(v.sleepQuality1to5),
        energy: summarize(v.energyLevel1to5),
        hunger: summarize(v.hungerLevel1to5),
      },
    };
  }, [series]);

  return (
    <>
      <Card title="Evolución">
        <Choice
          label="Periodo"
          value={days}
          onChange={(v) => v && setDays(v)}
          options={WINDOWS.map((w) => ({ value: w, label: `${w} días` }))}
        />
        <p className="text-xs text-stone-500">
          Solo se dibujan los registros reales: entre uno y otro no se inventan valores, y las medias cuentan solo los registros que tienen dato.
        </p>
      </Card>
      {series && charts && (
        <>
          <Card title="Peso (kg)">
            <LineChart dates={series.dates} series={charts.weight} />
            <Summary days={days} unit="kg" decimals={1} s={charts.summary.weight} showChange />
          </Card>
          <Card title="Sueño (horas por noche)">
            <LineChart dates={series.dates} series={charts.sleep} />
            <Summary days={days} unit="h" decimals={1} s={charts.summary.sleep} />
            <Summary days={days} label="Calidad media" unit="de 5" decimals={1} s={charts.summary.quality} />
          </Card>
          <Card title="Energía y hambre (1–5)">
            <LineChart dates={series.dates} series={charts.feel} yRange={SCALE_RANGE} />
            <Summary days={days} label="Energía media" unit="de 5" decimals={1} s={charts.summary.energy} />
            <Summary days={days} label="Hambre media" unit="de 5" decimals={1} s={charts.summary.hunger} />
          </Card>
        </>
      )}
    </>
  );
}

function Summary({
  s,
  days,
  unit,
  decimals,
  label = 'Media',
  showChange,
}: {
  s: ReturnType<typeof summarize>;
  days: number;
  unit: string;
  decimals: 0 | 1;
  label?: string;
  showChange?: boolean;
}) {
  const change = s.first !== null && s.last !== null && s.count >= 2 ? s.last - s.first : null;
  return (
    <p className="text-sm text-stone-700">
      {label}: <strong className="tabular-nums">{s.average === null ? 'Sin dato' : `${fmt(s.average, decimals)} ${unit}`}</strong>
      <span className="text-stone-500">
        {' '}
        · {s.count} {s.count === 1 ? 'registro' : 'registros'} en {days} días
      </span>
      {showChange && change !== null && (
        <span className="text-stone-500">
          {' '}
          · del primer al último registro: {change > 0 ? '+' : ''}
          {fmt(change, 1)} {unit}
        </span>
      )}
    </p>
  );
}
