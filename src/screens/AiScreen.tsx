import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { z } from 'zod';
import { ProposalReview } from '../components/ProposalReview';
import { db } from '../db/db';
import { applyProposal, prepareProposal, type ProposalReview as Review } from '../lib/aiImport';
import { createProfileContext, exchangeBaseName, logContextExport } from '../lib/aiContext';
import { seedCatalog } from '../lib/catalog';
import { downloadText, shareText } from '../lib/fileExchange';
import { parseDocumentText, SCHEMA_IDS, type ProfileContextDocument } from '../schemas';
import type { Route } from '../routes';
import { btnPrimary, btnSecondary, Card, fmt, Notice, Screen } from '../ui/kit';

const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });
function errorText(cause: unknown): string {
  if (cause instanceof z.ZodError) return cause.issues.map((issue) => `${issue.path.join('.')} · ${issue.message}`).join('\n');
  return cause instanceof Error ? cause.message : 'No se pudo completar la operación.';
}

export function AiScreen({ go }: { go: (route: Route) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [context, setContext] = useState<{ document: ProfileContextDocument; baseName: string }>();
  const [review, setReview] = useState<Review>();
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const data = useLiveQuery(async () => ({
    foods: await db.foods.filter((food) => !food.deletedAt).sortBy('name'),
    equivalents: await db.foodEquivalences.filter((e) => !e.deletedAt).toArray(),
    recipes: await db.recipes.toArray(),
    logs: (await db.aiExchangeLog.toArray()).filter((log) => log.status === 'applied' || log.status === 'exported')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }));

  async function prepareContext() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const date = new Date();
      const document = await createProfileContext(db, date);
      setContext({ document, baseName: exchangeBaseName('contexto', document.id, date) });
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function exportContext(share: boolean) {
    if (!context || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const text = JSON.stringify(context.document, null, 2);
      const name = `${context.baseName}.json${share ? '.txt' : ''}`;
      if (share) {
        const outcome = await shareText(text, context.baseName, 'txt');
        if (outcome.status === 'cancelled') return;
        if (outcome.status !== 'shared') throw new Error('No se pudo compartir. Puedes descargar el archivo y subirlo a Drive.');
      } else downloadText(text, name);
      await logContextExport(db, context.document, name);
      setMessage(share ? 'Archivo compartido. Adjunta ese contexto a tu conversación con la IA.'
        : 'Descarga solicitada. Guarda el contexto en Mi Nutrición/03_IA y adjúntalo a la IA.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setReview(undefined);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = parseDocumentText(await file.text());
      if (!result.ok) throw new Error(result.errors.join('\n'));
      if (result.document.schema !== SCHEMA_IDS.aiProposal) throw new Error('Selecciona una propuesta de recetas o menú generada por la IA.');
      await seedCatalog(db);
      setReview(await prepareProposal(db, result.document));
      setFileName(file.name);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function confirm(replace: boolean) {
    if (!review || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await applyProposal(db, review, fileName, replace);
      setReview(undefined);
      setMessage(`Importación confirmada. ${fmt(result.recipes)} recetas, ${fmt(result.foods)} alimentos y ${fmt(result.meals)} tomas guardadas.`);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return (
    <Screen title="IA" subtitle="Prepara tu contexto y revisa las propuestas de ChatGPT o Gemini">
      {error && <Notice tone="error"><p className="whitespace-pre-wrap break-words">{error}</p></Notice>}
      {message && <Notice tone="ok">{message} <button className="font-medium underline" onClick={() => go('plan')}>Ver mi plan</button></Notice>}
      {review ? (
        <>
          <p className="break-all text-sm text-stone-600">{fileName}</p>
          {review.document.payload.basedOnContextId && data &&
            !data.logs.some((log) => log.direction === 'export' && log.externalJsonId === review.document.payload.basedOnContextId) &&
            <Notice tone="warn">El contexto de referencia no figura en el historial de este dispositivo. Comprueba que la propuesta corresponde a tus datos actuales.</Notice>}
          {data && <ProposalReview key={review.document.id} review={review} foods={data.foods}
            equivalents={data.equivalents} recipes={data.recipes} busy={busy}
            onChange={(document) => { setReview({ ...review, document }); setError(''); }}
            onConfirm={(replace) => void confirm(replace)}
            onCancel={() => { setReview(undefined); setError(''); }} />}
        </>
      ) : (
        <>
          <Card title="1. Llevar tus datos a la IA">
            <p className="text-sm text-stone-600">Prepara un archivo con tu perfil, metas, catálogo y recetas guardadas. Incluye las instrucciones para que la IA genere una propuesta compatible.</p>
            <button className={btnPrimary} disabled={busy} onClick={() => void prepareContext()}>{context ? 'Preparar un contexto nuevo' : 'Preparar mi contexto'}</button>
            {context && (
              <>
                <p className="text-sm">{fmt(context.document.payload.catalogSummary.length)} alimentos · {fmt(context.document.payload.recipeSummary?.length ?? 0)} recetas.</p>
                {!context.document.payload.activeGoal && <Notice tone="warn">Todavía no tienes metas aprobadas. Puedes acordar con la IA qué criterio usar para el menú.</Notice>}
                <div className="flex flex-wrap gap-2">
                  <button className={btnPrimary} disabled={busy} onClick={() => void exportContext(true)}>Compartir contexto a Drive</button>
                  <button className={btnSecondary} disabled={busy} onClick={() => void exportContext(false)}>Descargar contexto</button>
                </div>
                <details className="text-sm">
                  <summary className="min-h-12 cursor-pointer py-3 font-medium">Ver las instrucciones incluidas</summary>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{context.document.payload.aiInstructions}</pre>
                </details>
              </>
            )}
          </Card>
          <Card title="2. Preparar las recetas y el menú">
            <p className="text-sm text-stone-600">Adjunta el contexto a ChatGPT o Gemini. Dile para qué semana y personas quieres cocinar, tus gustos y el tiempo disponible. Revisa las propuestas conversando y pide el JSON final cuando te encajen.</p>
            <p className="text-sm text-stone-600">Guarda el archivo recibido en Drive, dentro de Mi Nutrición/03_IA.</p>
          </Card>
          <Card title="3. Actualizar datos">
            <p className="text-sm text-stone-600">Selecciona el archivo desde Google Drive en el selector de Android. Podrás corregir la propuesta antes de confirmar.</p>
            <input ref={inputRef} type="file" className="hidden" accept="application/json,.json,text/plain,.txt" onChange={(event) => void importFile(event)} />
            <button className={btnPrimary} disabled={busy} onClick={() => inputRef.current?.click()}>Actualizar datos desde Drive</button>
          </Card>
          {!!data?.logs.length && (
            <Card title="Historial de intercambios">
              <ul className="divide-y divide-stone-100 text-sm">
                {data.logs.map((log) => (
                  <li key={log.id} className="py-2">
                    <p>{log.direction === 'export' ? 'Contexto exportado' : 'Propuesta importada'} · {dateFormat.format(new Date(log.updatedAt))}</p>
                    <p className="text-xs text-stone-600">{log.summary}</p>
                    <p className="break-all text-xs text-stone-500">{log.fileName}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
