import { defineInjectable } from '@sigx/lynx';
import type { RegisteredRoutes, RouteId, RouteParams, RouteSearch } from '../register.js';
import type {
    PopOptions,
    PushOptions,
    RouteRequiresParams,
    StackEntry,
    TransitionState,
} from '../types.js';

/**
 * Subset of registered route names that declare a `params` schema (and so
 * require a `params` argument when navigating).
 *
 * Computed via mapped-type filtering rather than a conditional inside the
 * method signature: when a conditional like `RouteRequiresParams<R[K]>` is
 * embedded inside a generic method parameter, TS evaluates it at definition
 * time with K bound to the *whole* union of route ids — which distributes
 * `RouteRequiresParams` over every route and collapses the result to
 * `boolean`, breaking the conditional. Filtering once at the type level avoids
 * the issue and produces clean overload candidates.
 */
export type RoutesWithParams = {
    [K in RouteId]: RouteRequiresParams<RegisteredRoutes[K]> extends true ? K : never;
}[RouteId];

/** Routes that don't declare a `params` schema. */
export type RoutesWithoutParams = Exclude<RouteId, RoutesWithParams>;

/**
 * The navigator handle returned by `useNav()`.
 *
 * Read access (`current`, `stack`, `canGoBack`) is reactive — these properties
 * are getters that read from the underlying stack signal, so accessing them
 * inside a component's render function (or inside `effect` / `computed`) takes
 * a reactive dependency. Mutating methods (`push`, `pop`, etc.) trigger the
 * dependents to update.
 *
 * `push` and `replace` are split into two overloads — one for routes without a
 * params schema (no params arg) and one for routes with a params schema
 * (params required). See `RoutesWithParams` above for why this isn't a single
 * conditional return type.
 */
export interface Nav {
    /** Push a route that has no params schema. */
    push<K extends RoutesWithoutParams>(
        name: K,
        search?: RouteSearch<K>,
        options?: PushOptions,
    ): void;
    /** Push a route that requires params. */
    push<K extends RoutesWithParams>(
        name: K,
        params: RouteParams<K>,
        search?: RouteSearch<K>,
        options?: PushOptions,
    ): void;

    /** Replace the top entry — same overload pattern as push. */
    replace<K extends RoutesWithoutParams>(
        name: K,
        search?: RouteSearch<K>,
        options?: PushOptions,
    ): void;
    replace<K extends RoutesWithParams>(
        name: K,
        params: RouteParams<K>,
        search?: RouteSearch<K>,
        options?: PushOptions,
    ): void;

    /** Pop one or more entries off the top of the stack. */
    pop(count?: number, options?: PopOptions): void;

    /** Pop entries until the named route is at the top. */
    popTo<K extends RouteId>(name: K): void;

    /** Pop all the way to the root entry. */
    popToRoot(): void;

    /** Wholesale-replace the stack. */
    reset(state: { stack: ReadonlyArray<StackEntry> }): void;

    /** Dismiss the topmost modal stack (no-op if none active). */
    dismiss(): void;

    /** Currently-focused entry. Reactive via property access. */
    readonly current: StackEntry;

    /** Full stack, top last. Reactive. */
    readonly stack: ReadonlyArray<StackEntry>;

    /** Whether the user can go back from the current entry. Reactive. */
    readonly canGoBack: boolean;

    /** Parent navigator (e.g. the Tabs above this Stack), or null at the root. */
    readonly parent: Nav | null;

    /**
     * In-flight transition, or null when navigation is at rest. Reactive —
     * `<Stack>` reads this to decide whether to render one screen or two
     * (during a slide transition both the outgoing and incoming screens
     * stay mounted with `useAnimatedStyle`-driven transforms).
     */
    readonly transition: TransitionState | null;
}

/**
 * Access the innermost navigator. Provided by `<NavigationRoot>` via
 * `defineProvide`. Throws when called outside a NavigationRoot subtree.
 *
 * Mirrors `@sigx/router`'s `useRouter` pattern (`packages/router/src/router.ts:30`).
 */
export const useNav = defineInjectable<Nav>(() => {
    throw new Error(
        '[lynx-navigation] useNav() called but no <NavigationRoot> is mounted in the component tree.',
    );
});
