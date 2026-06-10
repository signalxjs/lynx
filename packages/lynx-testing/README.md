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

## License

MIT
