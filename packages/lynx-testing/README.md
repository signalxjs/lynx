# @sigx/lynx-testing

Vitest-native testing utilities for sigx-lynx components — render, fire events, query the rendered tree, and wait for reactive updates.

Renders into an in-memory `TestNode` tree (no Lynx runtime, no PAPI mocks for the BG side). Pair with vitest in your project — no Jest, no preset.

```bash
pnpm add -D @sigx/lynx-testing vitest
```

## Quick start

```tsx
import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@sigx/lynx-testing';
import { component, signal, jsx } from '@sigx/lynx';

it('updates on tap', async () => {
  const count = signal({ value: 0 });
  const Counter = component(() => {
    return () => jsx('view', {
      bindtap: () => { count.value++; },
      children: [jsx('text', { children: String(count.value) })],
    });
  });

  const { container, getByType, getByText } = render(jsx(Counter, {}));
  expect(getByText('0')).toBeTruthy();

  await act(() => fireEvent.tap(getByType('view')));
  expect(getByText('1')).toBeTruthy();
});
```

## API

### `render(element, { appContext? }) → RenderResult`

Mounts a JSX element into a fresh `TestNode` tree. Returns:

- `container: TestNode` — the root node
- `unmount(): void` — tears down the render
- `getByType(type) / getAllByType(type) / queryByType(type)` — find by element name (`'view'`, `'text'`, `'scroll-view'`, …)
- `getByText(text) / queryByText(text)` — substring match on text content
- `getByProp(key, value)` — find by an arbitrary prop value (`getByProp('id', 'submit')`)
- `debug(): string` — pretty-print the rendered tree

`get*` throws if no node matches; `query*` returns `null`.

### `fireEvent`

```ts
fireEvent.tap(node, { x?, y? })
fireEvent.touchStart(node, { touches?, changedTouches? })
fireEvent.touchMove(node, { touches?, changedTouches? })
fireEvent.touchEnd(node, { touches?, changedTouches? })
fireEvent.touchCancel(node, { touches?, changedTouches? })
fireEvent.scroll(node, { detail: { scrollTop?, scrollLeft?, deltaX?, deltaY?, ... } })
fireEvent.input(node, { detail: { value? } })
fireEvent.longPress(node)
```

Each method dispatches both the `bind*` form (`bindtap`, `bindscroll`, …) and the camelCase form (`onTap`, `onScroll`, …) so component-vs-element handler shapes both fire.

### `touch(pageX, pageY, identifier = 1)`

Helper for building synthetic touch objects:

```ts
fireEvent.touchMove(view, { touches: [touch(150, 200)] });
```

### `act(fn)` / `waitForUpdate()`

Reactive flush helpers. Wrap signal mutations in `act` so the renderer commits before you assert:

```ts
await act(() => {
  state.count = 5;
  state.name = 'Alice';
});
expect(getByText('5')).toBeTruthy();
```

`waitForUpdate()` is the bare flush — useful when the mutation already happened (e.g. inside an event handler).

## Vitest config

A minimal `vitest.config.ts` for an app using sigx-lynx:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'sigx' },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    globals: true,
  },
});
```

## Testing MT-thread components

`render()` mounts the **BG side** of your component. Worklet props (`main-thread-bindtap`, `main-thread:ref`, `'main thread'`-marked function bodies) are rendered as inert handlers — the SWC worklet transform does not run, and the MT runtime is not booted. So `render()`-driven tests cover JSX shape + signal-driven re-renders, not worklet behavior.

For end-to-end MT coverage, use the `@sigx/lynx-testing/mt` subpath. It boots the upstream `@lynx-js/react/worklet-runtime`, runs the SWC `'main thread'` transform on real source, eval's the extracted `registerWorkletInternal(...)` calls, and hands back the registered worklets so you can drive them with fabricated events.

### Setup

Add a separate vitest config that picks up `*.mt.test.ts` files. The MT harness is heavier than the BG `render()` path — keeping it in its own config avoids paying the bootstrap cost on every BG test.

```ts
// vitest.mt.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['__tests__/**\/*.mt.test.ts'],
    setupFiles: ['@sigx/lynx-testing/mt/setup'],
  },
});
```

```jsonc
// package.json
{
  "scripts": {
    "test:mt": "vitest run --config vitest.mt.config.ts"
  },
  "devDependencies": {
    "@lynx-js/react": "^0.119.0",
    "@sigx/lynx-runtime-main": "workspace:^",
    "@sigx/lynx-testing": "workspace:^",
    "vitest": "^4"
  }
}
```

`@lynx-js/react` and `@sigx/lynx-runtime-main` are peer dependencies of `@sigx/lynx-testing/mt` and must be installed by the consumer (they ship the worklet runtime + the MT bootstrap that the setup file imports).

### Worked example

```ts
// __tests__/my-button.mt.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  compileMTWorklets,
  fabricateTapEvent,
  makeRef,
} from '@sigx/lynx-testing/mt';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../src/components/MyButton.tsx');

