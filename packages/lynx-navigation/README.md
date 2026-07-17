# @sigx/lynx-navigation

Type-first native navigator for [SignalX](https://sigx.dev/lynx/) on
Lynx. Define routes once with `defineRoutes`, augment the `Register`
interface, and every navigator API — `useNav`, `useParams`, `useSearch`,
`<Link>`, `<Tabs.Screen>`, `<Drawer>` — picks up precise per-route
param/search inference.

The navigator ships native UI primitives (Stack, Tabs, Drawer, modal and
bottom-sheet presentation), focus hooks, deep-link integration, lazy
routes, screen options, and persistence — all reactive via sigx signals,
all typed.

> **Status — 1.0 candidate.** Public surface is frozen; every export is
> locked by the test suite in `__tests__/public-surface.test.ts`.

## 📚 Documentation

Full guides, the complete API reference, presentation modes, nested stacks and live examples → **[sigx.dev/lynx/modules/navigation/overview](https://sigx.dev/lynx/modules/navigation/overview/)**

## Install

```bash
pnpm add @sigx/lynx-navigation
```

Peer-deps: `@sigx/lynx`, `@sigx/lynx-motion`. Optional but recommended:
[`@sigx/lynx-linking`](https://sigx.dev/lynx/modules/linking/overview/) for deep-link wiring,
[`@sigx/lynx-storage`](https://sigx.dev/lynx/modules/storage/overview/) for stack persistence.

## A taste

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

From there: typed `useNav()` / `<Link>` navigation, per-tab nested stacks, modal/sheet presentation, focus hooks, deep linking via `useLinkingNav`, and stack persistence via `useNavSerializer`. Full reference, prop tables and runtime gotchas live on the docs site.

Bottom sheets (`presentation: 'sheet'`) drag from anywhere on their surface by default, with drag↔scroll arbitration: taps, input focus and horizontal gestures pass through, and scrollable content coordinates automatically when wrapped in `@sigx/lynx-gestures`' `<ScrollView>` (below the max detent the sheet owns drags and content scroll is locked; at the max detent content scrolls, and pulling down from the top hands the gesture back to the sheet). For raw `<scroll-view>`/`<list>` content that can't coordinate, set `<Screen dragHandle="grabber">` (drag only from the top strip zone) — or `dragHandle="none"` for backdrop/programmatic dismiss only.

## License

MIT
