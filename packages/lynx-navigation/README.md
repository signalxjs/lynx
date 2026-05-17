# @sigx/lynx-navigation

Type-first native navigator for [SignalX](https://github.com/signalxjs) on
Lynx. Define routes once with `defineRoutes`, augment the `Register`
interface, and every navigator API — `useNav`, `useParams`, `useSearch`,
`<Link>`, `<Tabs.Screen>`, `<Drawer>` — picks up precise per-route
param/search inference.

The navigator ships native UI primitives (Stack, Tabs, Drawer, modal
presentation), focus hooks, deep-link integration, lazy routes, screen
options, and persistence — all reactive via sigx signals, all typed.

> **Status — 1.0 candidate.** Public surface is frozen; every export below
> is locked by the test suite in `__tests__/public-surface.test.ts`. The
> remaining work before flipping `private: false` is benchmarks against
> the legacy switch-based pattern and the publish flow.

## Install

```bash
pnpm add @sigx/lynx-navigation
```

Peer-deps: `@sigx/lynx`, `@sigx/lynx-motion`. Optional but recommended:
[`@sigx/lynx-linking`](../lynx-linking) for deep-link wiring,
[`@sigx/lynx-storage`](../lynx-storage) for stack persistence.

## Quick start

```tsx
// src/routes.ts
import { defineRoutes } from '@sigx/lynx-navigation';
import { z } from 'zod';
import { Home } from './screens/Home';
import { Profile } from './screens/Profile';

export const routes = defineRoutes({
    home: { component: Home },
    profile: {
        component: Profile,
        params: z.object({ id: z.string() }),
        path: '/users/:id',
    },
});

declare module '@sigx/lynx-navigation' {
    interface Register { routes: typeof routes }
}
```

```tsx
// src/App.tsx
import { NavigationRoot, Stack } from '@sigx/lynx-navigation';
import { routes } from './routes';

export const App = () => (
    <NavigationRoot routes={routes} initialRoute="home">
        <Stack />
    </NavigationRoot>
);
```

`<NavigationRoot>` creates a fresh navigator instance and provides it via
sigx's `defineProvide`, so multiple roots (or tests) get isolated state.
`<Stack>` renders the top entry, and during a push/pop the previous entry
too — driven by an MT-side `SharedValue` so per-frame interpolation never
crosses to BG.

## API reference

### `defineRoutes(routes)`

Locks in a typed route map. Each entry is a `RouteDefinition`:

```ts
interface RouteDefinition<P = unknown, S = unknown> {
    component: ComponentLike;        // sigx component or lazy(...)
    params?: StandardSchemaV1<P>;    // zod / valibot / arktype / etc.
    search?: StandardSchemaV1<S>;
    path?: string;                   // for deep-link parsing
    presentation?: Presentation;     // 'card' (default) | 'modal' | 'fullScreen' | 'transparent-modal'
}
```

Augment `Register.routes` once with the return value of `defineRoutes`
and every other API gets typed.

### `<NavigationRoot>`

| Prop | Default | Notes |
|---|---|---|
| `routes` | required | Output of `defineRoutes(...)`. |
| `initialRoute` | first key | Starting route at the bottom of the stack. |
| `initialParams` / `initialSearch` | `{}` | Required when `initialRoute` declares a schema. |
| `animated` | `true` | Disable in tests so navigations commit synchronously. |
| `edgeSwipeEnabled` | `true` | iOS edge-swipe-back. |

### `<Stack>`

Renders the topmost stack entry plus the entry beneath it during
transitions. By default it binds to the enclosing navigator (the root one
under `<NavigationRoot>`).

Pass `initialRoute` to make `<Stack>` create its **own** nested navigator —
this is how per-tab stacks work. See [Per-tab nested stacks](#per-tab-nested-stacks).

```tsx
<Stack initialRoute="tripsHome" />
<Stack initialRoute="profile" initialParams={{ id: 'me' }} />
```

### Per-tab nested stacks

Drop a `<Stack initialRoute=…>` inside each `<Tabs.Screen>` to give every
tab its own back-stack. Card-presentation pushes stay inside the tab;
modal / fullScreen / transparent-modal pushes **escalate** to the root
navigator so they overlay the entire tabs UI (TabBar included).

```tsx
<NavigationRoot routes={routes} initialRoute="root">
    <Header />
    <Stack />        {/* root navigator — renders the `root` entry below */}
</NavigationRoot>

// `root` route renders this:
<Tabs initialTab="trips">
    <Tabs.Screen name="trips" label="Trips">
        <Stack initialRoute="tripsHome" />
    </Tabs.Screen>
    <Tabs.Screen name="map" label="Map">
        <Stack initialRoute="mapHome" />
    </Tabs.Screen>
    <TabBar />
</Tabs>
```

Inside a tab body, `useNav()` resolves to the **innermost** navigator:

- `nav.push('tripDetail', { tripId })` — `tripDetail` is a card route →
  pushed onto the trips tab's stack, TabBar stays visible.
- `nav.push('newTrip')` — `newTrip` is `presentation: 'modal'` → walks up
  `nav.parent` to root and pushes there, overlays the whole tabs UI.
- `nav.replace(...)` is **strictly local** and never escalates (asymmetric
  with `push` by design — keeps the root stack stable).
- Hardware/edge back pops the focused inner nav first; only falls through
  to root once the inner stack is empty.
- `useIsFocused()` is `true` only when the screen is the top of its own
  nav **and** every ancestor is focused (parent's current entry matches +
  enclosing tab is active).

**Modal preservation.** When a `modal` / `fullScreen` /
`transparent-modal` push goes onto the root navigator (via escalation
from a per-tab stack), `<Stack>` keeps the underneath entry mounted
behind the overlay. Per-tab stack state, scroll positions, and in-flight
inputs all survive the modal lifecycle. Card pushes still replace the
underneath in the base layer — the user's mental model is "back
recreates the previous screen from history".

**Limitations (current slice)**:

- One global route registry — there's no per-tab whitelist yet. Deep-link
  routing always pushes against the innermost nav of the caller site
  (modal routes still escalate). A future slice may add `<Stack routes={…}>`.
- `useNavSerializer` snapshots one nav only — nested-tab stack state isn't
  persisted across reload yet.

### Per-stack header chrome

`<Stack>` accepts a default slot — its children render *inside* the
stack's nav scope, above the active screen. That's how to give a
nested per-tab stack its own header, since the root-level `<Header />`
only tracks the root navigator:

```tsx
<Tabs.Screen name="trips" label="Trips">
    <Stack initialRoute="tripsHome">
        <Header />   {/* useNav() here resolves to the per-tab nav */}
    </Stack>
</Tabs.Screen>
```

Without this, a `<Header />` placed as a sibling of `<Stack>` would
resolve `useNav()` to the *enclosing* nav and never react to pushes
inside the nested stack — the back button + title wouldn't update on
`nav.push('tripDetail', ...)`.

For a daisy-themed bar (height, padding, centred title, separator),
use `<NavHeader />` from `@sigx/lynx-daisyui` — same slot position,
same `useScreenChrome()` data source.

### `<Screen>`

Per-route slot container. Lets a screen declare its header / tab-bar item
JSX inline alongside its body:

```tsx
const Profile = component(() => () => (
    <Screen>
        <Screen.Header>
            <view><text>Custom header</text></view>
        </Screen.Header>
        <Screen.HeaderRight>
            <text bindtap={save}>Save</text>
        </Screen.HeaderRight>
        <Screen.TabBarItem>
            {({ active }) => <text style={{ opacity: active ? 1 : 0.6 }}>Me</text>}
        </Screen.TabBarItem>

        <view><text>profile body</text></view>
    </Screen>
));
```

All sub-slots are optional. Anything not declared falls back to the
navigator's default chrome.

### `<Header>`

**Headless** default navigator header — bare `<view>`/`<text>` nodes,
no flex direction, no padding, no theme. Reads the focused entry's
`<Screen.Header>` slot if set, otherwise renders
`headerLeft | title | headerRight` with a back button as the default
`headerLeft` when `nav.canGoBack` is true. Pulls `title` /
`headerShown` / `gestureEnabled` from the focused screen's
`useScreenOptions(...)` registration (or declarative `<Screen title=…>`).

For a daisy-themed bar with sensible defaults (surface colour,
separator, fixed ~48dp height, centred title), use `<NavHeader />`
from `@sigx/lynx-daisyui` — same data source via `useScreenChrome()`.
Custom designs can build their own component on top of
`useScreenChrome()` without touching internals.

```tsx
<NavigationRoot routes={routes} initialRoute="home">
    <Header />
    <Stack />
</NavigationRoot>
```

### `<Tabs>` + `<Tabs.Screen>` + `<TabBar>`

Persistent tab navigator. Each tab body stays mounted (hidden via
`display: none`) so switching tabs preserves state. Drop a `<Stack
initialRoute=…>` inside a `<Tabs.Screen>` to give that tab its own
back-stack — see [Per-tab nested stacks](#per-tab-nested-stacks).

```tsx
<Tabs initialTab="home">
    <Tabs.Screen name="home" component={HomeStack} label="Home" />
    <Tabs.Screen name="profile" component={ProfileStack} label="Me"
        accessibilityLabel="Profile tab" />
    <TabBar />
</Tabs>
```

`<TabBar>` is the default chrome — kebab-case `accessibility-*` props for
screen readers, opacity-based active marker, tap to switch. Pass
`renderTab={(info, ctx) => <view bindtap={ctx.onPress}>…</view>}` to
fully override per-item rendering.

`useTabs()` returns `{ active, setActive, tabs }` — reactive.

### `<Drawer>`

Off-canvas sidebar navigator.

```tsx
<Drawer sidebar={() => <view><text>Menu</text></view>}>
    <Stack />
</Drawer>
```

`useDrawer()` returns `{ isOpen, open(), close(), toggle() }`. The
sidebar is laid out absolutely on the left and toggled via `display`.
Gesture-driven open and slide-in animation are deferred to apps — wrap
your sidebar JSX in a motion component if you want it.

### `useNav()`

```ts
const nav = useNav();
// readonly + reactive
nav.current      // top StackEntry
nav.stack        // StackEntry[]
nav.canGoBack    // boolean

// mutators
nav.push('profile', { id: 'alice' });
nav.push('profile', { id: 'alice' }, { tab: 'about' });
nav.replace('home');
nav.pop();
nav.pop(2);
nav.popTo('home');
nav.popToRoot();
nav.reset([{ name: 'home', params: {}, search: {} }]);
```

Per-route overloaded — `params` is required iff the route declares a
`params` schema, and the value is type-checked against it.

### `<Link>`

JSX flavor of `nav.push`:

```tsx
<Link to="profile" params={{ id: 'alice' }} search={{ tab: 'about' }}>
    Open Alice
</Link>
<Link to="home" replace>Reset</Link>
```

Same per-route conditional typing as `nav.push`.

### `useParams(name)` / `useSearch(name)`

Typed accessors for the *currently-mounted* route. Calling with the wrong
route name is a TS error.

```ts
const { id } = useParams('profile');         // { id: string }
const { tab } = useSearch('profile');        // { tab: 'posts' | 'about' }
```

### `useFocusEffect(handler)` / `useIsFocused()`

`useIsFocused()` is a reactive boolean — `true` while this screen is the
visible top of its navigator. `useFocusEffect(() => () => cleanup)` runs
`handler` on focus and the returned function on blur. Use these to mount
side-effects (analytics, subscriptions, video playback) only while the
screen is visible.

### `useHardwareBack(handler)`

Subscribe to Android system-back / iOS edge-swipe. Return `true` to
swallow the press, `false`/`undefined` to let the navigator handle it.

### `useScreenOptions(options | () => options)`

Imperatively merge `ScreenOptions` (`title`, `headerShown`,
`gestureEnabled`) for the current screen. Pass a plain object for a
one-time merge; pass a function and every signal touched inside it is
tracked, so the options re-merge on change.

```tsx
const Profile = component(() => {
    const { id } = useParams('profile');
    useScreenOptions(() => ({ title: `User ${id}` }));
    return () => <view><text>profile</text></view>;
});
```

Equivalent declarative form via `<Screen>`:

```tsx
<Screen title={() => `User ${id}`} />
```

`<Screen>` only patches keys you actually pass — omitting `title`
won't clear a title set elsewhere on the same entry. Safe to use a
bare `<Screen>` purely to host `<Screen.HeaderRight>` slots without
worrying about wiping a sibling `useScreenOptions(...)` write.

### `useScreenChrome()`

Reactive read of the focused screen's options + slot fills, plus
navigation helpers a header would need (`canGoBack`, `pop`). The
public foundation for building custom header components without
touching internal modules — `<NavHeader />` in `@sigx/lynx-daisyui` is
built on this.

```tsx
import { useScreenChrome } from '@sigx/lynx-navigation';

const MyHeader = component(() => {
    const chrome = useScreenChrome();
    return () => {
        if (!chrome.headerShown) return null;
        return (
            <view class="my-header">
                {chrome.canGoBack
                    ? <view bindtap={chrome.pop}><text>‹ Back</text></view>
                    : null}
                <text>{chrome.title}</text>
                {chrome.headerRight?.()}
            </view>
        );
    };
});
```

Every property is a getter — reading it inside a render or `computed`
subscribes to the underlying signal, so the consumer re-renders when
title / slots change.

### `useLinkingNav(options?)`

Bridges `@sigx/lynx-linking` URL events into the navigator. Call once
inside a `<NavigationRoot>` subtree. Options:

| Key | Notes |
|---|---|
| `prefixes` | Schemes to strip before parsing (`'myapp://'`, `'https://myapp.com'`). |
| `onURL(url, nav)` | Intercept before default dispatch. Call `nav.push` yourself to handle. |
| `onUnmatched(url)` | Fired for URLs no route matches. Default: silent. |
| `replaceInitial` | Use `replace` for cold-start URLs (default `true`). |

### `useNavSerializer(options)`

Persist the navigator's stack across launches. Adapter is yours to
implement — `@sigx/lynx-storage`, MMKV, AsyncStorage, anything.

```ts
useNavSerializer({
    storage: {
        async load() { return JSON.parse(await Storage.get('nav')); },
        async save(snap) { await Storage.set('nav', JSON.stringify(snap)); },
    },
    debounceMs: 250,
    onRestored: (snap) => console.log('restored', snap.stack.length, 'entries'),
    onRestoreError: (reason, err) => console.warn('restore failed', reason, err),
});
```

Snapshots carry a `version` field (`NAV_SNAPSHOT_VERSION`) — bump it when
the schema changes and `onRestoreError` fires `'version'`.

### `hrefFor(name, params?, search?)` / `parseHref(input, routes)`

Build and parse path-style URLs declared by each route's `path` template:

```ts
const href = hrefFor('profile', { id: 'alice' }, { tab: 'posts' });
// → "/users/alice?tab=posts"

const parsed = parseHref('/users/bob?tab=about', routes);
// → { name: 'profile', params: { id: 'bob' }, search: { tab: 'about' } }
```

### Lazy routes

Routes can pass a `lazy(...)` component from `@sigx/lynx` (re-exports
`@sigx/runtime-core`'s `lazy` + `<Suspense>`). The navigator calls
`.preload()` on push so the chunk is fetched before the screen mounts:

```tsx
import { lazy } from '@sigx/lynx';

export const routes = defineRoutes({
    home: { component: Home },
    profile: { component: lazy(() => import('./screens/Profile')) },
});
```

Wrap your `<Stack>` in `<Suspense fallback={…}>` to show a fallback while
the chunk loads. The bundler (rspeedy/rspack) needs to produce
Lynx-loadable chunks for the layered MT-bundle — see the `examples/`
folder for a working setup.

## Modal presentation

Set `presentation: 'modal' | 'fullScreen' | 'transparent-modal'` on a
route definition. Modals ship as stack entries with a different
transition (bottom-sheet style) — there's no separate `<Modal>`
navigator. Use `nav.pop()` to dismiss.

## Testing

```ts
import { render, act } from '@sigx/lynx-testing';

render(
    <NavigationRoot routes={routes} initialRoute="home" animated={false}>
        <Stack />
    </NavigationRoot>,
);
```

Pass `animated={false}` so navigations commit synchronously — `lynx-testing`
has no MT runtime so the slide-from-right transition never completes
otherwise. Then `act(() => nav.push(...))` immediately re-renders.

## Runtime gotchas

- **`useMainThreadRef` will crash on BG.** Refs returned by sigx that bind
  to MT-only host nodes blow up if you read them outside `runOnMainThread`.
- **`runOnBackground` closure capture.** Variables captured in the body
  are snapshot at call time. Read signals via `.value` *inside* the body,
  not at definition.
- **`SharedValue` writes must come from MT worklets.** The transition
  layer enforces this — pushing to a `SharedValue` from BG silently no-ops.
- **Lynx has no `z-index`.** Layering is document-order. The navigator
  renders the underneath entry first, then the top entry — overlap them
  via `position: absolute` and an explicit offset.

## License

MIT
