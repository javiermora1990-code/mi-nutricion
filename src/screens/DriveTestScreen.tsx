import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Download, FileUp, Share2, Trash2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { TABLE_NAMES, db, newBase } from '../db/db';
import type { AiExchangeLog } from '../db/types';
import { canShareVariant, downloadText, formatBytes, shareText, shareVariants } from '../lib/fileExchange';
import { parseDocumentText, type ParseResult } from '../schemas';
import { sampleProfileContext } from '../schemas/samples';

interface ImportState {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  picker: string;
  result: ParseResult;
  existing: AiExchangeLog | null;
  registered: boolean;
}

const dt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' });

export function DriveTestScreen({ offlineReady }: { offlineReady: boolean }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4 pb-16">
      <header>
        <h1 className="text-2xl font-semibold text-emerald-900">Mi Nutrición</h1>
        <p className="text-sm text-stone-600">
          Etapa 1 · Prueba de importación y exportación manual de JSON con Google Drive
        </p>
      </header>
      <Diagnostics offlineReady={offlineReady} />
      <ExportCard />
      <ImportCard />
      <LogCard />
      <Checklist />
    </div>
  );
}

// ───────────── Diagnóstico ─────────────

function Diagnostics({ offlineReady }: { offlineReady: boolean }) {
  const [tables, setTables] = useState<number | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [swActive, setSwActive] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    db.open()
      .then(() => setTables(db.tables.length))
      .catch((e: Error) => setDbError(e.message));
    navigator.storage?.persisted?.().then(setPersisted);
    navigator.serviceWorker?.getRegistration().then((r) => setSwActive(!!r?.active));
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [offlineReady]);

  const variants = shareVariants('prueba');
  const shareable = variants.filter((v) => canShareVariant('{}', v));
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  return (
    <Card title="1. Diagnóstico del dispositivo">
      <ul className="flex flex-col gap-1 text-sm">
        <Check ok={tables === TABLE_NAMES.length} label="Base de datos local (IndexedDB/Dexie)">
          {dbError ?? (tables === null ? 'abriendo…' : `${tables} de ${TABLE_NAMES.length} tablas`)}
        </Check>
        <Check ok={window.isSecureContext} label="Contexto seguro (HTTPS o localhost)" />
        <Check ok={swActive || offlineReady} label="Service worker activo (uso sin conexión)">
          {offlineReady ? 'recursos guardados para uso offline' : swActive ? 'activo' : 'no registrado'}
        </Check>
        <Check ok={standalone} label="Abierta como aplicación instalada" optional>
          {standalone ? 'sí' : 'no (se está usando en el navegador)'}
        </Check>
        <Check ok={shareable.length > 0} label="Compartir archivos (Web Share API)">
          {shareable.length ? `admite: ${shareable.map((v) => v.label).join(' · ')}` : 'no disponible → usar Descargar'}
        </Check>
        <Check ok={persisted === true} label="Almacenamiento persistente" optional>
          {persisted === null ? 'desconocido' : persisted ? 'concedido' : 'no concedido'}
        </Check>
        <Check ok={online} label="Conexión" optional>
          {online ? 'con conexión' : 'sin conexión'}
        </Check>
      </ul>
      {persisted === false && navigator.storage?.persist && (
        <button className={btnSecondary} onClick={() => navigator.storage.persist().then(setPersisted)}>
          Solicitar almacenamiento persistente
        </button>
      )}
    </Card>
  );
}

// ───────────── Exportar ─────────────

function ExportCard() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function buildAndLog(method: string) {
    const doc = sampleProfileContext();
    const text = JSON.stringify(doc, null, 2);
    const baseName = `prueba_profile-context_${doc.createdAt.replace(/[-:]/g, '').replace('T', '_').replace('Z', '')}`;
    const log: AiExchangeLog = {
      ...newBase(),
      externalJsonId: doc.id,
      direction: 'export',
      schema: doc.schema,
      formatVersion: doc.formatVersion,
      source: 'app',
      fileName: `${baseName}.json`,
      documentCreatedAt: doc.createdAt,
      status: 'test',
      summary: `Exportación de prueba (${method})`,
    };
    return { text, baseName, log };
  }

  async function onShare() {
    const { text, baseName, log } = await buildAndLog('compartir');
    const outcome = await shareText(text, baseName, 'Mi Nutrición — archivo de prueba');
    if (outcome.status === 'shared') {
      await db.aiExchangeLog.add({ ...log, fileName: outcome.variant.fileName });
      setMessage({
        ok: true,
        text: `Menú de compartir completado con ${outcome.variant.label}. Archivo: ${outcome.variant.fileName}. Comprueba que aparece en Drive › Mi Nutrición › 03_IA.`,
      });
    } else if (outcome.status === 'cancelled') {
      setMessage({ ok: false, text: 'Has cerrado el menú de compartir sin guardar.' });
    } else if (outcome.status === 'unsupported') {
      setMessage({ ok: false, text: 'Este navegador no permite compartir este tipo de archivo. Usa «Descargar al teléfono».' });
    } else {
      setMessage({ ok: false, text: `Error al compartir con ${outcome.variant.label}: ${outcome.message}` });
    }
  }

  async function onDownload() {
    const { text, log } = await buildAndLog('descarga');
    downloadText(text, log.fileName!);
    await db.aiExchangeLog.add(log);
    setMessage({
      ok: true,
      text: `Descarga iniciada: ${log.fileName}. Búscalo en Descargas y súbelo a Drive › Mi Nutrición › 03_IA.`,
    });
  }

  return (
    <Card title="2. Exportar hacia Drive">
      <p className="text-sm text-stone-600">
        Genera un archivo <code>profile-context</code> con datos ficticios, validado con el esquema real.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button className={btnPrimary} onClick={onShare}>
          <Share2 size={18} /> Compartir (Guardar en Drive)
        </button>
        <button className={btnSecondary} onClick={onDownload}>
          <Download size={18} /> Descargar al teléfono
        </button>
      </div>
      {message && <Notice ok={message.ok}>{message.text}</Notice>}
    </Card>
  );
}

