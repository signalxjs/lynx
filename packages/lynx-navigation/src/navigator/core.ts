import {
    batch,
    runOnMainThread,
    signal,
    untrack,
    type Signal,
    type SharedValue,
} from '@sigx/lynx';
import { isLazyComponent } from '@sigx/lynx';
import { withTiming } from '@sigx/lynx-motion';
import type { Nav } from '../hooks/use-nav.js';
import type { ScreenRegistry } from '../internal/screen-registry.js';
import {
    initialSnapProgress,
    resolveSnapPoints,
    sheetDurationSec,
} from '../internal/sheet-math.js';
import type {
    PopOptions,
    Presentation,
    PushOptions,
    RouteMap,
    StackEntry,
    TransitionState,
} from '../types.js';

/**
 * The reactive backing state for one navigator instance.
 *
 * Two reactive signals drive the public surface:
 *   - `stack` is the entry array (read via `nav.stack` / `nav.current`).
 *   - `transition` is non-null only while a push/pop animation is in flight;
 *     `<Stack>` reads it to decide whether to render one screen or two.
 *
 * Pop is committed *after* its slide animation completes — `nav.canGoBack`
 * stays true during the slide, then flips when the entry actually leaves the
 * stack. Push commits its stack mutation immediately and animates the new
 * entry in.
 */
export interface NavigatorState {
    readonly nav: Nav;
    readonly routes: RouteMap;
    /**
     * Internal: BG-side gesture-back controller used by `<EdgeBackHandle>`.
     * The `progress` SharedValue is wired here so a gesture worklet can write
     * it directly on MT; the begin/commit/cancel methods set the transition
     * state appropriately without driving their own auto-animation (the
     * gesture worklet is in charge of that).
     */
    readonly _gesture: {
        beginBackGesture(): void;
        commitBackGesture(): void;
        cancelBackGesture(): void;
        /**
         * Commit a drag-to-dismiss of the top sheet entry. The sheet drag
         * worklet has already animated the sheet SV to 0 (off-screen), so
         * this only mutates the stack — popping via `nav.pop()` would
         * re-animate and visibly glitch. No-ops unless the top entry is a
         * sheet AND (when given) matches `expectedKey` — the commit arrives
         * via a BG `setTimeout` after an MT animation, so a navigation race
         * could otherwise pop a *different* sheet that became top meanwhile.
         */
        commitSheetDismiss(expectedKey?: string): void;
    };
    /**
     * Internal: cross-entry `<Screen>` registry lookup.
     *
     * Each `<EntryScope>` registers its `ScreenRegistry` here on mount and
     * removes it on unmount. The navigator's persistent chrome (HeaderBar /
     * TabBar, shipped in later slices) calls `getScreenRegistry(entry.key)`
     * to read the currently-focused screen's options/slot fills without
     * being itself remounted on each navigation.
     *
     * Returns `undefined` when no screen for that key has mounted yet (or
     * after it has unmounted) — consumers must tolerate this and render
     * defaults.
     */
    readonly _screens: {
        register(registry: ScreenRegistry): void;
        /** Identity-checked: no-op when a newer registry has taken the slot. */
        unregister(registry: ScreenRegistry): void;
        get(entryKey: string): ScreenRegistry | undefined;
    };
    /**
     * Internal: resolved `backdrop` option per sheet entry (`false` = the
     * inline/non-modal, pass-through sheet). Populated at push time from the
     * SAME deferred `<Screen>`-registration read the sheet's snap target uses
     * (`resolveSheetTarget`) — a render-time read of the option can't be
     * relied on: the sheet's `<Screen>` registers as a descendant of the
     * very slot that must render the backdrop, one flush too late, and the
     * registry's version tick does not re-run that slot under the eager test
     * flush. `<Stack>` reads this reactive record keyed by entry, so the
     * backdrop is correct from the frame the registration resolves. Absent
     * key ⇒ default (dimmed) backdrop.
     */
    readonly _sheetBackdrops: Signal<Record<string, boolean>>;
    /**
     * Internal: resolved `snapPoints` per sheet entry, populated at push time
     * from the SAME registration read as `_sheetBackdrops` (above) — for the
     * identical reason. The sheet LAYER's translateY mapper scales by the
     * largest snap fraction, and a render-time read gets the `[0.5]` default
     * before the sheet's `<Screen snapPoints>` registers (and doesn't
     * reactively correct), so the sheet renders at the wrong height while
     * `useSheetHeight` (reactive) reads the real fraction — the two disagree
     * and the sheet paints too short. `<Stack>` prefers this reactive record.
     * Absent key ⇒ fall back to the render-time option / default.
     */
    readonly _sheetSnaps: Signal<Record<string, readonly number[]>>;
    /**
     * Internal: set `nav.isLocallyFocused` from outside.
     *
     * `<Stack>` calls this when its host entry's locally-focused state
     * changes (top of parent + parent focused + enclosing tab active). For
     * the root nav this stays `true` for the lifetime of the navigator.
     */
    readonly _setLocallyFocused: (focused: boolean) => void;
}

