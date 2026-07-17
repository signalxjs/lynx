/**
 * Web storage shim (`storage.web.ts`) — IndexedDB-backed with a write-through
 * in-memory mirror so the native module's sync-void `setItem`/`removeItem`/
 * `clear` shape holds (read-after-write consistent without awaiting the
 * flush). Each test gets a fresh fake IDBFactory, so persistence is asserted
 * by flushing writes, resetting the module mirror, and re-reading.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { Storage, __webInternal } from '../src/storage.web';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  __webInternal.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Storage (web / IndexedDB)', () => {
  it('is available and round-trips read-after-write without awaiting the flush', async () => {
    expect(Storage.isAvailable()).toBe(true);
    Storage.setItem('user', '{"name":"Alice"}');
    await expect(Storage.getItem('user')).resolves.toBe('{"name":"Alice"}');
  });

  it('persists through IndexedDB (flush → fresh mirror → hydrate)', async () => {
    Storage.setItem('k1', 'v1');
    Storage.setItem('k2', 'v2');
    await __webInternal.flush();
    __webInternal.reset(); // fresh session over the same fake IDB
    await expect(Storage.getItem('k1')).resolves.toBe('v1');
    await expect(Storage.getAllKeys()).resolves.toEqual(expect.arrayContaining(['k1', 'k2']));
  });

  it('removeItem deletes in-session and persistently', async () => {
    Storage.setItem('gone', 'x');
    Storage.removeItem('gone');
    await expect(Storage.getItem('gone')).resolves.toBeNull();
    await __webInternal.flush();
    __webInternal.reset();
    await expect(Storage.getItem('gone')).resolves.toBeNull();
  });

  it('clear empties everything; later writes survive', async () => {
    Storage.setItem('a', '1');
    Storage.setItem('b', '2');
    Storage.clear();
    await expect(Storage.getAllKeys()).resolves.toEqual([]);
    Storage.setItem('c', '3');
    await expect(Storage.getItem('a')).resolves.toBeNull();
    await expect(Storage.getAllKeys()).resolves.toEqual(['c']);
    await __webInternal.flush();
    __webInternal.reset();
    await expect(Storage.getAllKeys()).resolves.toEqual(['c']);
  });

  it('getAllKeys merges hydrated rows with unflushed writes', async () => {
    Storage.setItem('old', 'x');
    await __webInternal.flush();
    __webInternal.reset();
    Storage.setItem('new', 'y'); // written before hydration ran
    const keys = await Storage.getAllKeys();
    expect(keys.sort()).toEqual(['new', 'old']);
    await expect(Storage.getItem('old')).resolves.toBe('x');
  });

  it('a clear() racing an in-flight hydration never resurrects old rows', async () => {
    Storage.setItem('stale', 'x');
    await __webInternal.flush();
    __webInternal.reset();
    const hydrating = Storage.getAllKeys(); // starts hydration
    Storage.clear(); // races it
    await hydrating;
    await expect(Storage.getAllKeys()).resolves.toEqual([]);
    await expect(Storage.getItem('stale')).resolves.toBeNull();
  });
});
