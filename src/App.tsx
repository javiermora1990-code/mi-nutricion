import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { DriveTestScreen } from './screens/DriveTestScreen';

export function App() {
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    registerSW({ immediate: true, onOfflineReady: () => setOfflineReady(true) });
  }, []);

  return <DriveTestScreen offlineReady={offlineReady} />;
}
