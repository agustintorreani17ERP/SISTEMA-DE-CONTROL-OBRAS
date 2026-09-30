/**
 * Caché de resultados del motor de costos para rangos ya cerrados: sus hechos no cambian, pero
 * el ACU, los precios o la K sí pueden cambiar el cálculo, así que esos cambios la vacían.
 */
const MAX = 200;
const store = new Map<string, unknown>();

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet(key: string, value: unknown) {
  if (store.size >= MAX) store.delete(store.keys().next().value!);
  store.set(key, value);
}

export function invalidateCostCache() {
  store.clear();
}