/**
 * Slide-from-right transition timing. Kept as constants so screen options
 * can override per-screen later (Phase 0.5). Duration is in seconds — that's
 * what `@sigx/lynx-motion`'s `withTiming` expects (per `with-timing.ts`).
 */
const TRANSITION_DURATION_SEC = 0.28;

/**
 * Kick off a lazy component's chunk fetch when its route is navigated to.
 *
 * Lazy routes (`component: lazy(() => import('./Heavy.js'))`) start loading
 * the moment `push`/`replace` is called rather than waiting until render
 * tries to instantiate them — by the time `<Stack>` swaps screens the chunk
 * is usually already resolved, so the user sees the screen instead of the
 * `<Defer fallback>`. Fire-and-forget: errors here surface through
 * `<Defer>` at render time.
 */
function preloadRouteComponent(component: unknown): void {
    if (isLazyComponent(component)) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        component.preload().catch(() => {});
    }
}

/**
 * Whether the currently-stored transition is the one a completion callback
 * set. Compared by kind + top-entry key (unique per push) rather than
 * object identity: the transition signal is a deep proxy, so reads return
 * a wrapped object that is never `===` the raw value that was stored.
 */
function isOwnTransition(
    current: TransitionState | null,
    own: TransitionState,
): boolean {
    return (
        current !== null &&
        current.kind === own.kind &&
        current.topEntry.key === own.topEntry.key
    );
}

