/**
 * useNavSerializer — persistence + restoration.
 *
 * Verifies the contract from the spec:
 *  - Snapshot is JSON-serializable `{ version, stack }`.
 *  - `save` is debounced — many fast pushes coalesce into one write.
 *  - `load` restores the stack and skips the initial save (no overwrite of
 *    restored state by the just-mounted default).
 *  - Validation: rejects snapshots with wrong version, malformed shape, or
 *    entries pointing at routes the registry no longer knows about.
 *  - Adapter errors don't crash the navigator.
 */
import { describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { render, act } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { useNav } from '../src/hooks/use-nav';
import { useNavSerializer, NAV_SNAPSHOT_VERSION } from '../src/hooks/use-nav-serializer';
import type {
    NavSnapshot,
    NavStorageAdapter,
} from '../src/hooks/use-nav-serializer';
import type { Nav } from '../src/hooks/use-nav';
import type { StackEntry } from '../src/types';
import { routes } from './_fixtures';

type Probe = { nav: Nav | null };

// Pump the microtask queue until every queued promise (including load chains
// inside the hook's onMounted) has resolved. Two ticks isn't enough — the
// hook does Promise.resolve().then(load).then(handler), and any awaits inside
// load() add more. We loop a fixed number of times rather than wait on a
// specific signal because the hook intentionally doesn't expose load status.
async function flush(times = 6): Promise<void> {
    for (let i = 0; i < times; i++) {
        await Promise.resolve();
    }
}

// Sleep slightly longer than the debounce window so a pending save fires.
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeAdapter(initial: NavSnapshot | null = null): NavStorageAdapter & {
    saved: NavSnapshot[];
    loaded: number;
} {
    const a = {
        loaded: 0,
        saved: [] as NavSnapshot[],
        load() {
            a.loaded += 1;
            return initial;
        },
        save(s: NavSnapshot) {
            a.saved.push(s);
        },
    };
    return a;
}

function NavWithSerializer({
    adapter,
    debounceMs,
    probe,
}: {
    adapter: NavStorageAdapter;
    debounceMs?: number;
    probe: Probe;
}) {
    const Inner = component<{ adapter: NavStorageAdapter; debounceMs?: number; probe: Probe } & {}>(
        ({ props }) => {
            useNavSerializer({
                storage: props.adapter,
                debounceMs: props.debounceMs ?? 5,
            });
            const nav = useNav();
            props.probe.nav = nav;
            return () => null;
        },
    );
    return (
        <NavigationRoot routes={routes} initialRoute="home" animated={false}>
            <Inner adapter={adapter} debounceMs={debounceMs} probe={probe} />
        </NavigationRoot>
    );
}

describe('useNavSerializer', () => {
    it('persists stack changes (debounced) and emits a JSON-serializable snapshot', async () => {
        const adapter = makeAdapter();
        const probe: Probe = { nav: null };
        render(<NavWithSerializer adapter={adapter} debounceMs={20} probe={probe} />);
        await flush();

        act(() => probe.nav!.push('profile', { id: '7' }));
        act(() => probe.nav!.push('settings'));
        // Two pushes in quick succession; debounce should coalesce.
        expect(adapter.saved.length).toBe(0);

        await delay(40);

        expect(adapter.saved.length).toBe(1);
        const snap = adapter.saved[0];
        expect(snap.version).toBe(NAV_SNAPSHOT_VERSION);
        expect(snap.stack.map((e) => e.route)).toEqual([
            'home',
            'profile',
            'settings',
        ]);
        // JSON round-trip — the persistence contract is "shove this through
        // JSON.stringify into whatever storage you like."
        expect(() => JSON.parse(JSON.stringify(snap))).not.toThrow();
    });

    it('restores a valid snapshot on mount and skips the initial save', async () => {
        const stored: NavSnapshot = {
            version: NAV_SNAPSHOT_VERSION,
            stack: [
                {
                    key: 'root',
                    route: 'home',
                    params: {},
                    search: {},
                    state: undefined,
                    presentation: 'card',
                } as StackEntry,
                {
                    key: 'k_1',
                    route: 'profile',
                    params: { id: '99' },
                    search: { tab: 'posts' },
                    state: undefined,
                    presentation: 'card',
                } as StackEntry,
            ],
        };
        const adapter = makeAdapter(stored);
        const probe: Probe = { nav: null };
        render(<NavWithSerializer adapter={adapter} debounceMs={20} probe={probe} />);

        await flush();

        // Stack matches restored snapshot.
        expect(probe.nav!.stack.length).toBe(2);
        expect(probe.nav!.current.route).toBe('profile');
        expect((probe.nav!.current.params as { id: string }).id).toBe('99');

        // No save yet — load applied state without triggering a write.
        await delay(40);
        expect(adapter.saved.length).toBe(0);
    });

    it('rejects snapshots from a different schema version', async () => {
        const adapter = makeAdapter({
            version: NAV_SNAPSHOT_VERSION + 1,
            stack: [
                {
                    key: 'root',
                    route: 'home',
                    params: {},
                    search: {},
                    state: undefined,
                    presentation: 'card',
                } as StackEntry,
            ],
        });
        const probe: Probe = { nav: null };
        render(<NavWithSerializer adapter={adapter} probe={probe} />);

        await flush();

        // Stack stayed at initial route — restoration was rejected.
        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });

    it('rejects snapshots referencing unregistered routes', async () => {
        const adapter = makeAdapter({
            version: NAV_SNAPSHOT_VERSION,
            stack: [
                {
                    key: 'root',
                    route: 'home',
                    params: {},
                    search: {},
                    state: undefined,
                    presentation: 'card',
                } as StackEntry,
                {
                    key: 'k_1',
                    route: 'pageThatNoLongerExists',
                    params: {},
                    search: {},
                    state: undefined,
                    presentation: 'card',
                } as StackEntry,
            ],
        });
        const probe: Probe = { nav: null };
        render(<NavWithSerializer adapter={adapter} probe={probe} />);

        await flush();

        // Unknown route → snapshot dropped wholesale, not partially restored.
        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });

    it('survives a load() that throws', async () => {
        const adapter: NavStorageAdapter & { saved: NavSnapshot[] } = {
            saved: [],
            load() {
                throw new Error('storage corrupt');
            },
            save(s) {
                adapter.saved.push(s);
            },
        };
        const probe: Probe = { nav: null };
        const onErr = vi.fn();
        const Inner = component<{ probe: Probe } & {}>(({ props }) => {
            useNavSerializer({ storage: adapter, onRestoreError: onErr });
            props.probe.nav = useNav();
            return () => null;
        });
        render(
            <NavigationRoot routes={routes} initialRoute="home" animated={false}>
                <Inner probe={probe} />
            </NavigationRoot>,
        );

        await flush();

        expect(probe.nav!.current.route).toBe('home');
        expect(onErr).toHaveBeenCalledWith('load-threw', expect.any(Error));
    });

    it('rejects malformed-shape snapshots', async () => {
        const adapter = makeAdapter({
            // Missing `version` key — counts as shape-invalid.
            stack: [],
        } as unknown as NavSnapshot);
        const probe: Probe = { nav: null };
        render(<NavWithSerializer adapter={adapter} probe={probe} />);

        await flush();

        expect(probe.nav!.stack.length).toBe(1);
        expect(probe.nav!.current.route).toBe('home');
    });
});
