import { ArrowLeft, BookOpen, Home, LineChart as LineChartIcon, MessageCircle, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { parseRoute, type Route } from './routes';
import { CatalogScreen } from './screens/CatalogScreen';
import { DriveTestScreen } from './screens/DriveTestScreen';
import { GoalsScreen } from './screens/GoalsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { PlanScreen } from './screens/PlanScreen';
import { AiScreen } from './screens/AiScreen';
import { SettingsScreen } from './screens/SettingsScreen';

const TABS: { route: Route; label: string; icon: typeof Home }[] = [
  { route: 'inicio', label: 'Inicio', icon: Home },
  { route: 'plan', label: 'Plan', icon: BookOpen },
  { route: 'ia', label: 'IA', icon: MessageCircle },
  { route: 'progreso', label: 'Progreso', icon: LineChartIcon },
  { route: 'config', label: 'Configuración', icon: Settings },
];

export function App() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));

  useEffect(() => {
    registerSW({ immediate: true, onOfflineReady: () => setOfflineReady(true) });
  }, []);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (next: Route) => {
    location.hash = `#/${next}`;
  };
  const isSub = route.startsWith('config/');
  const activeTab: Route = isSub ? 'config' : route;

  return (
    <>
      {isSub && (
        <div className="mx-auto max-w-xl px-4 pt-3">
          <button className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-emerald-800" onClick={() => go('config')}>
            <ArrowLeft size={18} /> Configuración
          </button>
        </div>
      )}

      {route === 'inicio' && <HomeScreen go={go} />}
      {route === 'plan' && <PlanScreen go={go} />}
      {route === 'ia' && <AiScreen go={go} />}
      {route === 'progreso' && <ProgressScreen />}
      {route === 'config' && <SettingsScreen go={go} />}
      {route === 'config/perfil' && <ProfileScreen onSaved={() => go('config/metas')} />}
      {route === 'config/metas' && <GoalsScreen onEditProfile={() => go('config/perfil')} />}
      {route === 'config/catalogo' && <CatalogScreen />}
      {route === 'config/drive' && (
        <div className="pb-12">
          <DriveTestScreen offlineReady={offlineReady} />
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-xl">
          {TABS.map(({ route: r, label, icon: Icon }) => {
            const selected = activeTab === r;
            return (
              <li key={r} className="flex-1">
                <button
                  aria-current={selected ? 'page' : undefined}
                  onClick={() => go(r)}
                  className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                    selected ? 'text-emerald-800' : 'text-stone-500'
                  }`}
                >
                  <Icon size={22} />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
