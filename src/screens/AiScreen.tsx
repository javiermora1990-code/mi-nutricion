import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { z } from 'zod';
import { ContextPreviewTable } from '../components/ContextPreviewTable';
import { ProposalReview } from '../components/ProposalReview';
import { db } from '../db/db';
import { applyProposal, prepareProposal, type ProposalReview as Review } from '../lib/aiImport';
import { createProfileContext, exchangeBaseName, logContextExport } from '../lib/aiContext';
import { loadContextPreview } from '../lib/aiContextPreview';
import { seedCatalog } from '../lib/catalog';
import { downloadText, shareText } from '../lib/fileExchange';
import { parseDocumentText, SCHEMA_IDS, type ProfileContextDocument } from '../schemas';
import type { Route } from '../routes';
import { btnPrimary, btnSecondary, Card, fmt, Notice, Screen } from '../ui/kit';

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
  const preview = useLiveQuery(() => loadContextPreview(db));

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
    <Screen title="IA" subtitle="Envía tus datos a ChatGPT o Gemini, recibe un menú y revísalo">
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
          <Card title="1 · Enviar tus datos">
            {preview ? <ContextPreviewTable rows={preview} />
              : <p className="text-sm text-stone-600">Leyendo tus datos…</p>}
            <button className={btnPrimary} disabled={busy} onClick={() => void prepareContext()}>{context ? 'Preparar un contexto nuevo' : 'Preparar mi contexto'}</button>
            {context && (
              <>
                <div className="flex flex-wrap gap-2">
                  <button className={btnPrimary} disabled={busy} onClick={() => void exportContext(true)}>Compartir contexto a Drive</button>
                  <button className={btnSecondary} disabled={busy} onClick={() => void exportContext(false)}>Descargar contexto</button>
                </div>
              </>
            )}
          </Card>
          <Card title="2 · Importar la propuesta">
            <input ref={inputRef} type="file" className="hidden" accept="application/json,.json,text/plain,.txt" onChange={(event) => void importFile(event)} />
            <button className={btnSecondary} disabled={busy} onClick={() => inputRef.current?.click()}>Elegir archivo de Drive</button>
          </Card>
        </>
      )}
    </Screen>
  );
}
