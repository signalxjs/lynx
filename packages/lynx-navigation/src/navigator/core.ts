import {
    batch,
    pendingOps,
    runOnMainThread,
    signal,
    untrack,
    waitForFlush,
    type Signal,
    type SharedValue,
} from '@sigx/lynx';
import { isLazyComponent } from '@sigx/lynx';
import { cancelAnimation, withTiming } from '@sigx/lynx-motion';
import { revealDurationSec } from '@sigx/lynx-sheet';
import { fail } from '../errors.js';
import type { Nav } from '../hooks/use-nav.js';
import type { ScreenRegistry } from '../internal/screen-registry.js';
import {
    initialDetentPx,
    resolveRouteDetents,
} from '../internal/sheet-detents.js';
import { screenHeight } from '../internal/screen-width.js';
import { isOverlayPresentation } from '../internal/layer-plan.js';
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
     * Internal: resolved detents (ascending px) per sheet entry, populated
     * at push time from the SAME registration read as `_sheetBackdrops`
     * (above) — for the identical reason. The sheet LAYER's translateY
     * mapper scales by the largest detent px, and a render-time read gets
     * the half-screen default before the sheet's `<Screen detents>`
     * registers (and doesn't reactively correct), so the sheet renders at
     * the wrong height while `useSheetHeight` (reactive) reads the real
     * height — the two disagree and the sheet paints too short. `<Stack>`
     * prefers this reactive record. Absent key ⇒ fall back to the
     * render-time option / default.
     */
    readonly _sheetDetents: Signal<Record<string, readonly number[]>>;
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
 * Upper bound on the pre-stage settle window (#651). Typical settles are one
 * or two rounds (~a frame); the cap only bites on screens that never go
 * quiet (polling loops, streaming data), which get a best-effort pre-stage
 * instead of a stalled transition.
 */
const PRE_STAGE_MAX_MS = 160;

/**
 * Park progress for a pre-staging card/modal push (#651). Not exactly 0: a
 * fully off-screen layer's texture is culled and never rasterized, so the
 * first animation frame would pay the whole screen's raster cost — measured
 * as one ~36ms frame right at motion onset. Parking with a ~2px sliver
 * on-screen (0.002 of the travel) forces the raster during the settle
 * window instead. Sheets keep an exact 0 seed: `useSheetHeight` consumers
 * read the SV as a real height.
 */
const PRE_STAGE_PEEK = 0.002;

/**
 * How long to wait for the main thread to acknowledge the landing write before
 * clearing the transition anyway. The ack normally arrives within a frame; this
 * only exists so a dropped one cannot wedge navigation permanently (#1021).
 */
const LANDING_ACK_TIMEOUT_MS = 500;

/**
 * Pre-stage settle window (#651): hold the transition start until the BG→MT
 * pipeline goes quiet.
 *
 * An animated push/pop commits its render first, and the incoming screen
 * mounts parked off-screen (its transition SV is seeded 0 IN-STREAM ahead of
 * this wait, so the park applies in the same MT batch as the mount). Each
 * round awaits the in-flight ops batch's MT ack, then yields a macrotask so
 * post-mount effects run and emit their follow-up ops (and the MT gets a
 * beat for native layout + list cell pulls between batches). When no ops are
 * pending anymore, the screen is fully built — `withTiming` then animates a
 * finished tree instead of competing with its construction mid-slide.
 */
async function settleBeforeTransition(): Promise<void> {
    const deadline = Date.now() + PRE_STAGE_MAX_MS;
    do {
        // Race the ack against the remaining budget. `PRE_STAGE_MAX_MS` used
        // to bound only the LOOP — `await waitForFlush()` itself is unbounded,
        // and its promise settles only when the host invokes the
        // `callLepusMethod` callback for that batch. A single dropped ack left
        // `pendingOps()` true forever, so this await never resumed: the
        // transition never started (the incoming screen stayed parked at its
        // pre-stage transform) AND the transition signal was never cleared, so
        // `isTransitioning()` blocked every later push and pop for the rest of
        // the session. Timing out degrades to "no pre-stage", never a wedge.
        await Promise.race([
            waitForFlush(),
            new Promise<void>((resolve) => {
                setTimeout(resolve, Math.max(0, deadline - Date.now()));
            }),
        ]);
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    } while (pendingOps() && Date.now() < deadline);
}

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
     * Dedicated SharedValue for `presentation: 'sheet'` entries, carrying
     * reveal-px semantics (visible height: 0 = off-screen). Separate from
     * `progress` because that SV is reset to 0 inside the MT worklet at
     * the start of every transition — a resting sheet must hold its position
     * across unrelated navigations, so its binding lives on an SV only sheet
     * code writes. Only meaningful on the root navigator (sheets escalate);
     * undefined disables sheet animation (tests / nested navs).
     */
    sheetReveal?: SharedValue<number>;
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
    const { routes, initial, progress, sheetReveal, parent = null } = opts;

    // Hoisted (rather than created inline in the return) because `push`
    // reads a just-mounted sheet screen's options to compute its open
    // animation target.
    const screens = createScreenRegistries();

    // Resolved `backdrop` per sheet entry — written at push (deferred read),
    // read reactively by `<Stack>`. A deep-reactive record: writing a key
    // notifies exactly that key's readers.
    const sheetBackdropsBox = signal<Record<string, boolean>>({});
    const sheetDetentsBox = signal<Record<string, readonly number[]>>({});

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
        if (next === null) drainQueuedIntent();
    }

    /**
     * Whether a transition is currently in flight. Concurrent navigation is
     * not run against it — see `queueIntent` for what happens instead.
     */
    function isTransitioning(): boolean {
        return transitionBox.value !== null;
    }

    /**
     * How long a queued intent stays replayable. Comfortably longer than a
     * transition (settle + 280 ms slide + landing ack), so a real press is
     * never lost; short enough that a press abandoned during a long stall
     * doesn't resurrect a navigation the user stopped expecting.
     */
    const QUEUED_INTENT_MAX_AGE_MS = 1000;

    interface QueuedIntent {
        run: () => void;
        at: number;
        /** True when the intent's outcome already holds — don't replay it. */
        satisfied: () => boolean;
    }
    let queuedIntent: QueuedIntent | null = null;

    /**
     * Remember a navigation requested mid-transition, to replay when that
     * transition clears.
     *
     * Dropping it outright (the previous behavior) reads as a dead tap,
     * because a transition outlives its own slide: `animateProgress` awaits a
     * main-thread landing ack after the duration elapses, so a press arriving
     * once the animation LOOKS finished still hits the guard. Measured on
     * device (#849): tapping a row 500 ms after popping the Chat composer did
     * nothing, while the same tap a moment later worked — and `Home.tsx`
     * fires a selection haptic before calling `push`, so the dead tap even
     * buzzed.
     *
     * Only the most recent intent is kept, and only discrete user-initiated
     * navigation is queued. Gesture starts (`beginBackGesture`,
     * `commitSheetDismiss`) are still dropped: replaying the beginning of a
     * gesture that is long over is meaningless. `popTo` / `popToRoot` /
     * `dismiss` are likewise still dropped — they're programmatic jumps
     * where a late replay is more surprising than a no-op.
     */
    function queueIntent(run: () => void, satisfied: () => boolean): void {
        queuedIntent = { run, at: Date.now(), satisfied };
    }

    /**
     * Whether the top entry already IS this navigation's target — params and
     * search included, not just the route name. Route alone is too coarse:
     * quickly picking two different rows that both push `profile` would see
     * the first one land and drop the second as a "duplicate".
     *
     * Compared structurally, not by identity: entries are read back through
     * the stack signal's proxy, so a stored object is never `===` the raw one
     * that was passed in.
     */
    function topIsAlready(name: string, params: unknown, search: unknown): boolean {
        const s = getStack();
        const top = s[s.length - 1];
        if (!top || top.route !== name) return false;
        return norm(top.params) === norm(params) && norm(top.search) === norm(search);
    }

    /**
     * Canonical form for a params/search bag, for the comparison above.
     * Absent, null and `{}` all mean "no params" — a param-free route is
     * called as `push('settings')` but stores `{}` — and keys are sorted so
     * two equal bags built in different orders still match.
     */
    function norm(v: unknown): string {
        if (v === undefined || v === null) return '';
        try {
            if (typeof v !== 'object') {
                // Functions and symbols stringify to undefined WITHOUT
                // throwing. Collapsing that to '' would read as "no params"
                // and could suppress a legitimate replay.
                return JSON.stringify(v) ?? incomparable();
            }
            const proto = Object.getPrototypeOf(v) as unknown;
            if (proto !== Object.prototype && proto !== null) {
                // Arrays, Dates, class instances: canonicalize the value
                // itself. Enumerating keys would flatten every one of them to
                // the same empty result, making two different Dates look
                // equal - and equal to "no params" besides.
                return JSON.stringify(v) ?? incomparable();
            }
            const o = v as Record<string, unknown>;
            const keys = Object.keys(o).sort();
            if (keys.length === 0) return '';
            return JSON.stringify(keys.map((k) => [k, o[k]])) ?? incomparable();
        } catch {
            // Params are user data: a BigInt or a circular reference makes
            // `JSON.stringify` throw, and this runs inside the replay
            // microtask where that would become an unhandled rejection and
            // strand the navigation. A bag we can't canonicalize is treated as
            // "not equal to anything", so the intent replays — navigating one
            // time too many is far better than silently swallowing the press.
            return incomparable();
        }
    }

    /**
     * A value that equals no other `norm()` result, not even another
     * incomparable one — hence the per-call counter. Used wherever a bag
     * cannot be canonicalized, so the intent replays: navigating one time too
     * many beats silently swallowing the press.
     */
    function incomparable(): string {
        incomparableSeq += 1;
        return `incomparable:${incomparableSeq}`;
    }

    /**
     * Counter behind the `incomparable:*` sentinel in `norm()`. Bumped per
     * call, so two bags that both failed to canonicalize are never equal to
     * each other either.
     */
    let incomparableSeq = 0;

    function drainQueuedIntent(): void {
        const q = queuedIntent;
        if (!q) return;
        queuedIntent = null;
        // Off the current task: `setTransition(null)` runs inside the pop's
        // commit `batch()`, and starting the next navigation mid-batch would
        // interleave two stack mutations into one render.
        void Promise.resolve().then(() => {
            // Something else already claimed the navigator, the press is
            // stale, or its outcome already holds (a double tap queues the
            // same push twice — the replay must not stack a duplicate).
            if (isTransitioning()) return;
            if (Date.now() - q.at > QUEUED_INTENT_MAX_AGE_MS) return;
            if (q.satisfied()) return;
            q.run();
        });
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
        stillCurrent?: () => boolean,
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
        // Land the end state (#758). The wait above is BG wall-clock, but the
        // tween is frame-driven on the MT: a main thread busy building the
        // incoming screen (long lists, native layout) can still be mid-slide
        // when this resolves. The caller then settles the layer, which
        // UNREGISTERS its animated style binding (`Layer.tsx` — required, the
        // progress SV is shared with the next transition) — and whatever
        // transform the tween last applied STAYS on the element, because the
        // BG-side style diff never knew about it. The screen rests tens of px
        // off, permanently, with the previous one showing through the gap.
        //
        // So don't let the resting position depend on the tween finishing in
        // time: cancel it and write the target outright. A no-op when the
        // animation already landed (same value, no style op).
        if (stillCurrent && !stillCurrent()) return;
        const lander = runOnMainThread((t: number) => {
            'main thread';
            // Cancel FIRST: a bare SV write doesn't stop an in-flight tween
            // (lynx-motion contract), so its remaining ticks would overwrite
            // the landing.
            cancelAnimation(sv);
            sv.current.value = t;
        });
        // Awaited so the write is applied on the MT before the caller clears
        // the transition and the unbind ops go out.
        //
        // Bounded, because this await gates `clearOwnTransition` and a set
        // transition blocks every push and pop. `runOnMainThread` resolves on
        // a main-thread batch ack (`waitForFlush`), so a dropped or delayed
        // ack would otherwise hang here forever and wedge navigation for the
        // rest of the session — taps still fire their haptics, nothing moves,
        // and there is no error anywhere (#1021). Landing the end state is
        // best-effort by nature; a resting transform that is a few pixels off
        // is a far better failure than an app that cannot navigate.
        await Promise.race([
            lander(target),
            new Promise<void>((resolve) => {
                setTimeout(resolve, LANDING_ACK_TIMEOUT_MS);
            }),
        ]);
    }

    const push: Nav['push'] = ((name: string, ...args: unknown[]) => {
        if (!routes[name]) {
            fail(
                'route_not_registered',
                `push('${name}')`,
                `route is not registered. Known routes: ${Object.keys(routes).join(', ') || '(none)'}`,
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

        if (isTransitioning()) {
            queueIntent(
                () => { (push as (n: string, ...a: unknown[]) => void)(name, ...args); },
                // This exact screen is already on top — a second queued tap on
                // the same row must not stack a duplicate.
                () => topIsAlready(name, params, search),
            );
            return;
        }
        preloadRouteComponent(routes[name].component);
        const newEntry = makeEntry(name, params, search, options, routes);
        const cur = getStack();
        const prevTop = cur[cur.length - 1];

        // Sheets animate on the dedicated sheet SV (see `sheetReveal` in
        // CreateNavigatorOptions); everything else on the shared `progress`.
        const isSheet = newEntry.presentation === 'sheet';
        const sv = isSheet ? sheetReveal : progress;
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
        // `<Screen detents>` registration lands — see the readiness note);
        // `resolveSheetTarget` polls microtask→macrotask→default so a caller
        // that can't see the config synchronously still lands on the right
        // detent. On the real runtime the registration is deferred (it is
        // eager only under lynx-testing's flush, which is why only on-device
        // testing catches a wrong first-frame height). `restPx` is the
        // resting reveal in px — the sheet SV's unit.
        const readSheetTarget = (): { restPx: number } | null => {
            // Readiness signal is the REGISTRY's presence (EntryScope
            // registers it at mount, in the same flush that runs the
            // screen's `<Screen>` children) — not the detents option:
            // a sheet relying on the default detent config never declares
            // one and must still resolve without the macrotask fallback.
            // (Lazy route bodies that register options later keep the
            // documented default-config caveat.)
            const reg = screens.get(newEntry.key);
            if (!reg) return null;
            const screenOpts = untrack(() => ({
                detents: reg.options.detents,
                initialDetentIndex: reg.options.initialDetentIndex,
                backdrop: reg.options.backdrop,
            }));
            // Resolve the backdrop preference off the SAME registration read
            // (the render path can't see it in time — see `_sheetBackdrops`).
            // Prune keys whose entries have left the stack so the record
            // can't grow across a session.
            const live = new Set(getStack().map((e) => e.key));
            const detentsPx = resolveRouteDetents(screenOpts.detents);
            sheetBackdropsBox[newEntry.key] = screenOpts.backdrop !== false;
            sheetDetentsBox[newEntry.key] = detentsPx;
            for (const k of Object.keys(sheetBackdropsBox)) {
                if (k !== newEntry.key && !live.has(k)) delete sheetBackdropsBox[k];
            }
            for (const k of Object.keys(sheetDetentsBox)) {
                if (k !== newEntry.key && !live.has(k)) delete sheetDetentsBox[k];
            }
            return { restPx: initialDetentPx(detentsPx, screenOpts.initialDetentIndex) };
        };
        const resolveSheetTarget = async (): Promise<{ restPx: number }> => {
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
                // Still unmounted (lazy route) — default detent config.
                const detentsPx = resolveRouteDetents(undefined);
                read = { restPx: initialDetentPx(detentsPx, undefined) };
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
                // Populate the render-time channels (_sheetBackdrops/_sheetDetents)
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
                    positionSheet(readNow.restPx);
                } else {
                    void resolveSheetTarget().then((read) => {
                        // `resolveSheetTarget` re-populates the records. The entry
                        // can have left the stack during the wait (e.g. a
                        // `reset()`); don't reposition a dead sheet.
                        const stackNow = getStack();
                        if (stackNow[stackNow.length - 1]?.key !== newEntry.key) return;
                        positionSheet(read.restPx);
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

        // Seed the SV off-screen immediately — IN-STREAM, so the park applies
        // in the same MT batch as this render's mount ops and binding
        // registrations. Two reasons:
        //  - Sheets: a previously-open sheet can have left the SV non-zero;
        //    without the seed the new sheet flashes at the stale height.
        //  - Cards/modals (#651): the animation start is now deferred behind
        //    `settleBeforeTransition()`, and the fresh bindings would snapshot
        //    the SV at its previous end-state (1) — painting the incoming
        //    screen fully presented during the settle window. Seeded to
        //    PRE_STAGE_PEEK (a ~2px sliver on-screen, so the texture
        //    rasterizes), the incoming layer PRE-STAGES effectively parked:
        //    it mounts, lays out, and pulls its list cells while the
        //    outgoing screen is still presented.
        if (sv) {
            const seedRunner = runOnMainThread((park: number) => {
                'main thread';
                sv.current.value = park;
            });
            // Cards/modals park with a sliver on-screen so the layer's
            // texture rasterizes during the settle window (PRE_STAGE_PEEK);
            // sheets park exactly off-screen — their SV doubles as a height
            // input (useSheetHeight) and must read 0 while closed.
            seedRunner(isSheet ? 0 : PRE_STAGE_PEEK);
        }

        // A sheet opens to its initial detent (reveal px), not full-screen.
        // The detent config comes from the `<Screen detents>` registration;
        // on the real runtime it lands deferred, so `resolveSheetTarget`
        // polls microtask-first (the flush usually lands within a microtask;
        // a macrotask wait added a perceptible hesitation between tap and
        // slide), then macrotask, then the default detent config.
        const startSheetPush = async (): Promise<void> => {
            // Pre-stage first: by the time the settle window closes, the
            // sheet's `<Screen>` registration has virtually always landed,
            // so the target read below resolves synchronously.
            await settleBeforeTransition();
            const read = await resolveSheetTarget();
            // The entry can have left the stack during the deferred wait
            // (e.g. a `reset()` — ordinary pops are blocked while the
            // transition is set). Don't animate the SV for a dead sheet.
            const stackNow = getStack();
            if (stackNow[stackNow.length - 1]?.key !== newEntry.key) return;
            return animateProgress(
                sv,
                0,
                read.restPx,
                // Velocity-matched to the card/modal slide: the fraction of
                // the screen the sheet travels (0 → restPx).
                revealDurationSec(read.restPx / screenHeight(), TRANSITION_DURATION_SEC),
                // A reset() can land DURING the slide and start a successor
                // transition on the same shared SV — landing this one then
                // would stomp it. Same identity check the completion callback
                // uses, re-evaluated after the wait.
                () => isOwnTransition(transitionBox.value, txn),
            );
        };
        const startCardPush = async (): Promise<void> => {
            await settleBeforeTransition();
            // Same dead-push guard as the sheet path: a `reset()` during the
            // settle window can have replaced the stack.
            const stackNow = getStack();
            if (stackNow[stackNow.length - 1]?.key !== newEntry.key) return;
            // seed null: the SV was parked at PRE_STAGE_PEEK in-stream above;
            // re-seeding 0 here would snap the layer fully off-screen for a
            // frame (backwards jump) and un-rasterize the peeked texture.
            return animateProgress(
                sv,
                null,
                1,
                TRANSITION_DURATION_SEC,
                () => isOwnTransition(transitionBox.value, txn),
            );
        };
        (isSheet ? startSheetPush() : startCardPush()).then(
            clearOwnTransition,
            clearOwnTransition, // best-effort cleanup on animation rejection
        );
    }) as Nav['push'];

    const replace: Nav['replace'] = ((name: string, ...args: unknown[]) => {
        // Validate and unpack BEFORE the transition gate, so a bad route
        // throws synchronously whether or not a transition happens to be in
        // flight. Deferring it would surface the error inside the replay's
        // microtask instead — an unhandled rejection at a random later moment.
        if (!routes[name]) {
            fail('route_not_registered', `replace('${name}')`, 'route is not registered.');
        }
        const { params, search, options } = unpackArgs(name, args, routes);
        if (isTransitioning()) {
            queueIntent(
                () => { (replace as (n: string, ...a: unknown[]) => void)(name, ...args); },
                () => topIsAlready(name, params, search),
            );
            return;
        }
        preloadRouteComponent(routes[name].component);
        const entry = makeEntry(name, params, search, options, routes);
        const cur = getStack();
        // Replace doesn't animate in v1 — it's a swap, not a forward/back nav.
        // Adding a fade-or-slide variant is a screen-option in Phase 0.5.
        setStack([...cur.slice(0, cur.length - 1), entry]);
    }) as Nav['replace'];

    function pop(count: number = 1, options?: PopOptions): void {
        if (isTransitioning()) {
            // Keyed on the entry this press meant to dismiss: if that screen
            // is already gone by the time the transition clears (the in-flight
            // transition was itself its pop), the press has been served — so a
            // second impatient back tap can't pop an extra screen behind it.
            const stackNow = getStack();
            const targetKey = stackNow[stackNow.length - 1]?.key;
            queueIntent(
                () => { pop(count, options); },
                () => !getStack().some((e) => e.key === targetKey),
            );
            return;
        }
        const cur = getStack();
        const target = Math.max(1, cur.length - Math.max(1, count));
        if (target === cur.length) return;

        // A sheet pop animates the dedicated sheet SV from its resting
        // reveal back to 0 (off-screen); cards/modals animate the shared
        // `progress` 0 → 1 with kind-specific transforms.
        const isSheet = cur[cur.length - 1].presentation === 'sheet';
        const sv = isSheet ? sheetReveal : progress;
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

        // Seed 0 IN-STREAM, in the same flush as this render's binding
        // registrations: the pop bindings snapshot the SV at its previous
        // end-state (1), which maps the top card fully slid-out — without
        // the seed it would vanish for the settle window below. Sheets skip
        // the seed: the sheet SV holds the resting position the pop
        // animates from (resetting would snap it off-screen).
        if (!isSheet && sv) {
            const seedRunner = runOnMainThread(() => {
                'main thread';
                sv.current.value = 0;
            });
            seedRunner();
        }

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
        // latest published snapshot (see SharedValue) in reveal px, so a
        // sheet the user dragged to another detent pops at the right speed
        // too — no detent-config read needed, the SV already carries px.
        let durationSec = TRANSITION_DURATION_SEC;
        if (isSheet && sv) {
            durationSec = revealDurationSec(
                sv.value / screenHeight(),
                TRANSITION_DURATION_SEC,
            );
        }
        // Pre-stage the reveal (#651): un-hiding the underneath layer
        // (display none → flex) relayouts its whole subtree — let that land
        // while the top card still covers it, then slide over a settled tree.
        //
        // Only a CARD pop un-hides anything. An overlay pop (modal / sheet)
        // reveals a layer that was never hidden — `computeLayers` keeps the
        // whole static run below an overlay at `hidden: false`, laid out and
        // composited the entire time the overlay is up. There is nothing to
        // stage, so the settle is pure dead time before the slide, and on a
        // heavy screen `pendingOps()` never goes quiet so it costs the full
        // `PRE_STAGE_MAX_MS`. Measured on device (#849): popping the Chat
        // composer repainted the header instantly and then sat still, with
        // only 2-3 frames in the 400 ms after the press, versus 35-37 for a
        // light screen.
        const needsPreStage = !isOverlayPresentation(popping.presentation);
        const startPop = async (): Promise<void> => {
            if (needsPreStage) await settleBeforeTransition();
            // A reset() during the settle window can have replaced the
            // stack/transition; don't animate the stale pop over it.
            if (!isOwnTransition(transitionBox.value, txn)) return;
            // seed null for cards too: the pop pre-seeded 0 in-stream above,
            // so the worklet-side reset is redundant (and the in-stream seed
            // already carries the bindings-before-reset ordering guarantee).
            return animateProgress(
                sv,
                null,
                isSheet ? 0 : 1,
                durationSec,
                () => isOwnTransition(transitionBox.value, txn),
            );
        };
        startPop().then(commitOwnPop, commitOwnPop);
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
            fail('invalid_stack', 'reset()', 'called with an empty stack.');
        }
        // Discard any intent queued against the OUTGOING stack. `reset` is a
        // wholesale state replacement — a deep link, a session restore — and
        // its `setTransition(null)` would otherwise drain the queue onto the
        // stack it just installed. `topIsAlready` can't catch that: the
        // replayed screen usually isn't on the new stack at all, so the guard
        // says "not satisfied" and the restore lands somewhere the caller
        // never asked for.
        queuedIntent = null;
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
        _sheetDetents: sheetDetentsBox,
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
