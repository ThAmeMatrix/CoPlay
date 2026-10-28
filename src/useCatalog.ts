import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from './hooks';
import { createBrowserCatalogCache } from './catalog-client';
import { createCatalogController } from './catalog-controller';

export function useCatalog(query: string, sourceId: string) {
  const [controller] = useState(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Private browser mode. */ }
    return createCatalogController({ cache: createBrowserCatalogCache(storage), request: api, initialQuery: query });
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => { controller.select(sourceId, query); }, [controller, sourceId, query]);
  return { ...state, controller };
}
