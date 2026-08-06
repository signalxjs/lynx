# @sigx/lynx-testing

Vitest-native testing utilities for sigx-lynx components — render, fire events, query the rendered tree, and wait for reactive updates.

Renders into an in-memory `TestNode` tree (no Lynx runtime, no PAPI mocks for the BG side). Pair with vitest in your project — no Jest, no preset.

## 📚 Documentation

Full API, vitest config, and the MT-worklet test harness → **[sigx.dev/lynx/modules/testing/overview](https://sigx.dev/lynx/modules/testing/overview/)**

## Install

```bash
pnpm add -D @sigx/lynx-testing vitest
```

## A taste

```tsx
import { it, expect } from 'vitest';
import { render, fireEvent, act } from '@sigx/lynx-testing';
import { component, signal, jsx } from '@sigx/lynx';

it('updates on tap', async () => {
  const count = signal({ value: 0 });
  const Counter = component(() => () => jsx('view', {
    bindtap: () => { count.value++; },
    children: [jsx('text', { children: String(count.value) })],
  }));

  const { getByType, getByText } = render(jsx(Counter, {}));
  expect(getByText('0')).toBeTruthy();

  await act(() => fireEvent.tap(getByType('view')));
  expect(getByText('1')).toBeTruthy();
});
```

`render()` mounts the **BG side** of a component and covers JSX shape + signal-driven re-renders. For end-to-end main-thread coverage, the `@sigx/lynx-testing/mt` subpath boots the worklet runtime, runs the real `'main thread'` transform, and hands back the registered worklets to drive. The full query/`fireEvent`/`act` API, vitest config, and the MT harness are documented on the docs site.

## API

### Rendering

| | |
|---|---|
| `render(vnode)` | Mount into an in-memory `TestNode` tree. Returns `{ container, unmount }` |
| `TestNode` | The node type — `type`, `props`, `children`, `text` |

### Waiting

| | |
|---|---|
| `await act(fn)` | Run `fn`, then advance **one** turn |
| `await waitForUpdate()` | Advance one turn |
| `await waitFor(condition, opts?)` | Poll until `condition` is truthy; returns its value |

**Pick `waitFor` whenever the number of turns isn't knowable** — a dynamic import, chained
effects, a deferred callback. `act`/`waitForUpdate` advance a *fixed* amount, so waiting on
those with a loop or a `setTimeout` is a guess that holds until the machine is busy. Two tests
in `@sigx/lynx-emoji` were written that way and both failed on CI.

```ts
// ✗ guesses — fails once mounting takes a sixth turn
for (let i = 0; i < 5; i++) await act(() => {});
expect(getByType(container, 'tabbar')).toBeTruthy();

// ✓ waits for the thing you actually care about
await findByType(container, 'tabbar');
```

`waitFor` options: `timeout` (default 1000ms), `interval` (default 0), `description` (named in
the timeout message). A condition that throws counts as "not yet", and on timeout the
condition's own error is rethrown — so you get "no element found with text …" plus the tree,
not a bare timeout.

### Queries

Three flavours per matcher, following `@testing-library`:

| | `Type` | `Text` | `Prop` |
|---|---|---|---|
| **throws if missing** | `getByType` | `getByText` | `getByProp` |
| **null if missing** | `queryByType` | `queryByText` | `queryByProp` |
| **waits for it** | `findByType` | `findByText` | `findByProp` |

Plus `getAllByType(container, type)`, `within(node)` to scope queries to a subtree, and
`formatTree(node)` to print a tree. A failing `getBy*`/`findBy*` prints the tree it searched.

### Events

`fireEvent(node, name, detail?)` and `touch(node, points)`.

### Main thread

`@sigx/lynx-testing/mt` compiles and runs worklets; add `@sigx/lynx-testing/mt/setup` to your
vitest `setupFiles`.

## Directives

The test renderer runs the same `use:*` directive lifecycle as the real runtime,
so components that use directives behave under test like they do on device.
`use:show` toggles a node's effective `_style.display` while keeping it mounted —
assert with the `isVisible` getter:

```tsx
import { render, waitForUpdate } from '@sigx/lynx-testing';
import { component, signal, jsx } from '@sigx/lynx';

const shown = signal(true);
const App = component(() => () =>
  jsx('view', { 'use:show': shown.value, children: [jsx('text', { children: 'hi' })] }));

const { getByType } = render(jsx(App, {}));
const view = getByType('view');
expect(view.isVisible).toBe(true);

shown.value = false;
await waitForUpdate();
expect(view.isVisible).toBe(false);          // same node — hidden, not remounted
expect(view._style.display).toBe('none');
```

Custom directives' `created` / `mounted` / `updated` / `unmounted` hooks fire too
(pass the directive inline as `use:name={[dir, value]}`, or register it with
`registerBuiltInDirective` / `app.directive`).

## License

MIT
