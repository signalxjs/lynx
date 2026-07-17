/**
 * Web implementation (runs in `@lynx-js/web-core`'s Worker): key-value storage
 * on **IndexedDB** — `localStorage` does not exist in Worker scope. Swapped in
 * by the plugin's `.web.js` `extensionAlias` (signalxjs/lynx#697); the native
 * bridge tree-shakes away. Worker scope only — no `window.` / `document.`.
 *
 * API-shape constraint: `setItem`/`removeItem`/`clear` are **synchronous
 * void** (matching the native module) while IndexedDB is async. Strategy:
 * a write-through in-memory mirror answers all reads after hydration
 * (`null` = known-deleted), and the actual IDB writes ride one ordered
 * promise chain, so read-after-write is always consistent within the session
 * and persistence follows shortly after. A `clear()` bumps a generation
 * counter so an in-flight hydration can never resurrect pre-clear rows.
 */

const DB_NAME = '@sigx/lynx-storage';
const STORE = 'kv';

/** In-memory mirror: string = live value, null = deleted-but-not-yet-flushed. */
const cache = new Map<string, string | null>();
/** Ordered IDB write chain — guarantees writes land in call order. */
let writeChain: Promise<unknown> = Promise.resolve();
let hydration: Promise<void> | null = null;
/** Bumped by clear() to invalidate any in-flight hydration merge. */
let generation = 0;

function idb(): IDBFactory | undefined {
  return (globalThis as { indexedDB?: IDBFactory }).indexedDB;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb()!.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  dbPromise ??= openDb();
  return dbPromise.then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
      }),
  );
}

/** Queue an IDB write; failures are logged, never thrown into caller code. */
function enqueue(fn: (store: IDBObjectStore) => IDBRequest): void {
  writeChain = writeChain
    .then(() => withStore('readwrite', fn))
    .catch((e) => {
      console.warn('[@sigx/lynx-storage] IndexedDB write failed:', e);
    });
}

/** Load every persisted row into the mirror (once); cache entries win. */
function hydrate(): Promise<void> {
  if (hydration) return hydration;
  const gen = generation;
  hydration = Promise.all([
    withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys()),
    withStore<string[]>('readonly', (s) => s.getAll()),
  ])
    .then(([keys, values]) => {
      if (gen !== generation) return; // a clear() raced the load — discard
      keys.forEach((k, i) => {
        const key = String(k);
        if (!cache.has(key)) cache.set(key, values[i] ?? null);
      });
    })
    .catch((e) => {
      console.warn('[@sigx/lynx-storage] IndexedDB hydration failed:', e);
    });
  return hydration;
}

export const Storage: typeof import('./storage.js').Storage = {
  setItem(key: string, value: string): void {
    cache.set(key, value);
    enqueue((s) => s.put(value, key));
  },

  async getItem(key: string): Promise<string | null> {
    if (!cache.has(key)) await hydrate();
    return cache.get(key) ?? null;
  },

  removeItem(key: string): void {
    cache.set(key, null);
    enqueue((s) => s.delete(key));
  },

  clear(): void {
    generation++;
    cache.clear();
    // The mirror is now the whole truth: everything absent is deleted, so
    // hydration becomes a no-op for the rest of the session.
    hydration = Promise.resolve();
    enqueue((s) => s.clear());
  },

  async getAllKeys(): Promise<string[]> {
    await hydrate();
    const keys: string[] = [];
    for (const [k, v] of cache) if (v !== null) keys.push(k);
    return keys;
  },

  isAvailable(): boolean {
    return typeof idb() !== 'undefined';
  },
} as const;

/** Test-only: reset module state and await pending writes. @internal */
export const __webInternal = {
  async flush(): Promise<void> {
    await writeChain;
  },
  reset(): void {
    cache.clear();
    hydration = null;
    dbPromise = null;
    writeChain = Promise.resolve();
    generation = 0;
  },
};