let entryKeyCounter = 0;
function nextEntryKey(): string {
    entryKeyCounter += 1;
    return `entry-${entryKeyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEntry(
    name: string,
    params: unknown,
    search: unknown,
    options: PushOptions | undefined,
    routes: RouteMap,
): StackEntry {
    const route = routes[name];
    const presentation: Presentation =
        options?.presentation ?? route?.presentation ?? 'card';
    return {
        key: nextEntryKey(),
        route: name,
        params: (params ?? {}) as Record<string, unknown>,
        search: (search ?? {}) as Record<string, unknown>,
        state: options?.state,
        presentation,
    };
}

function unpackArgs(
    name: string,
    args: unknown[],
    routes: RouteMap,
): { params: unknown; search: unknown; options: PushOptions | undefined } {
    const route = routes[name];
    const requiresParams = !!route?.params;
    if (requiresParams) {
        const [params, search, options] = args as [
            unknown,
            unknown,
            PushOptions | undefined,
        ];
        return { params, search, options };
    }
    const [search, options] = args as [unknown, PushOptions | undefined];
    return { params: undefined, search, options };
}

export interface CreateNavigatorOptions {
    routes: RouteMap;
    initial: StackEntry;
    /**
     * SharedValue driving push/pop transition progress. Created in
     * `<NavigationRoot>` setup via `useSharedValue(0)` so the bridge
     * plumbing is wired (SharedValue is an MT-bridged ref). When undefined,
     * navigations are instant — used by tests against `@sigx/lynx-testing`
     * that don't have an MT runtime.
     */
    progress?: SharedValue<number>;
    /**
     * Dedicated SharedValue for `presentation: 'sheet'` entries. Separate
     * from `progress` because that SV is reset to 0 inside the MT worklet at
     * the start of every transition — a resting sheet must hold its position
     * across unrelated navigations, so its binding lives on an SV only sheet
     * code writes. Only meaningful on the root navigator (sheets escalate);
     * undefined disables sheet animation (tests / nested navs).
     */
    sheetProgress?: SharedValue<number>;
    /**
     * Parent navigator. Set when this navigator is nested under another
     * (e.g. a per-tab `<Stack initialRoute>` under root). Drives the
     * `nav.parent` getter and the modal-escalation behaviour of `push`:
     * a push of a route whose resolved presentation is not `'card'`
     * recurses via `parent.push(...)`, walking up the chain until it
     * lands on a navigator with no parent (the root).
     *
     * Leave undefined for the root navigator.
     */
    parent?: Nav | null;
    /**
     * Whether this navigator is considered "locally focused" at creation
     * time. Defaults to true for the root nav; nested stacks pass `false`
     * here and then flip the flag via `_setLocallyFocused` once their
     * host-entry/tab-active state is computed.
     */
    initialLocallyFocused?: boolean;
}

/**
 * Create a navigator. Returns the public `nav` handle plus the routes map.
 * The transition signal lives on `nav` (via `nav.transition`) so `<Stack>`
 * can subscribe to it.
 */
export function createNavigatorState(opts: CreateNavigatorOptions): NavigatorState {
    const { routes, initial, progress, sheetProgress, parent = null } = opts;

    // Hoisted (rather than created inline in the return) because `push`
    // reads a just-mounted sheet screen's options to compute its open
    // animation target.
    const screens = createScreenRegistries();

    // Resolved `backdrop` per sheet entry — written at push (deferred read),
    // read reactively by `<Stack>`. A deep-reactive record: writing a key
    // notifies exactly that key's readers.
    const sheetBackdropsBox = signal<Record<string, boolean>>({});
    const sheetSnapsBox = signal<Record<string, readonly number[]>>({});

    const stackSignal: Signal<StackEntry[]> = signal<StackEntry[]>([initial]);
    const focusedBox: Signal<{ value: boolean }> = signal<{ value: boolean }>({
        value: opts.initialLocallyFocused ?? true,
    });
    const children = new Set<Nav>();
    // `signal(null)` would wrap as a primitive (no `$set`), so wrap in an
    // object to get the standard `{ value }`-style API. Reading `.value`
    // tracks; writing triggers re-render of `<Stack>`.
    const transitionBox: Signal<{ value: TransitionState | null }> = signal<{
        value: TransitionState | null;
    }>({ value: null });

    function getStack(): StackEntry[] {
        return stackSignal;
    }
    function setStack(next: StackEntry[]): void {
        stackSignal.$set(next);
    }
    function setTransition(next: TransitionState | null): void {
        transitionBox.value = next;
    }

    /**
     * Whether a transition is currently in flight. Used to no-op concurrent
     * navigation calls — keeps the state machine simple. A queued/aborted
     * model is a v0.3 polish item.
     */
    function isTransitioning(): boolean {
        return transitionBox.value !== null;
    }

    /**
     * Run the slide animation by hopping a worklet onto the main thread that
     * resets `progress` to 0 and starts a `withTiming` to the target. Then
     * wait the animation duration on BG so we can fire the completion
     * callback (clear transition / commit the popped entry) when the visual
     * animation is done.
     *
     * Why the SV reset lives *inside* the worklet (not on BG before the call):
     * the BG-side render ops (Stack re-render mounting the two
     * `ScreenContainer`s with their `useAnimatedStyle` bindings) and a BG-side
     * SV write (`progress.value = 0`) travel different bridge channels. On
     * subsequent navigations, MT can register the new bindings before the
     * BG-side reset arrives — the bindings snapshot sv at its previous
     * end-state (`1`), and `withTiming(sv, 1, ...)` then animates from 1→1
     * (no visible motion). Resetting inside the worklet guarantees the order
     * `bindings register → sv resets → withTiming starts` happens atomically
     * on MT.
     *
     * Why we don't `await` the worklet's Promise: `withTiming` returns a
     * Promise on MT, but Promises don't serialize across the BG/MT bridge —
     * `runOnMainThread`'s callback fires the moment the worklet *returns*
     * (synchronously, with `undefined` since the Promise can't cross), not
     * when the underlying animation finishes. We time the BG-side wait
     * against the duration we passed to MT instead.
     */
    async function animateProgress(
        sv: SharedValue<number> | undefined,
        seed: number | null,
        target: number,
        durationSec: number,
    ): Promise<void> {
        if (!sv) return;
        const runner = runOnMainThread((s: number | null, t: number, d: number) => {
            'main thread';
            // MT-side direct write — `sv.value` is a BG-side getter/setter
            // that emits a "read-only on BG" warning when set; the actual
            // MT field (which `withTiming`'s animate() reads as the start
            // value) is `sv.current.value`. See `packages/lynx-runtime/src/
            // animated/shared-value.ts:14-44`.
            // `seed` is null for sheet pops: the dedicated sheet SV already
            // holds the sheet's resting position and the animation runs
            // from there toward 0 — resetting would snap it off-screen.
            if (s !== null) sv.current.value = s;
            withTiming(sv, t, { duration: d });
        });
        runner(seed, target, durationSec);
        await new Promise<void>((resolve) => {
            setTimeout(resolve, Math.round(durationSec * 1000));
        });
    }

    const push: Nav['push'] = ((name: string, ...args: unknown[]) => {
        if (!routes[name]) {
            throw new Error(
                `[lynx-navigation] push('${name}'): route is not registered. ` +
                    `Known routes: ${Object.keys(routes).join(', ') || '(none)'}`,
            );
        }
        const { params, search, options } = unpackArgs(name, args, routes);

        // Escalate non-card presentations up the parent chain. Modals,
        // fullScreen, and transparent-modal routes belong on the root
        // navigator so they overlay tab UI and persistent chrome. We resolve
        // the presentation the same way `makeEntry` does so the escalation
        // decision matches what would actually be shown.
        const resolvedPresentation =
            (options?.presentation ?? routes[name].presentation ?? 'card') as Presentation;
        if (resolvedPresentation !== 'card' && parent) {
            // Walk straight to the root — every navigator with a parent
            // delegates non-card pushes upward, so a chain of any depth
            // collapses to a single push on the topmost nav.
            // Forward original args verbatim so overloads (`push(name)`,
            // `push(name, params)`, `push(name, params, search)`,
            // `push(name, params, search, options)`) keep their meaning.
            (parent.push as (n: string, ...a: unknown[]) => void)(name, ...args);
            return;
        }

        if (isTransitioning()) return;
        preloadRouteComponent(routes[name].component);
        const newEntry = makeEntry(name, params, search, options, routes);
        const cur = getStack();
        const prevTop = cur[cur.length - 1];

        // Sheets animate on the dedicated sheet SV (see `sheetProgress` in
        // CreateNavigatorOptions); everything else on the shared `progress`.
        const isSheet = newEntry.presentation === 'sheet';
        const sv = isSheet ? sheetProgress : progress;
        const animated = options?.animated !== false && !!sv;

        // Commit the stack append and the transition in a single batch so the
        // Stack renders once with both screens already present. Without the
        // batch, `@sigx/reactivity` flushes the stack write eagerly, producing
        // an intermediate render where only the new top is on the stack and
        // no transition is in flight — `computeLayers` would drop the
        // underneath and the Stack would remount it on the next render.
        // Append eagerly so the new entry is queryable immediately
        // (`nav.current` = newEntry); the slide animation overlays the visual.
        const txn: TransitionState = {
            kind: 'push',
            topEntry: newEntry,
            underneathEntry: prevTop,
            progress: sv,
        };
        batch(() => {
            setStack([...cur, newEntry]);
            if (animated) setTransition(txn);
        });

        // Sheet-target readers, shared by the non-animated "present at
        // detent" path directly below and the animated push further down.
        // `readSheetTarget` is the synchronous attempt (null until the
        // `<Screen snapPoints>` registration lands — see the readiness note);
        // `resolveSheetTarget` polls microtask→macrotask→default so a caller
        // that can't see the config synchronously still lands on the right
        // detent. On the real runtime the registration is deferred (it is
        // eager only under lynx-testing's flush, which is why only on-device
        // testing catches a wrong first-frame height).
        const readSheetTarget = (): { target: number; heightFraction: number } | null => {
            // Readiness signal is the REGISTRY's presence (EntryScope
            // registers it at mount, in the same flush that runs the
            // screen's `<Screen>` children) — not the snapPoints option:
            // a sheet relying on the default snap config never declares
            // one and must still resolve without the macrotask fallback.
            // (Lazy route bodies that register options later keep the
            // documented default-config caveat.)
            const reg = screens.get(newEntry.key);
            if (!reg) return null;
            const screenOpts = untrack(() => ({
                snapPoints: reg.options.snapPoints,
                initialSnapIndex: reg.options.initialSnapIndex,
                backdrop: reg.options.backdrop,
            }));
            // Resolve the backdrop preference off the SAME registration read
            // (the render path can't see it in time — see `_sheetBackdrops`).
            // Prune keys whose entries have left the stack so the record
            // can't grow across a session.
            const live = new Set(getStack().map((e) => e.key));
            const snaps = resolveSnapPoints(screenOpts.snapPoints);
            sheetBackdropsBox[newEntry.key] = screenOpts.backdrop !== false;
            sheetSnapsBox[newEntry.key] = snaps;
            for (const k of Object.keys(sheetBackdropsBox)) {
                if (k !== newEntry.key && !live.has(k)) delete sheetBackdropsBox[k];
            }
            for (const k of Object.keys(sheetSnapsBox)) {
                if (k !== newEntry.key && !live.has(k)) delete sheetSnapsBox[k];
            }
            const target = initialSnapProgress(snaps, screenOpts.initialSnapIndex);
            return { target, heightFraction: target * snaps[snaps.length - 1] };
        };
        const resolveSheetTarget = async (): Promise<{ target: number; heightFraction: number }> => {
            let read = readSheetTarget();
            if (read === null) {
                await Promise.resolve(); // microtask — usual flush boundary
                read = readSheetTarget();
            }
            if (read === null) {
                await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
                read = readSheetTarget();
            }
            if (read === null) {
                // Still unmounted (lazy route) — default snap config.
                const snaps = resolveSnapPoints(undefined);
                const target = initialSnapProgress(snaps, undefined);
                read = { target, heightFraction: target * snaps[snaps.length - 1] };
            }
            return read;
        };

        // A non-animated push commits the stack but runs no transition. For
        // a SHEET, still place it AT its initial detent (#711b): the caller
        // opens a sheet this way to present it at its resting height — behind
        // the soft keyboard, say — and let the keyboard's OWN dismissal
        // reveal it, the app animating nothing. `useSheetHeight` then reads
        // the detent height from frame one, so a composer bar bound to it
        // sits correct immediately (no V-dip from a 0→detent slide racing the
        // keyboard's descent). Seed off-screen first (a prior sheet can have
        // left the SV non-zero), then jump to the detent; both writes are
        // MT-ordered (#691), so when the detent is known synchronously the 0
        // never paints. If the `<Screen>` registration hasn't landed yet, the
        // jump defers like the animated path and the 0 seed holds the sheet
        // hidden meanwhile rather than flashing a stale height.
        if (!animated) {
            if (isSheet) {
                // Populate the render-time channels (_sheetBackdrops/_sheetSnaps)
                // for EVERY sheet push — INCLUDING when there's no progress SV
                // (`<NavigationRoot animated={false}>`), where the `&& sv` gate
                // used to skip this entirely and reintroduce the render-time
                // option-timing bug this channel exists to fix. The SV seed +
                // jump-to-detent only apply when the SV actually exists.
                const positionSheet = (target: number): void => {
                    if (!sv) return;
                    runOnMainThread(() => { 'main thread'; sv.current.value = 0; })();
                    const runner = runOnMainThread((t: number) => {
                        'main thread';
                        sv.current.value = t;
                    });
                    runner(target);
                };
                const readNow = readSheetTarget();   // populates the records
                if (readNow !== null) {
                    positionSheet(readNow.target);
                } else {
                    void resolveSheetTarget().then((read) => {
                        // `resolveSheetTarget` re-populates the records. The entry
                        // can have left the stack during the wait (e.g. a
                        // `reset()`); don't reposition a dead sheet.
                        const stackNow = getStack();
                        if (stackNow[stackNow.length - 1]?.key !== newEntry.key) return;
                        positionSheet(read.target);
                    });
                }
            }
            return;
        }

        // Completion guard: only clear the transition if it's still THIS
        // push's — a `reset()` (allowed mid-transition) can have cleared it
        // and a successor transition can have started before the timer
        // fires; clearing that one would cut the successor's animation off.
        // Compared by kind + entry key, not object identity — the signal
        // proxy wraps stored objects, so reads are never `===` the raw txn.
        const clearOwnTransition = () => {
            if (isOwnTransition(transitionBox.value, txn)) setTransition(null);
        };

        // Seed the sheet SV off-screen immediately: this render binds the
        // new sheet's layer to the SV, and a previously-open sheet can have
        // left it non-zero — without the seed, the new sheet flashes at the
        // stale height until the deferred animation start below resets it.
        if (isSheet && sv) {
            const seedRunner = runOnMainThread(() => {
                'main thread';
                sv.current.value = 0;
            });
            seedRunner();
        }

        // A sheet opens to its initial snap point, not progress 1. The snap
        // config comes from the `<Screen snapPoints>` registration; on the
        // real runtime it lands deferred, so `resolveSheetTarget` polls
        // microtask-first (the flush usually lands within a microtask; a
        // macrotask wait added a perceptible hesitation between tap and
        // slide), then macrotask, then the default snap config.
        const startSheetPush = async (): Promise<void> => {
            const read = await resolveSheetTarget();
            // The entry can have left the stack during the deferred wait
            // (e.g. a `reset()` — ordinary pops are blocked while the
            // transition is set). Don't animate the SV for a dead sheet.
            const stackNow = getStack();
            if (stackNow[stackNow.length - 1]?.key !== newEntry.key) return;
            return animateProgress(
                sv,
                0,
                read.target,
                sheetDurationSec(read.heightFraction, TRANSITION_DURATION_SEC),
            );
        };
        (isSheet
            ? startSheetPush()
            : animateProgress(sv, 0, 1, TRANSITION_DURATION_SEC)
        ).then(
            clearOwnTransition,
            clearOwnTransition, // best-effort cleanup on animation rejection
        );
    }) as Nav['push'];

    const replace: Nav['replace'] = ((name: string, ...args: unknown[]) => {
        if (isTransitioning()) return;
        const { params, search, options } = unpackArgs(name, args, routes);
        if (!routes[name]) {
            throw new Error(
                `[lynx-navigation] replace('${name}'): route is not registered.`,
            );
        }
        preloadRouteComponent(routes[name].component);
        const entry = makeEntry(name, params, search, options, routes);
        const cur = getStack();
        // Replace doesn't animate in v1 — it's a swap, not a forward/back nav.
        // Adding a fade-or-slide variant is a screen-option in Phase 0.5.
        setStack([...cur.slice(0, cur.length - 1), entry]);
    }) as Nav['replace'];

    function pop(count: number = 1, options?: PopOptions): void {
        if (isTransitioning()) return;
        const cur = getStack();
        const target = Math.max(1, cur.length - Math.max(1, count));
        if (target === cur.length) return;

        // A sheet pop animates the dedicated sheet SV from its resting
        // position back to 0 (off-screen); cards/modals animate the shared
        // `progress` 0 → 1 with kind-specific transforms.
        const isSheet = cur[cur.length - 1].presentation === 'sheet';
        const sv = isSheet ? sheetProgress : progress;
        const animated =
            options?.animated !== false && !!sv && count === 1 && cur.length >= 2;
        if (!animated) {
            // A non-animated SHEET dismissal (#711b) must return its SV to 0,
            // or `useSheetHeight` reports the last detent height with no sheet
            // on the stack — stranding a bar bound to it. Symmetric with the
            // non-animated push's detent seed. Only when a sheet actually
            // leaves (single top pop); a multi-step / non-sheet pop leaves the
            // SV alone.
            if (isSheet && sv && count === 1 && cur.length >= 2) {
                const resetRunner = runOnMainThread(() => {
                    'main thread';
                    sv.current.value = 0;
                });
                resetRunner();
            }
            setStack(cur.slice(0, target));
            return;
        }

        // Single-step animated pop: keep the popped entry on the stack until
        // the slide finishes, so `<Stack>` can render both screens during the
        // animation. The stack mutation happens on completion.
        const popping = cur[cur.length - 1];
        const next = cur[cur.length - 2];
        const txn: TransitionState = {
            kind: 'pop',
            topEntry: popping,
            underneathEntry: next,
            progress: sv,
        };
        setTransition(txn);

        // Batch so the commit (drop the popped entry) and clearing the
        // transition land in one render — no intermediate frame where the
        // stack has mutated but the transition is still in flight. On
        // animation failure, snap to the destination state anyway — leaving
        // the popped entry rendered would be more confusing than skipping
        // the animation. Guarded on the transition still being THIS pop's:
        // a `reset()` (allowed mid-transition) can have replaced the stack,
        // and committing the stale `cur` slice would overwrite it.
        const commitOwnPop = () => {
            if (!isOwnTransition(transitionBox.value, txn)) return;
            batch(() => {
                setStack(cur.slice(0, cur.length - 1));
                setTransition(null);
            });
        };
        // Sheet pop duration is velocity-matched like the push, derived
        // from the sheet's LIVE position: `sv.value` is the BG-readable
        // latest published snapshot (see SharedValue), so a sheet the user
        // dragged to another detent pops at the right speed too.
        let durationSec = TRANSITION_DURATION_SEC;
        if (isSheet && sv) {
            // The whole options read sits inside untrack — `options` is a
            // per-key reactive proxy, so reading `.snapPoints` outside the
            // block would subscribe whatever reactive scope pop() runs in.
            const snaps = untrack(() =>
                resolveSnapPoints(screens.get(popping.key)?.options.snapPoints),
            );
            durationSec = sheetDurationSec(
                sv.value * snaps[snaps.length - 1],
                TRANSITION_DURATION_SEC,
            );
        }
        animateProgress(sv, isSheet ? null : 0, isSheet ? 0 : 1, durationSec).then(
            commitOwnPop,
            commitOwnPop,
        );
    }

    function popTo(name: string): void {
        if (isTransitioning()) return;
        const cur = getStack();
        for (let i = cur.length - 1; i >= 0; i--) {
            if (cur[i].route === name) {
                if (i === cur.length - 1) return;
                setStack(cur.slice(0, i + 1));
                return;
            }
        }
    }

    function popToRoot(): void {
        if (isTransitioning()) return;
        const cur = getStack();
        if (cur.length <= 1) return;
        setStack([cur[0]]);
    }

    function reset(state: { stack: ReadonlyArray<StackEntry> }): void {
        if (state.stack.length === 0) {
            throw new Error('[lynx-navigation] reset() called with empty stack.');
        }
        batch(() => {
            setStack([...state.stack]);
            setTransition(null);
        });
    }

    function dismiss(): void {
        if (isTransitioning()) return;
        const cur = getStack();
        let i = cur.length - 1;
        while (i > 0 && cur[i].presentation !== 'card') {
            i--;
        }
        if (i < cur.length - 1) {
            setStack(cur.slice(0, i + 1));
        }
    }

    /**
     * Set up a gesture-driven pop transition. Same shape as `pop()` sets but
     * does NOT call `animateProgress` — the gesture worklet writes the
     * progress SV directly per frame, then animates to commit/cancel
     * endpoints on release before invoking `commitBackGesture` or
     * `cancelBackGesture` via `runOnBackground`.
     */
    function beginBackGesture(): void {
        if (isTransitioning()) return;
        const cur = getStack();
        if (cur.length < 2) return;
        const popping = cur[cur.length - 1];
        const next = cur[cur.length - 2];
        setTransition({
            kind: 'pop',
            topEntry: popping,
            underneathEntry: next,
            progress: progress as unknown,
        });
    }

    function commitBackGesture(): void {
        const cur = getStack();
        batch(() => {
            if (cur.length >= 2) {
                setStack(cur.slice(0, cur.length - 1));
            }
            setTransition(null);
        });
    }

    function cancelBackGesture(): void {
        setTransition(null);
    }

    /**
     * Commit a sheet drag-to-dismiss. The drag worklet already animated the
     * sheet SV to 0 — only the stack mutation remains. Unlike
     * `commitBackGesture` no transition was set during the drag (a resting
     * sheet's binding is live without one), and unlike `pop()` no animation
     * runs here. `expectedKey` pins the commit to the sheet the gesture was
     * for — it arrives via a BG `setTimeout`, so the top can have changed.
     */
    function commitSheetDismiss(expectedKey?: string): void {
        // A transition that started during the BG-timeout window (hardware
        // back, nav.pop()) owns the stack — mutating here would let its
        // completion callback later overwrite newer state with its stale
        // captured slice. If it's a pop of this same sheet, it lands the
        // same result anyway.
        if (isTransitioning()) return;
        const cur = getStack();
        const top = cur[cur.length - 1];
        if (cur.length < 2 || top.presentation !== 'sheet') return;
        if (expectedKey !== undefined && top.key !== expectedKey) return;
        setStack(cur.slice(0, cur.length - 1));
    }

    const nav: Nav = {
        push,
        replace,
        pop,
        popTo,
        popToRoot,
        reset,
        dismiss,
        get current() {
            return stackSignal[stackSignal.length - 1];
        },
        get stack() {
            return stackSignal;
        },
        get canGoBack() {
            return stackSignal.length > 1;
        },
        get parent() {
            return parent;
        },
        get isLocallyFocused() {
            return focusedBox.value;
        },
        get _children() {
            return children;
        },
        get transition() {
            return transitionBox.value;
        },
    };

    if (parent) {
        // Register with parent so root-level traversals (hardware back,
        // future deepest-focused queries) can reach this nav. The matching
        // `_children.delete(nav)` happens when the owning `<Stack>` unmounts;
        // see Stack.tsx.
        parent._children.add(nav);
    }

    function setLocallyFocused(focused: boolean): void {
        if (focusedBox.value === focused) return;
        focusedBox.value = focused;
    }

    return {
        nav,
        routes,
        _gesture: {
            beginBackGesture,
            commitBackGesture,
            cancelBackGesture,
            commitSheetDismiss,
        },
        _screens: screens,
        _sheetBackdrops: sheetBackdropsBox,
        _sheetSnaps: sheetSnapsBox,
        _setLocallyFocused: setLocallyFocused,
    };
}

