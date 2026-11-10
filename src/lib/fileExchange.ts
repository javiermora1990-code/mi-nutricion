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

const REJECTED_KEY = 'share-rejected-variants';

/**
 * Variantes que el navegador dijo admitir (canShare) pero rechazó al compartir de verdad.
 * Chrome/Brave en Android validan el tipo de archivo en un segundo paso que canShare no ve.
 */
export function rejectedVariants(): ShareVariant['id'][] {
  try {
    return JSON.parse(localStorage.getItem(REJECTED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function markRejected(id: ShareVariant['id']): void {
  const next = [...new Set([...rejectedVariants(), id])];
  localStorage.setItem(REJECTED_KEY, JSON.stringify(next));
}

export function resetRejectedVariants(): void {
  localStorage.removeItem(REJECTED_KEY);
}

/** Siguiente variante utilizable: admitida por canShare y no rechazada antes. */
export function nextShareVariant(text: string, baseName: string): ShareVariant | undefined {
  const rejected = rejectedVariants();
  return shareVariants(baseName).find((v) => !rejected.includes(v.id) && canShareVariant(text, v));
}

/**
 * Abre el menú nativo de compartir con la primera variante utilizable.
 * Si el navegador la rechaza, se anota y el siguiente toque probará la siguiente:
 * no se puede reintentar en el mismo toque porque el gesto del usuario ya se ha consumido.
 */
export async function shareText(text: string, baseName: string, variantId?: ShareVariant['id']): Promise<ShareOutcome> {
  const variant = variantId
    ? shareVariants(baseName).find((v) => v.id === variantId && canShareVariant(text, v))
    : nextShareVariant(text, baseName);
  if (!variant) return { status: 'unsupported' };
  try {
    // El título es el propio nombre del archivo: Drive en Android usa el título
    // compartido como nombre del documento y, si es otro texto, pierde el nombre y la extensión.
    await navigator.share({ files: [makeFile(text, variant)], title: variant.fileName });
    return { status: 'shared', variant };
  } catch (e) {
    const err = e as DOMException;
    if (err.name === 'AbortError') return { status: 'cancelled', variant };
    if (err.name === 'NotAllowedError') markRejected(variant.id);
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
