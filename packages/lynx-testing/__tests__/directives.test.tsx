import { describe, it, expect } from 'vitest';
import { render, waitForUpdate } from '../src/index';
import { component, signal, jsx, defineDirective } from '@sigx/lynx';

describe('use:show in the test renderer', () => {
  it('toggles visibility while keeping the node mounted', async () => {
    const shown = signal(true);
    const App = component(() => () =>
      jsx('view', { 'use:show': shown.value, children: [jsx('text', { children: 'hi' })] }),
    );
    const { getByType } = render(jsx(App, {}));
    const view = getByType('view');
    expect(view.isVisible).toBe(true);
    expect(view._style['display']).toBeUndefined();

    shown.value = false;
    await waitForUpdate();
    expect(view.isVisible).toBe(false);
    expect(view._style['display']).toBe('none');
    // Same node instance — hidden, not unmounted/remounted.
    expect(getByType('view')).toBe(view);

    shown.value = true;
    await waitForUpdate();
    expect(view.isVisible).toBe(true);
    expect(view._style['display']).toBeUndefined();
  });

  it('merges show visibility with the element\'s own style', async () => {
    const shown = signal(false);
    const App = component(() => () =>
      jsx('view', { 'use:show': shown.value, style: { color: 'red' } }),
    );
    const { getByType } = render(jsx(App, {}));
    const view = getByType('view');
    expect(view._style).toEqual({ color: 'red', display: 'none' });

    shown.value = true;
    await waitForUpdate();
    expect(view._style).toEqual({ color: 'red' });
  });

  it('runs custom directive lifecycle hooks under test', async () => {
    const calls: string[] = [];
    const spy = defineDirective<number>({
      created: (_el, { value }) => calls.push(`created:${value}`),
      mounted: (_el, { value }) => calls.push(`mounted:${value}`),
      updated: (_el, { value, oldValue }) => calls.push(`updated:${oldValue}->${value}`),
      unmounted: () => calls.push('unmounted'),
    });
    const n = signal(1);
    const App = component(() => () => jsx('view', { 'use:spy': [spy, n.value] }));
    const { unmount } = render(jsx(App, {}));
    expect(calls).toEqual(['created:1', 'mounted:1']);

    n.value = 2;
    await waitForUpdate();
    expect(calls).toContain('updated:1->2');

    unmount();
    expect(calls).toContain('unmounted');
  });
});
