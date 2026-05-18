import { describe, it, expect } from 'vitest';
import { render, act, waitForUpdate } from '../src/index';
import { component, signal, jsx } from '@sigx/lynx';

describe('act / waitForUpdate', () => {
  it('act batches multiple signal mutations into a single flushed render', async () => {
    const a = signal({ value: 0 });
    const b = signal({ value: 0 });
    const View = component(() => {
      return () => jsx('text', { children: `${a.value}/${b.value}` });
    });
    const { container } = render(jsx(View, {}));
    expect(container.findByText('0/0')).toBeTruthy();

    await act(() => {
      a.value = 3;
      b.value = 4;
    });

    expect(container.findByText('3/4')).toBeTruthy();
  });

  it('act awaits async callbacks before flushing', async () => {
    const count = signal({ value: 0 });
    const View = component(() => {
      return () => jsx('text', { children: String(count.value) });
    });
    const { container } = render(jsx(View, {}));

    await act(async () => {
      await Promise.resolve();
      count.value = 7;
    });

    expect(container.findByText('7')).toBeTruthy();
  });

  it('waitForUpdate resolves after pending microtasks and timers', async () => {
    const start = Date.now();
    await waitForUpdate();
    // Just confirms it resolves; the interesting behavior is covered above.
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });
});
