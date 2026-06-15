import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineDirective, jsx, type AppContext } from '@sigx/runtime-core';
import { createRenderer } from '@sigx/runtime-core/internals';
// Side effect: registers the built-in `show` directive so the `use:show`
// shorthand resolves (matches importing @sigx/lynx-runtime).
import '../src/directives/register';
import { nodeOps, resetNodeOpsState } from '../src/nodeOps';
import {
  patchDirective,
  onElementMounted,
  onElementUnmounted,
  registerBuiltInDirective,
  resolveBuiltInDirective,
} from '../src/directives/index';
import { show } from '../src/directives/show';
import { resetOpQueue, takeOps } from '../src/op-queue';
import { resetShadowState, type ShadowElement } from '../src/shadow-element';
import { OP } from '@sigx/lynx-runtime-internal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the SET_STYLE payloads ({...style}) emitted since the last drain. */
function drainStyles(): Record<string, unknown>[] {
  const flat = takeOps();
  const styles: Record<string, unknown>[] = [];
  let i = 0;
  while (i < flat.length) {
    const code = flat[i++] as number;
    switch (code) {
      case OP.CREATE: i += 2; break;
      case OP.CREATE_TEXT: i += 1; break;
      case OP.INSERT: i += 3; break;
      case OP.REMOVE: i += 2; break;
      case OP.SET_PROP: i += 3; break;
      case OP.SET_TEXT: i += 2; break;
      case OP.SET_EVENT: i += 4; break;
      case OP.REMOVE_EVENT: i += 3; break;
      case OP.SET_STYLE:
        i += 1; // id
        styles.push(flat[i++] as Record<string, unknown>);
        break;
      case OP.SET_CLASS: i += 2; break;
      case OP.SET_ID: i += 2; break;
      case OP.INVOKE_UI_METHOD: i += 3; break;
      default:
        // Fail loudly on an unknown opcode rather than silently misparsing the
        // rest of the stream as opcodes.
        throw new Error(`drainStyles: unhandled op code ${code}`);
    }
  }
  return styles;
}

beforeEach(() => {
  resetOpQueue();
  resetNodeOpsState();
  resetShadowState();
});

// ---------------------------------------------------------------------------
// Directive lifecycle
// ---------------------------------------------------------------------------

