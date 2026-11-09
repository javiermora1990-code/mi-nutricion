/**
 * Intercambio manual de archivos (sección 11): sin OAuth ni API de Drive.
 * Importar = selector de archivos del sistema. Exportar = Web Share API o descarga.
 */

export interface ShareVariant {
  id: 'json' | 'json-as-text' | 'txt';
  label: string;
  fileName: string;
  mimeType: string;
}

/** Variantes a probar, de la preferida a la más compatible. */
export function shareVariants(baseName: string): ShareVariant[] {
  return [
    { id: 'json', label: '.json (application/json)', fileName: `${baseName}.json`, mimeType: 'application/json' },
    { id: 'json-as-text', label: '.json (text/plain)', fileName: `${baseName}.json`, mimeType: 'text/plain' },
    { id: 'txt', label: '.json.txt (text/plain)', fileName: `${baseName}.json.txt`, mimeType: 'text/plain' },
  ];
}

export function makeFile(text: string, v: ShareVariant): File {
  return new File([text], v.fileName, { type: v.mimeType });
}

export function canShareVariant(text: string, v: ShareVariant): boolean {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [makeFile(text, v)] });
  } catch {
    return false;
  }
}

export type ShareOutcome =
  | { status: 'shared'; variant: ShareVariant }
  | { status: 'cancelled'; variant: ShareVariant }
  | { status: 'unsupported' }
  | { status: 'error'; variant: ShareVariant; message: string };

/** Abre el menú nativo de compartir con la primera variante que el navegador admita. */
export async function shareText(text: string, baseName: string, title: string): Promise<ShareOutcome> {
  const variant = shareVariants(baseName).find((v) => canShareVariant(text, v));
  if (!variant) return { status: 'unsupported' };
  try {
    await navigator.share({ files: [makeFile(text, variant)], title });
    return { status: 'shared', variant };
  } catch (e) {
    const err = e as DOMException;
    if (err.name === 'AbortError') return { status: 'cancelled', variant };
    return { status: 'error', variant, message: `${err.name}: ${err.message}` };
  }
}

/** Descarga a la carpeta Descargas del teléfono (alternativa a compartir). */
export function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(n / 1024)} kB`;
}
