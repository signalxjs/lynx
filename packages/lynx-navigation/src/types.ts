/**
 * Core types for @sigx/lynx-navigation.
 *
 * The type machinery here is the differentiating DX: route names, params, and
 * search are all inferred end-to-end from the user's `defineRoutes` call so
 * `nav.push('profile', { id: 42 })` is a TS error if `id` is typed as string.
 */

/**
 * Minimal Standard Schema spec subset — see https://standardschema.dev.
 * Inlined so we don't depend on `@standard-schema/spec` for the type spike.
 * Compatible with Zod, Valibot, ArkType, etc.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly '~standard': {
        readonly version: 1;
        readonly vendor: string;
        readonly types?: { readonly input: Input; readonly output: Output };
    };
}

/**
 * Infer the validated output type of a Standard Schema, falling back to
 * `unknown` for non-schema values.
 */
export type InferOutput<S> = S extends StandardSchemaV1<unknown, infer O> ? O : unknown;

/** Empty record — what `ParamsOf` returns when a route declares no schema. */
export type EmptyParams = Record<string, never>;

/**
 * How a route entry is presented on the stack.
 * `card` is the default push; `modal`/`fullScreen` slide up; `transparent-modal`
 * preserves the underlying screen visible (e.g. for popovers).
 */
export type Presentation = 'card' | 'modal' | 'fullScreen' | 'transparent-modal';

/**
 * A route definition entry.
 *
 * Users construct this via `defineRoutes({...})`. The `params` and `search`
 * schemas drive runtime validation AND TS inference for `useParams`,
 * `useSearch`, `nav.push`, `<Link>`, etc.
 *
 * `component` accepts an eager component factory or a lazy import — both shapes
 * resolve through sigx's `<Suspense>` boundary at render time.
 */
export interface RouteDefinition<
    Params extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
    Search extends StandardSchemaV1 | undefined = StandardSchemaV1 | undefined,
> {
    /** Component factory or lazy importer. */
    component: ComponentLike;
    /**
     * Fallback shown while a lazy `component` is loading.
     *
     * Set this only on routes whose `component` was created with `lazy(...)`.
     * The fallback is rendered inside a `<Suspense>` boundary wrapping the
     * screen mount, so the user sees this UI while the screen's chunk is
     * being fetched. When omitted, lazy routes still work — the caller is
     * responsible for placing its own `<Suspense>` boundary (e.g. above the
     * `<NavigationRoot>` or inside the screen component).
     *
     * Accepts a component factory (`MyLoadingScreen`) or a function returning
     * JSX (`() => <Spinner />`). Eager routes ignore this field.
     */
    fallback?: ComponentLike | (() => unknown);
    /** Standard-Schema validator for path params. Optional. */
    params?: Params;
    /** Standard-Schema validator for query/search params. Optional. */
    search?: Search;
    /** Optional URL pattern for deep-link serialization (e.g. `/users/:id`). */
    path?: string;
    /** Default presentation when this route is pushed. */
    presentation?: Presentation;
    /** Nested routes — share the URL/path namespace and may inherit options. */
    children?: Record<string, RouteDefinition>;
}

/**
 * The component shape we accept on a route. Kept structural so we don't pull
 * `ComponentFactory` from sigx at type level (avoids a hard dep on sigx purely
 * for types in the spike). Refined to a real ComponentFactory in Phase 0.1
 * runtime work.
 */
export type ComponentLike =
    | ((...args: any[]) => unknown)
    | (() => Promise<{ default: (...args: any[]) => unknown }>);

/**
 * Map of route definitions, as returned by `defineRoutes`. Keys are route
 * names; values are typed RouteDefinitions.
 */
export type RouteMap = Record<string, RouteDefinition>;

/**
 * Extract params type from a single RouteDefinition.
 * Falls back to `EmptyParams` when the route declares no schema.
 *
 * We use a structural `params: infer S` match (without an `extends
 * StandardSchemaV1` constraint on `S`) because TS conditional types treat the
 * generic-defaulted `StandardSchemaV1<unknown, unknown>` as invariant in this
 * position — a schema typed `StandardSchemaV1<{id:string}>` does not match
 * `extends StandardSchemaV1` reliably under `<const T>` inference. `InferOutput`
 * gracefully handles non-schema `S` by returning `unknown`.
 */
export type ParamsOf<R> = R extends { params: infer S } ? InferOutput<S> : EmptyParams;

/**
 * Extract search type from a single RouteDefinition.
 * Falls back to `EmptyParams` when the route declares no schema.
 */
