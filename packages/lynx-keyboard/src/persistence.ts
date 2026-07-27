/**
 * Thin persistence seam over `@sigx/lynx-storage` (an *optional* peer — the
 * package works without it; the remembered keyboard height just resets per
 * app run).
 *
 * The peer is loaded via a guarded dynamic `import()` so the optional
 * contract holds for real: a static import would fail resolution for
 * consumers who skipped the peer before `isAvailable()` could ever run.
 * Every call is additionally try/caught — remembering a keyboard height is
 * strictly best-effort and must never take a keyboard-adjacent layout down.
 *
 * (Same shape as `@sigx/lynx-emoji`'s recents/skin-tone seam.)
 */

interface StorageLike {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): void;
    isAvailable(): boolean;
}

let storagePromise: Promise<StorageLike | null> | undefined;

function getStorage(): Promise<StorageLike | null> {
    storagePromise ??= import('@sigx/lynx-storage').then(
        (m) => {
            try {
                return m.Storage.isAvailable() ? m.Storage : null;
            } catch {
                return null;
            }
        },
        () => null, // peer not installed — in-memory only
    );
    return storagePromise;
}

export function loadString(key: string): Promise<string | null> {
    return getStorage().then((s) => (s ? s.getItem(key).catch(() => null) : null));
}

export function saveString(key: string, value: string): void {
    void getStorage().then((s) => {
        try {
            s?.setItem(key, value);
        } catch {
            // best-effort — never propagate storage failures into layout
        }
    });
}
