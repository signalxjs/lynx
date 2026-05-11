import { describe, it, expect, beforeAll } from 'vitest';
import { getPlatformModelProcessor } from '@sigx/runtime-core/internals';

// Importing @sigx/lynx-runtime side-effect-registers the platform model
// processor (and the JSX/PlatformTypes augmentations).
import '../src/index.js';

describe('lynx-runtime model processor', () => {
  let processor: ReturnType<typeof getPlatformModelProcessor>;

  beforeAll(() => {
    processor = getPlatformModelProcessor();
  });

  it('is registered when @sigx/lynx-runtime is imported', () => {
    expect(typeof processor).toBe('function');
  });

  it('handles <input> by setting value and installing a bindinput handler', () => {
    const state: Record<string, unknown> = { name: 'old' };
    const props: Record<string, unknown> = {};
    const handled = processor!('input', props, [state, 'name'], {});

    expect(handled).toBe(true);
    expect(props.value).toBe('old');
    expect(typeof props.bindinput).toBe('function');

    // Simulate Lynx firing bindinput with the new text on event.detail.value.
    (props.bindinput as (e: unknown) => void)({ detail: { value: 'new' } });
    expect(state.name).toBe('new');
  });

  it('handles <textarea> the same way as <input>', () => {
    const state: Record<string, unknown> = { notes: 'first line' };
    const props: Record<string, unknown> = {};
    const handled = processor!('textarea', props, [state, 'notes'], {});

    expect(handled).toBe(true);
    expect(props.value).toBe('first line');
    expect(typeof props.bindinput).toBe('function');

    (props.bindinput as (e: unknown) => void)({
      detail: { value: 'first line\nsecond' },
    });
    expect(state.notes).toBe('first line\nsecond');
  });

  it('preserves any user-provided bindinput handler (chains both)', () => {
    const state: Record<string, unknown> = { name: '' };
    const calls: unknown[] = [];
    const userHandler = (e: unknown) => {
      calls.push(e);
    };
    const props: Record<string, unknown> = { bindinput: userHandler };

    const handled = processor!('input', props, [state, 'name'], {});
    expect(handled).toBe(true);

    const evt = { detail: { value: 'hello' } };
    (props.bindinput as (e: unknown) => void)(evt);

    expect(state.name).toBe('hello');
    expect(calls).toEqual([evt]);
  });

  it('routes through onUpdate:modelValue when forwarding through a component', () => {
    const updates: unknown[] = [];
    const state: Record<string, unknown> = {
      name: 'initial',
      'onUpdate:name'(v: unknown) {
        updates.push(v);
      },
    };
    const props: Record<string, unknown> = {};

    processor!('input', props, [state, 'name'], {});
    (props.bindinput as (e: unknown) => void)({ detail: { value: 'forwarded' } });

    // The forwarded handler ran with the new value, AND state.name was NOT
    // mutated directly because the onUpdate:name handler took priority.
    expect(updates).toEqual(['forwarded']);
    expect(state.name).toBe('initial');
  });

  it('returns false for non-form elements (generic fallback)', () => {
    const state: Record<string, unknown> = { name: 'foo' };
    const props: Record<string, unknown> = {};
    const handled = processor!('view', props, [state, 'name'], {});
    expect(handled).toBe(false);
    expect(props.value).toBeUndefined();
    expect(props.bindinput).toBeUndefined();
  });

  it('handles missing event.detail.value gracefully (defaults to empty string)', () => {
    const state: Record<string, unknown> = { name: 'old' };
    const props: Record<string, unknown> = {};
    processor!('input', props, [state, 'name'], {});
    (props.bindinput as (e: unknown) => void)({});
    expect(state.name).toBe('');
  });
});