export type SearchOf<R> = R extends { search: infer S } ? InferOutput<S> : EmptyParams;

/**
 * Whether a route requires a `params` argument when calling `nav.push` etc.
 * True iff the route definition has a `params` field.
 */
export type RouteRequiresParams<R> = R extends { params: object } ? true : false;

/**
 * Per-entry state stored on the stack signal.
 *
 * `key` is unique per entry — needed because the same route can appear more
 * than once (e.g. profile A → message → profile A again). Focus state and
 * scroll position are keyed by `key`, not by route name.
 */
export interface StackEntry<R extends string = string, P = unknown, S = unknown> {
    readonly key: string;
    readonly route: R;
    readonly params: P;
    readonly search: S;
    /** User state — survives suspend/restore. */
    state: unknown;
    readonly presentation: Presentation;
}

/** Options accepted by `nav.push` / `nav.replace`. */
export interface PushOptions {
    /** Override the route's default presentation for this navigation. */
    presentation?: Presentation;
    /** User state to attach to the new entry. Survives suspend/restore. */
    state?: unknown;
    /**
     * Skip the slide animation (instant swap). Defaults to true on platforms
     * where `useAnimatedStyle` isn't available (test renderer); defaults to
     * false on real Lynx. Tests can force `false` to keep assertions
     * deterministic.
     */
    animated?: boolean;
}

/** Options accepted by `nav.pop`. */
export interface PopOptions {
    /** Skip the slide animation (instant swap). See `PushOptions.animated`. */
    animated?: boolean;
}

/**
 * Direction of an in-flight transition.
 *  - `push`: a new entry is animating in (progress 0 → 1).
 *  - `pop`:  the current top is animating out (progress 0 → 1, then committed).
 */
export type TransitionKind = 'push' | 'pop';

/** Role of a screen during a transition — determines its transform formula. */
export type TransitionRole = 'top' | 'underneath';

/**
 * Snapshot of an in-flight transition. Stored on the navigator state so the
 * `<Stack>` component knows to render two entries (`topEntry` above
 * `underneathEntry`) and bind their transforms to `progress`.
 *
 * `progress` is a `SharedValue<number>` (re-exported as `unknown` here to
 * avoid a hard dep on `@sigx/lynx`'s SharedValue type at the contract level —
 * the runtime `<Stack>` casts as needed). The value runs 0 → 1 in both push
 * and pop, with the role/kind pair determining the visual direction.
 */
export interface TransitionState {
    readonly kind: TransitionKind;
    readonly topEntry: StackEntry;
    readonly underneathEntry: StackEntry;
    /** Animation progress signal — typed loosely; cast at the runtime boundary. */
    readonly progress: unknown;
}

/**
 * Per-screen display options written by `<Screen>` into its entry's registry.
 *
 * Read by persistent navigator chrome (the `<HeaderBar>` shipped in the
 * `header` slice; `<TabBar>` later). All fields are optional — consumers
 * apply sensible defaults (headerShown defaults to true, gestureEnabled to
 * true, title falls back to the route name).
 *
 * `title` accepts a function so the header can be derived from reactive
 * state (e.g. a user's display name signal). Plain strings are wrapped in
 * a thunk by consumers when read.
 */
export interface ScreenOptions {
    /** Header title. Either a static string or a getter (re-tracked each render). */
    title?: string | (() => string);
    /** When false, the navigator's header is hidden for this screen. Default true. */
    headerShown?: boolean;
    /** When false, the iOS edge-swipe-back gesture is disabled for this screen. Default true. */
    gestureEnabled?: boolean;
}

/**
 * Slot fills written by `<Screen.Header>` / `<Screen.HeaderLeft>` /
 * `<Screen.HeaderRight>` / `<Screen.TabBarItem>`.
 *
 * Each fill is the rendered output of that sub-component's `default` slot,
 * captured as a thunk so the navigator's persistent chrome can call it at
 * render time. `tabBarItem` is a scoped slot — the consumer passes
 * `{ active }` so the same screen's tab-bar item can style itself
 * differently when focused vs. not.
 */
export interface ScreenSlotFills {
    /** Full header replacement. When set, takes precedence over title + headerLeft/Right. */
    header?: () => unknown;
    /** Left-side header content (typically back arrow override). */
    headerLeft?: () => unknown;
    /** Right-side header content (typically action buttons). */
    headerRight?: () => unknown;
    /** Tab-bar item — scoped slot receives `{ active }` indicating focus. */
    tabBarItem?: (ctx: { active: boolean }) => unknown;
}
