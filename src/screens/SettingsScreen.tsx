import { ChevronRight } from 'lucide-react';
import { APP_STAGE, APP_VERSION, type Route } from '../routes';
import { Card, Screen } from '../ui/kit';
import { CatalogAttribution } from './CatalogScreen';

const ITEMS: { route: Route; title: string; detail: string }[] = [
  { route: 'config/perfil', title: 'Perfil y actividad', detail: 'Datos básicos y cuestionario de actividad' },
  { route: 'config/metas', title: 'Metas', detail: 'Calcular, aprobar y consultar el historial' },
  { route: 'config/catalogo', title: 'Catálogo', detail: 'Buscar, añadir y editar alimentos' },
  { route: 'config/drive', title: 'Prueba de Drive', detail: 'Diagnóstico e importación/exportación de JSON (Etapa 1)' },
];

export function SettingsScreen({ go }: { go: (route: Route) => void }) {
  return (
    <Screen title="Configuración">
      <Card>
        <ul className="-my-2 divide-y divide-stone-100">
          {ITEMS.map((item) => (
            <li key={item.route}>
              <button className="flex min-h-14 w-full items-center gap-3 py-2 text-left" onClick={() => go(item.route)}>
                <span className="flex-1">
                  <span className="block font-medium text-stone-900">{item.title}</span>
                  <span className="block text-sm text-stone-500">{item.detail}</span>
                </span>
                <ChevronRight size={20} className="shrink-0 text-stone-400" />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Fuentes de datos"><CatalogAttribution /></Card>
      <p className="text-center text-xs text-stone-500">
        Mi Nutrición {APP_VERSION} · {APP_STAGE} · Los datos se guardan solo en este dispositivo.
      </p>
    </Screen>
  );
}