describe('directive lifecycle', () => {
  it('runs created → mounted → updated → unmounted in order with binding values', () => {
    const calls: string[] = [];
    const spy = defineDirective<number, ShadowElement>({
      created(_el, { value }) { calls.push(`created:${value}`); },
      mounted(_el, { value }) { calls.push(`mounted:${value}`); },
      updated(_el, { value, oldValue }) { calls.push(`updated:${oldValue}->${value}`); },
      unmounted(_el, { value }) { calls.push(`unmounted:${value}`); },
    });

    const el = nodeOps.createElement('view');

    // Mount path: patchDirective (created) then onElementMounted (mounted).
    patchDirective(el, 'spy', null, [spy, 1], null);
    onElementMounted(el);
    // Update path: value changes -> updated.
    patchDirective(el, 'spy', [spy, 1], [spy, 2], null);
    // Same value -> no updated.
    patchDirective(el, 'spy', [spy, 2], [spy, 2], null);
    // Unmount path.
    onElementUnmounted(el);

    expect(calls).toEqual([
      'created:1',
      'mounted:1',
      'updated:1->2',
      'unmounted:2',
    ]);
  });

  it('clears directive state on unmount so a reused node does not double-fire', () => {
    const mounted = vi.fn();
    const dir = defineDirective<boolean, ShadowElement>({ mounted });
    const el = nodeOps.createElement('view');

    patchDirective(el, 'd', null, [dir, true], null);
    onElementUnmounted(el);
    // After unmount the state map is gone — a stray onElementMounted is a no-op.
    onElementMounted(el);

    expect(mounted).not.toHaveBeenCalled();
    expect(el._directives).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe('directive resolution', () => {
  it('resolves a built-in directive by name (shorthand)', () => {
    const mounted = vi.fn();
    registerBuiltInDirective('unit-builtin', defineDirective({ mounted }));
    expect(resolveBuiltInDirective('unit-builtin')).toBeDefined();

    const el = nodeOps.createElement('view');
    patchDirective(el, 'unit-builtin', null, 'hello', null);
    onElementMounted(el);

    expect(mounted).toHaveBeenCalledWith(el, { value: 'hello' });
  });

  it('resolves an app-registered directive via the app context', () => {
    const created = vi.fn();
    const appContext = {
      directives: new Map([['app-dir', defineDirective({ created })]]),
    } as unknown as AppContext;

    const el = nodeOps.createElement('view');
    patchDirective(el, 'app-dir', null, 42, appContext);

    expect(created).toHaveBeenCalledWith(el, { value: 42 });
  });

  it('warns when a use: directive cannot be resolved (dev)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const el = nodeOps.createElement('view');

    patchDirective(el, 'nope', null, true, null);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('use:nope');
    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// show directive
// ---------------------------------------------------------------------------

describe('show directive', () => {
  it('merges display:none when hidden and restores the raw style when shown', () => {
    const el = nodeOps.createElement('view');
    nodeOps.patchProp(el, 'style', null, { color: 'red' });
    expect(drainStyles()).toEqual([{ color: 'red' }]);

    // Mount hidden -> display:none merged on top of the raw style.
    patchDirective(el, 'show', null, [show, false], null);
    onElementMounted(el);
    expect(drainStyles()).toEqual([{ color: 'red', display: 'none' }]);

    // Toggle visible -> raw style re-emitted, display:none gone.
    patchDirective(el, 'show', [show, false], [show, true], null);
    expect(drainStyles()).toEqual([{ color: 'red' }]);

    // Toggle hidden again.
    patchDirective(el, 'show', [show, true], [show, false], null);
    expect(drainStyles()).toEqual([{ color: 'red', display: 'none' }]);
  });

  it('restores visibility when the show directive is removed from a mounted element', () => {
    const el = nodeOps.createElement('view');
    nodeOps.patchProp(el, 'style', null, { color: 'red' });
    patchDirective(el, 'show', null, [show, false], null);
    onElementMounted(el);
    drainStyles(); // clear: { color:red }, { color:red, display:none }

    // Removing the use:show prop (nextValue == null) while the element stays
    // mounted must run unmounted -> restore the raw style (no display:none).
    patchDirective(el, 'show', [show, false], null, null);
    expect(drainStyles()).toEqual([{ color: 'red' }]);
    expect(el._directives?.has('show')).toBeFalsy();
  });

  it('does not re-emit SET_STYLE when the bound value is unchanged', () => {
    const el = nodeOps.createElement('view');
    nodeOps.patchProp(el, 'style', null, { color: 'red' });
    patchDirective(el, 'show', null, [show, true], null);
    onElementMounted(el);
    drainStyles(); // clear

    // Same value -> updated() is skipped -> no new style op.
    patchDirective(el, 'show', [show, true], [show, true], null);
    expect(drainStyles()).toEqual([]);
  });

  it('keeps a hidden element hidden across an unrelated restyle and dedups it', () => {
    const el = nodeOps.createElement('view');
    nodeOps.patchProp(el, 'style', null, { color: 'red' });
    patchDirective(el, 'show', null, [show, false], null);
    onElementMounted(el);
    drainStyles(); // clear: { color:red, display:none }

    // Re-patch the SAME raw style object content while hidden — must NOT
    // re-emit display:none every render (the latent _style dedup bug).
    nodeOps.patchProp(el, 'style', { color: 'red' }, { color: 'red' });
    expect(drainStyles()).toEqual([]);

    // A genuine style change while hidden keeps display:none merged.
    nodeOps.patchProp(el, 'style', { color: 'red' }, { color: 'blue' });
    expect(drainStyles()).toEqual([{ color: 'blue', display: 'none' }]);
  });
});

// ---------------------------------------------------------------------------
// Integration: the real renderer must drive the directive hooks
// ---------------------------------------------------------------------------

describe('use:show through the real renderer', () => {
  it('resolves the shorthand and toggles display:none across re-renders', () => {
    const renderer = createRenderer(nodeOps);
    const root = nodeOps.createElement('page');
    drainStyles(); // clear the root CREATE op

    // Initial mount, visible: SET_STYLE without display (the renderer must
    // call nodeOps.patchProp for `use:show` and onElementMounted → show.mounted).
    renderer.render(jsx('view', { 'use:show': true, style: { color: 'red' } }), root);
    expect(drainStyles()).toEqual([{ color: 'red' }]);

    // Patch hidden: the renderer routes `use:show` to patchDirective (updated).
    renderer.render(jsx('view', { 'use:show': false, style: { color: 'red' } }), root);
    expect(drainStyles()).toEqual([{ color: 'red', display: 'none' }]);

    // Patch visible again.
    renderer.render(jsx('view', { 'use:show': true, style: { color: 'red' } }), root);
    expect(drainStyles()).toEqual([{ color: 'red' }]);
  });
});
