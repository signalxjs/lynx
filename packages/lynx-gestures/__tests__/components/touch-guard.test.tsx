/**
 * Runtime tests for `<TouchGuard>` — BG-observable shape. The platform-touch
 * consumption itself is native (`SigxTouchGuardView.kt` claims the Android
 * touch target; iOS/web are inert containers) and is exercised on-device —
 * this covers the JS surface: the rendered tag, prop defaulting, and the
 * package exports.
 */
import { describe, expect, it } from 'vitest';
import { component } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { TOUCH_GUARD_TAG, TouchGuard } from '../../src/index.js';
import type { SigxTouchGuardAttributes } from '../../src/index.js';

function find(root: any, pred: (n: any) => boolean): any {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (pred(n)) return n;
    for (const k of n.children ?? []) stack.push(k);
  }
  return null;
}

const isGuard = (n: any): boolean => n.type === 'sigx-touch-guard';

describe('TouchGuard exports', () => {
  it('exports the raw tag constant and the component', () => {
    expect(TOUCH_GUARD_TAG).toBe('sigx-touch-guard');
    expect(TouchGuard).toBeTypeOf('function');
  });

  it('SigxTouchGuardAttributes accepts the documented prop shape', () => {
    const attrs: SigxTouchGuardAttributes = {
      'guard-enabled': false,
      'ignore-focus': true,
      flatten: false,
      catchtap: () => {},
    };
    expect(attrs['guard-enabled']).toBe(false);
  });
});

describe('<TouchGuard>', () => {
  it('renders the native tag hosting its children, guard-enabled default true', () => {
    const Host = component(() => () => (
      <TouchGuard>
        <text>overlay content</text>
      </TouchGuard>
    ));
    const result: any = render(<Host />);
    const root = result.container ?? result.root ?? result;
    const guard = find(root, isGuard);
    expect(guard).toBeTruthy();
    expect(guard.props['guard-enabled']).toBe(true);
    // Children are slotted through.
    expect(find(guard, (n) => n.type === 'text')).toBeTruthy();
    // catch (not bind): a guard's own tap must not bubble beneath it.
    expect(typeof guard.props.catchtap).toBe('function');
  });

  it('enabled={false} is reflected on guard-enabled', () => {
    const Host = component(() => () => <TouchGuard enabled={false} />);
    const result: any = render(<Host />);
    const root = result.container ?? result.root ?? result;
    const guard = find(root, isGuard);
    expect(guard.props['guard-enabled']).toBe(false);
  });

  it('passes class and style through', () => {
    const Host = component(() => () => (
      <TouchGuard class="dim" style={{ position: 'absolute', top: 0 }} />
    ));
    const result: any = render(<Host />);
    const root = result.container ?? result.root ?? result;
    const guard = find(root, isGuard);
    expect(guard.props.class).toBe('dim');
    expect(guard.props.style.position).toBe('absolute');
  });
});