/**
 * Map-backed `_screens` controller. Pulled out as a tiny factory so test
 * tooling can call it directly when asserting registry behaviour without
 * standing up an entire navigator.
 *
 * Not reactive — `<EntryScope>` registers once at setup and unregisters at
 * unmount, so reads from the navigator's chrome are point-in-time lookups,
 * and the registry's own internal signals carry the reactive payload.
 */
function createScreenRegistries(): NavigatorState['_screens'] {
    const byKey = new Map<string, ScreenRegistry>();
    // Reactive version tick — bumped on every register/unregister so consumers
    // (HeaderBar's computeds) re-evaluate their lookups when entries come and
    // go. `Map.get` itself isn't tracked, so without this a chrome component
    // that renders before its target entry mounts would never see the late
    // arrival of the registry.
    const version = signal({ v: 0 });
    return {
        register(reg: ScreenRegistry) {
            byKey.set(reg.entry.key, reg);
            // `register` is called from `<EntryScope>` setup, which itself
            // runs inside a tracked scope. Read-then-write on `version`
            // would self-loop, so we untrack the bump.
            untrack(() => { version.v = version.v + 1; });
        },
        // Identity-checked unregister: deletes the entry only if the
        // currently-registered registry is the *same instance* the caller
        // holds. Without this, the transition→idle handoff (which can
        // mount a new `<EntryScope>` for the same entry-key before the
        // old one unmounts) would let the old scope's `onUnmounted` wipe
        // out the fresh registry — leaving `screens.get(key)` returning
        // undefined and chrome consumers (NavHeader) falling back to the
        // route-name as title with all slot fills gone.
        unregister(reg: ScreenRegistry) {
            const cur = byKey.get(reg.entry.key);
            if (cur !== reg) return;
            byKey.delete(reg.entry.key);
            untrack(() => { version.v = version.v + 1; });
        },
        get(key: string) {
            // Touch the version signal so the caller's reactive scope
            // re-runs on the next register/unregister. The actual returned
            // value still comes from the plain Map — registries themselves
            // are signal-backed, so once a caller has one in hand they
            // track the bits they care about (options/slots) directly.
            void version.v;
            return byKey.get(key);
        },
    };
}