// ───────────── Importar ─────────────

function ImportCard() {
  const [state, setState] = useState<ImportState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filtered = useRef<HTMLInputElement>(null);
  const unfiltered = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>, picker: string) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const result = parseDocumentText(text);
      let existing: AiExchangeLog | null = null;
      if (result.ok && 'id' in result.document) {
        existing = (await db.aiExchangeLog.where('externalJsonId').equals(result.document.id).first()) ?? null;
      }
      setState({
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || '(sin tipo)',
        picker,
        result,
        existing,
        registered: false,
      });
    } catch (err) {
      setState(null);
      setError(`No se pudo leer el archivo: ${(err as Error).message}`);
    }
  }

  async function register() {
    if (!state?.result.ok || !('id' in state.result.document)) return;
    const doc = state.result.document;
    try {
      await db.aiExchangeLog.add({
        ...newBase(),
        externalJsonId: doc.id,
        direction: 'import',
        schema: doc.schema,
        formatVersion: doc.formatVersion,
        source: doc.source,
        fileName: state.fileName,
        documentCreatedAt: doc.createdAt,
        status: 'test',
        summary: `Importación de prueba (${state.picker})`,
      });
      setState({ ...state, registered: true });
    } catch (err) {
      setError(`La base de datos rechazó el registro (id duplicado): ${(err as Error).name}`);
    }
  }

  return (
    <Card title="3. Importar desde Drive">
      <p className="text-sm text-stone-600">
        Se abre el selector de archivos de Android. Elige <strong>Drive</strong> en el menú lateral, entra en{' '}
        <em>Mi Nutrición › 03_IA</em> y toca el archivo.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button className={btnPrimary} onClick={() => filtered.current?.click()}>
          <FileUp size={18} /> Elegir archivo JSON
        </button>
        <button className={btnSecondary} onClick={() => unfiltered.current?.click()}>
          <FileUp size={18} /> Elegir (sin filtro de tipo)
        </button>
      </div>
      <p className="text-xs text-stone-500">
        Si el archivo sale atenuado con el primer botón, usa el segundo y anótalo: indica qué filtro debe usar la app
        definitiva.
      </p>
      <input
        ref={filtered}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => onFile(e, 'filtro JSON')}
      />
      <input ref={unfiltered} type="file" className="hidden" onChange={(e) => onFile(e, 'sin filtro')} />

      {error && <Notice ok={false}>{error}</Notice>}
      {state && (
        <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-stone-500">Archivo</dt>
            <dd className="break-all">{state.fileName}</dd>
            <dt className="text-stone-500">Tamaño</dt>
            <dd>{formatBytes(state.sizeBytes)}</dd>
            <dt className="text-stone-500">Tipo recibido</dt>
            <dd>{state.mimeType}</dd>
            <dt className="text-stone-500">Selector</dt>
            <dd>{state.picker}</dd>
            <dt className="text-stone-500">Esquema</dt>
            <dd className="break-all">{state.result.schemaId ?? 'no reconocido'}</dd>
          </dl>
          {state.result.ok ? (
            <>
              <Notice ok>Lectura correcta y JSON válido según el esquema Zod.</Notice>
              {'id' in state.result.document ? (
                state.existing ? (
                  <Notice ok>
                    Control de duplicados: este <code>id</code> ya consta en el registro (
                    {state.existing.direction === 'export' ? 'lo exportó esta app' : 'ya se importó'} el{' '}
                    {dt.format(new Date(state.existing.createdAt))}). Una importación real se bloquearía.
                  </Notice>
                ) : state.registered ? (
                  <Notice ok>Registrado. Vuelve a elegir el mismo archivo para comprobar el bloqueo de duplicados.</Notice>
                ) : (
                  <button className={btnSecondary} onClick={register}>
                    Registrar importación de prueba
                  </button>
                )
              ) : null}
            </>
          ) : (
            <Notice ok={false}>
              <span className="font-medium">El archivo se leyó, pero no supera la validación:</span>
              <ul className="mt-1 list-disc pl-5">
                {state.result.errors.slice(0, 12).map((m, i) => (
                  <li key={i} className="break-all">
                    {m}
                  </li>
                ))}
                {state.result.errors.length > 12 && <li>… y {state.result.errors.length - 12} más</li>}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </Card>
  );
}

// ───────────── Registro ─────────────

function LogCard() {
  const logs = useLiveQuery(() => db.aiExchangeLog.orderBy('id').toArray(), []);
  const sorted = [...(logs ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <Card title={`4. Registro de pruebas (aiExchangeLog: ${sorted.length})`}>
      {sorted.length === 0 ? (
        <p className="text-sm text-stone-500">Todavía no hay movimientos.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-stone-200 text-sm">
            {sorted.map((l) => (
              <li key={l.id} className="py-2">
                <div className="font-medium">
                  {l.direction === 'export' ? 'Exportado' : 'Importado'} · {dt.format(new Date(l.createdAt))}
                </div>
                <div className="break-all text-stone-600">{l.fileName}</div>
                <div className="break-all text-xs text-stone-500">
                  {l.schema} · id {l.externalJsonId.slice(0, 8)}… · {l.summary}
                </div>
              </li>
            ))}
          </ul>
          <button
            className={btnSecondary}
            onClick={() => {
              if (confirm('¿Vaciar el registro de pruebas? Solo borra estas entradas de prueba.')) {
                void db.aiExchangeLog.filter((l) => l.status === 'test').delete();
              }
            }}
          >
            <Trash2 size={18} /> Vaciar registro de pruebas
          </button>
        </>
      )}
    </Card>
  );
}

// ───────────── Guion de verificación ─────────────

const STEPS = [
  'Instala la app: menú ⋮ de Chrome › «Añadir a pantalla de inicio» / «Instalar aplicación», y ábrela desde el icono.',
  'Pulsa «Compartir (Guardar en Drive)», toca «Drive», elige Mi Nutrición › 03_IA y guarda.',
  'Abre la app de Drive y comprueba que el archivo está en 03_IA (desliza hacia abajo para refrescar).',
  'Vuelve aquí, pulsa «Elegir archivo JSON», abre Drive en el selector y toca ese archivo: debe salir «JSON válido» y el aviso de duplicado.',
  'Repite la exportación con «Descargar al teléfono» y sube el archivo a Drive a mano.',
  'Importa un JSON creado por ChatGPT o Gemini en 03_IA y pulsa «Registrar importación de prueba»; impórtalo otra vez para ver el bloqueo.',
  'Activa el modo avión, cierra y vuelve a abrir la app: debe cargar y conservar el registro.',
];

function Checklist() {
  const [done, setDone] = useState<boolean[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('etapa1-checklist') ?? '[]');
    } catch {
      return [];
    }
  });
  const toggle = (i: number) => {
    const next = STEPS.map((_, j) => (j === i ? !done[j] : !!done[j]));
    setDone(next);
    localStorage.setItem('etapa1-checklist', JSON.stringify(next));
  };
  return (
    <Card title="5. Guion de verificación en Android">
      <ol className="flex flex-col gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={i}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-emerald-700"
                checked={!!done[i]}
                onChange={() => toggle(i)}
              />
              <span className={done[i] ? 'text-stone-400 line-through' : ''}>
                {i + 1}. {s}
              </span>
            </label>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ───────────── Piezas de interfaz ─────────────

const btnBase =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98]';
const btnPrimary = `${btnBase} bg-emerald-700 text-white hover:bg-emerald-800`;
const btnSecondary = `${btnBase} border border-stone-300 bg-white text-stone-800 hover:bg-stone-100`;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-stone-900">{title}</h2>
      {children}
    </section>
  );
}

function Check({
  ok,
  label,
  optional,
  children,
}: {
  ok: boolean;
  label: string;
  optional?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
      ) : (
        <XCircle size={18} className={`mt-0.5 shrink-0 ${optional ? 'text-stone-400' : 'text-red-600'}`} />
      )}
      <span>
        {label}
        {children && <span className="text-stone-500"> — {children}</span>}
      </span>
    </li>
  );
}

function Notice({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div
      role="status"
      className={`rounded-lg border p-3 text-sm ${
        ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'
      }`}
    >
      {children}
    </div>
  );
}
