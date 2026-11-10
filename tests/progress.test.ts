import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type MiNutricionDB } from '../src/db/db';
import { addDays, localIsoDate, noonEpochSeconds } from '../src/lib/dates';
import {
  EMPTY_PROGRESS,
  buildSeries,
  getProgressLog,
  loadSeries,
  saveProgressLog,
  summarize,
  windowDates,
} from '../src/lib/progress';

let db: MiNutricionDB;
let n = 0;

beforeEach(async () => {
  db = createDb(`test-progress-${++n}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('fechas', () => {
  it('suma y resta días cruzando meses y años', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('usa la fecha local con ceros a la izquierda', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('genera marcas de tiempo crecientes, una por día', () => {
    const stamps = windowDates('2026-03-30', 7).map(noonEpochSeconds);
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
    expect(new Set(stamps).size).toBe(7);
  });
});

describe('registro diario', () => {
  it('guarda los datos indicados y deja en null los que faltan (nunca 0)', async () => {
    const log = await saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, weightKg: 70.2 });
    expect(log.weightKg).toBe(70.2);
    expect(log.sleepHours).toBeNull();
    expect(log.sleepQuality1to5).toBeNull();
    expect(log.energyLevel1to5).toBeNull();
    expect(log.hungerLevel1to5).toBeNull();
    expect(log.trained).toBeNull();
    expect(log.notes).toBeNull();
    expect(log.revision).toBe(1);
  });

  it('un solo registro por día: guardar de nuevo actualiza el mismo id e incrementa la revisión', async () => {
    const first = await saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, weightKg: 70.2 });
    const second = await saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, weightKg: 70.0, energyLevel1to5: 4 });
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);
    expect(await db.progressLogs.count()).toBe(1);
    expect((await getProgressLog(db, '2026-01-10'))?.weightKg).toBe(70);
  });

  it('permite quitar un dato: vuelve a null', async () => {
    await saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, weightKg: 70.2, hungerLevel1to5: 3 });
    const updated = await saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, weightKg: 70.2 });
    expect(updated.hungerLevel1to5).toBeNull();
  });

  it('rechaza valores fuera de rango y fechas mal formadas sin guardar nada', async () => {
    await expect(saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, weightKg: 5 })).rejects.toThrow();
    await expect(saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, sleepHours: 25 })).rejects.toThrow();
    await expect(saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, energyLevel1to5: 6 })).rejects.toThrow();
    await expect(saveProgressLog(db, '2026-01-10', { ...EMPTY_PROGRESS, hungerLevel1to5: 2.5 })).rejects.toThrow();
    await expect(saveProgressLog(db, '10/01/2026', { ...EMPTY_PROGRESS, weightKg: 70 })).rejects.toThrow();
    expect(await db.progressLogs.count()).toBe(0);
  });

  it('devuelve null para un día sin registro', async () => {
    expect(await getProgressLog(db, '2026-01-10')).toBeNull();
  });
});

describe('series de 7/30/90 días sin interpolar', () => {
  it.each([7, 30, 90])('la ventana de %i días tiene exactamente un punto por día y termina hoy', (days) => {
    const dates = windowDates('2026-03-31', days);
    expect(dates).toHaveLength(days);
    expect(dates[days - 1]).toBe('2026-03-31');
    expect(dates[0]).toBe(addDays('2026-03-31', -(days - 1)));
    expect(new Set(dates).size).toBe(days);
  });

  it('los días sin registro quedan en null: ni cero ni valor interpolado', async () => {
    await saveProgressLog(db, '2026-03-25', { ...EMPTY_PROGRESS, weightKg: 70 });
    await saveProgressLog(db, '2026-03-28', { ...EMPTY_PROGRESS, weightKg: 69 });
    const s = await loadSeries(db, '2026-03-31', 7);
    expect(s.dates).toEqual(['2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(s.values.weightKg).toEqual([70, null, null, 69, null, null, null]);
  });

  it('un día con registro pero sin ese dato también queda en null', async () => {
    await saveProgressLog(db, '2026-03-30', { ...EMPTY_PROGRESS, sleepHours: 7.5, energyLevel1to5: 4 });
    const s = await loadSeries(db, '2026-03-31', 7);
    expect(s.values.sleepHours[5]).toBe(7.5);
    expect(s.values.energyLevel1to5[5]).toBe(4);
    expect(s.values.weightKg.every((v) => v === null)).toBe(true);
    expect(s.values.hungerLevel1to5.every((v) => v === null)).toBe(true);
  });

  it('deja fuera los registros anteriores o posteriores a la ventana', async () => {
    await saveProgressLog(db, '2026-03-24', { ...EMPTY_PROGRESS, weightKg: 71 });
    await saveProgressLog(db, '2026-04-01', { ...EMPTY_PROGRESS, weightKg: 68 });
    await saveProgressLog(db, '2026-03-31', { ...EMPTY_PROGRESS, weightKg: 69.5 });
    const s = await loadSeries(db, '2026-03-31', 7);
    expect(s.values.weightKg).toEqual([null, null, null, null, null, null, 69.5]);
  });

  it('ignora los registros con eliminación lógica', () => {
    const base = { createdAt: 'x', updatedAt: 'x', revision: 1, ...EMPTY_PROGRESS };
    const s = buildSeries(
      [
        { ...base, id: 'a', date: '2026-03-30', weightKg: 70, deletedAt: '2026-03-31T00:00:00Z' },
        { ...base, id: 'b', date: '2026-03-31', weightKg: 69, deletedAt: null },
      ],
      '2026-03-31',
      7,
    );
    expect(s.values.weightKg).toEqual([null, null, null, null, null, null, 69]);
  });
});

describe('promedios con número de registros evaluables', () => {
  it('promedia solo los días con dato y cuenta cuántos son', () => {
    const s = summarize([70, null, null, 69, null, 68, null]);
    expect(s.count).toBe(3);
    expect(s.average).toBe(69);
    expect(s.min).toBe(68);
    expect(s.max).toBe(70);
    expect(s.first).toBe(70);
    expect(s.last).toBe(68);
  });

  it('sin ningún dato la media es null, no 0', () => {
    expect(summarize([null, null, null])).toEqual({ count: 0, average: null, min: null, max: null, first: null, last: null });
    expect(summarize([])).toEqual({ count: 0, average: null, min: null, max: null, first: null, last: null });
  });

  it('un único registro no se diluye entre los días vacíos', () => {
    const s = summarize([null, null, 4, null, null, null, null]);
    expect(s.count).toBe(1);
    expect(s.average).toBe(4);
  });
});
