/** Rutas de la aplicación (navegación por `location.hash`, sin librería). */
export const ROUTES = ['inicio', 'progreso', 'config', 'config/perfil', 'config/metas', 'config/drive'] as const;
export type Route = (typeof ROUTES)[number];

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  return (ROUTES as readonly string[]).includes(path) ? (path as Route) : 'inicio';
}

export const APP_VERSION = '0.2.1';
export const APP_STAGE = 'Etapa 2';