describe('MyButton — MT worklets', () => {
  let onBegin: Function;
  let onStart: Function;

  beforeEach(() => {
    // Compiles the source through the SWC LEPUS transform, eval's the
    // emitted `registerWorkletInternal(...)` calls, and returns the
    // worklets in source order.
    const worklets = compileMTWorklets({
      filename: SRC,
      source: readFileSync(SRC, 'utf8'),
    });
    expect(worklets).toHaveLength(2); // your component's worklet count
    [onBegin, onStart] = worklets;
  });

  it('onBegin sets pressed-state styles', () => {
    const setStyleProperties = vi.fn();
    const ctx = {
      _c: {
        elRef: makeRef({ setStyleProperties }, 1),
        opacity: 0.6,
      },
    };
    onBegin.call(ctx, fabricateTapEvent());
    expect(setStyleProperties).toHaveBeenCalledWith({ opacity: 0.6 });
  });
});
```

### API

#### `compileMTWorklets({ filename, source, runtimePkg? }) → Function[]`

Compile a `.tsx` source through the SWC LEPUS transform and register every `'main thread'`-marked function as a worklet on the live runtime that `setup.ts` bootstrapped. Returns the worklets in source order (top-to-bottom). Indexing into the returned array maps to your component's worklet declarations:

| Component shape | Index | Worklet |
|---|---|---|
| `Gesture.Pan().onBegin().onStart().onUpdate().onEnd()` | `[0]` | onBegin |
|  | `[1]` | onStart |
|  | `[2]` | onUpdate |
|  | `[3]` | onEnd |

Pass `runtimePkg` if your project uses something other than `@sigx/lynx-runtime-main` (rare).

#### `fabricatePanEvent({ pageX, pageY? }) / fabricateTapEvent({ pageX?, pageY? })`

Synthetic gesture-event payloads matching what Lynx's iOS arena delivers to MT worklets. **Important:** `pageX/pageY` are nested under `e.params` (NOT top-level on `e`). This mirrors `LynxBaseGestureHandler.m::eventParamsFromTouchEvent`. Worklets that read `e.pageX` will get `undefined` against this fabricated event — they should read `e.params.pageX`.

#### `makeRef<T>(current, id?) → { current, _wvid }`

Synthetic `MainThreadRef` shape. Worklets read `ref.current.value` and may mutate it.

#### `getWorkletMap() → Record<string, Function>`

Direct access to `lynxWorkletImpl._workletMap`. Useful when you need to look up a specific `_wkltId` rather than rely on source order. Throws if `setup.ts` didn't run.

#### `getJsContext() / resetJsContextSpy()`

Read or reset the JS-context spy that the lynx mock installs. Use to assert `dispatchEvent` calls (e.g. `Lynx.Sigx.AvPublish` from a worklet's `runOnBackground`).

#### `extractRegistrations(lepusCode) → string`

Extract `registerWorkletInternal(...)` calls from a LEPUS-target transform output. `compileMTWorklets()` calls this internally; export it for callers that want to roll their own compile flow.

### Lynx native quirks worth knowing about

These are real arena behaviors observed on iOS Lynx 3.5 / Android Lynx 3.6 — your worklets must accommodate them. Not bugs in this harness; the harness exposes them:

1. **`Gesture.Pan` requires an empty `.onBegin()` on iOS.** The native handler only sets `_isInvokedBegin` inside an onBegin handler, and `onStart`/`onEnd` short-circuit if that flag is false. Register a no-op onBegin on Pan or onStart never fires.
2. **Pan event payload is nested under `e.params`.** Top-level `e` has only dispatch metadata (`type`, `timestamp`, `target`, `currentTarget`); pageX/pageY/scrollX/etc. live in `e.params` (and a duplicate `e.detail`). The fabricators above match this shape.
3. **iOS arena fires `Tap.onEnd` ~6ms after touchstart for sibling-composed gestures.** `Gesture.Simultaneous(Tap, LongPress)` looks like it should let both gestures resolve independently, but iOS dispatches a fail/reset path that fires Tap.onEnd before recognition completes. `Tap.onStart` then never fires. Workaround in `<Pressable>`: register only `Tap.onBegin` + `Tap.onStart` (no Tap.onEnd) and emit press from `LongPress.onEnd`'s no-`longPressFired`-and-no-movement fallback. See `packages/gestures/src/components/Pressable.tsx` for the full pattern.
4. **`<scroll-view>` doesn't participate in the new gesture arena.** Its UIKit `panGestureRecognizer` runs independently of `LynxGestureArenaManager`, so a Pan registered on a descendant fires concurrently with the parent scroll. `<ScrollView>` exposes a `useScrollContext`-published `dragging` signal that descendants flip during their drag lifecycle as the workaround.

This pattern catches regressions like the Phase 2 "cannot read property bind of undefined" bug — silent through every source-shape regex test, would have failed at the e2e harness's `expect(workletFns.length).toBe(N)` assertion.
