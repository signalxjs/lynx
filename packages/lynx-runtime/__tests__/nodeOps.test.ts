import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRenderer } from '@sigx/runtime-core/internals';
import { jsx } from '@sigx/runtime-core';
import { nodeOps, resetNodeOpsState } from '../src/nodeOps';
import { resetOpQueue, takeOps } from '../src/op-queue';
import { publishEvent, resetRegistry } from '../src/event-registry';
import { resetShadowState } from '../src/shadow-element';
import { OP } from '@sigx/lynx-runtime-internal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drain the op queue and return the ops as a flat array. */
function drainOps(): unknown[] {
  return takeOps();
}

/**
 * Parse the flat ops array into structured records for easier assertions.
 * Each record is [opCode, ...args].
 */
function parseOps(flat: unknown[]): unknown[][] {
  const records: unknown[][] = [];
  let i = 0;
  while (i < flat.length) {
    const code = flat[i++] as number;
    switch (code) {
      case OP.CREATE:
        records.push([code, flat[i++], flat[i++]]);
        break;
      case OP.CREATE_TEXT:
        records.push([code, flat[i++]]);
        break;
      case OP.INSERT:
        records.push([code, flat[i++], flat[i++], flat[i++]]);
        break;
      case OP.REMOVE:
        records.push([code, flat[i++], flat[i++]]);
        break;
      case OP.SET_PROP:
        records.push([code, flat[i++], flat[i++], flat[i++]]);
        break;
      case OP.SET_TEXT:
        records.push([code, flat[i++], flat[i++]]);
        break;
      case OP.SET_EVENT:
        records.push([code, flat[i++], flat[i++], flat[i++], flat[i++]]);
        break;
      case OP.REMOVE_EVENT:
        records.push([code, flat[i++], flat[i++], flat[i++]]);
        break;
      case OP.SET_STYLE:
        records.push([code, flat[i++], flat[i++]]);
        break;
      case OP.SET_CLASS:
        records.push([code, flat[i++], flat[i++]]);
        break;
      case OP.SET_ID:
        records.push([code, flat[i++], flat[i++]]);
        break;
      case OP.INVOKE_UI_METHOD:
        records.push([code, flat[i++], flat[i++], flat[i++]]);
        break;
      default:
        // Unknown — just push the code
        records.push([code]);
        break;
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lynx-runtime nodeOps (shadow-tree + op-queue)', () => {
  let renderer: any;

  beforeEach(() => {
    resetOpQueue();
    resetRegistry();
    resetNodeOpsState();
    resetShadowState();
    renderer = createRenderer(nodeOps);
  });

  // Test 1: nodeOps NEVER touches globalThis.__CreateElement
  it('does not reference any PAPI globals on globalThis', () => {
    // Install traps — if any PAPI global is accessed, the test fails
    const papiNames = [
      '__CreateElement', '__AppendElement', '__InsertElementBefore',
      '__RemoveElement', '__SetAttribute', '__AddInlineStyle',
      '__SetInlineStyles', '__SetClasses', '__AddEvent', '__RemoveEvent',
      '__CreateRawText', '__UpdateRawText', '__FlushElementTree',
      '__CreatePage', '__SetID', '__AddDataset',
    ];
    const traps: Record<string, any> = {};
    for (const name of papiNames) {
      traps[name] = (globalThis as any)[name]; // save original
      Object.defineProperty(globalThis, name, {
        get() {
          throw new Error(`BG nodeOps must NOT access globalThis.${name}`);
        },
        configurable: true,
      });
    }

    try {
      // Create a root and render a tree — should use pushOp, not PAPI
      const root = nodeOps.createElement('page');
      const view = nodeOps.createElement('view');
      const text = nodeOps.createText('hello');
      nodeOps.insert(text, view);
      nodeOps.insert(view, root);
      nodeOps.patchProp(view, 'class', null, 'my-class');
      nodeOps.remove(text);
    } finally {
      // Restore
      for (const name of papiNames) {
        delete (globalThis as any)[name];
        if (traps[name] !== undefined) {
          (globalThis as any)[name] = traps[name];
        }
      }
    }
  });

  // Test 2: render view>text tree pushes correct op records
  it('pushes CREATE, CREATE_TEXT, SET_TEXT, INSERT ops for a view>text tree', () => {
    const root = nodeOps.createElement('page');
    drainOps(); // clear CREATE op for root

    const view = nodeOps.createElement('view');
    const text = nodeOps.createText('hi');
    nodeOps.insert(text, view);
    nodeOps.insert(view, root);

    const ops = drainOps();
    const records = parseOps(ops);

    // Should have: CREATE(view), CREATE_TEXT(text), SET_TEXT(text, 'hi'),
    // INSERT(view, text, -1), INSERT(root, view, -1)
    const createView = records.find(r => r[0] === OP.CREATE && r[2] === 'view');
    expect(createView).toBeDefined();

    const createText = records.find(r => r[0] === OP.CREATE_TEXT);
    expect(createText).toBeDefined();

    const setText = records.find(r => r[0] === OP.SET_TEXT && r[2] === 'hi');
    expect(setText).toBeDefined();

    const inserts = records.filter(r => r[0] === OP.INSERT);
    expect(inserts.length).toBe(2);
  });

  // Test 3: setText pushes SET_TEXT op
  it('setText pushes a SET_TEXT op', () => {
    const text = nodeOps.createText('before');
    drainOps();

    nodeOps.setText(text, 'after');
    const ops = drainOps();
    const records = parseOps(ops);

    const setTextOp = records.find(r => r[0] === OP.SET_TEXT && r[2] === 'after');
    expect(setTextOp).toBeDefined();
    expect(setTextOp![1]).toBe(text.id);
  });

  // Test 4: removing a child pushes REMOVE op
  it('pushes REMOVE op when removing a child', () => {
    const parent = nodeOps.createElement('view');
    const child = nodeOps.createElement('text');
    nodeOps.insert(child, parent);
    drainOps();

    nodeOps.remove(child);
    const ops = drainOps();
    const records = parseOps(ops);

    const removeOp = records.find(r => r[0] === OP.REMOVE);
    expect(removeOp).toBeDefined();
    expect(removeOp![1]).toBe(parent.id);
    expect(removeOp![2]).toBe(child.id);
  });

  // Test 5: patchProp with onTap pushes SET_EVENT op
  it('patchProp with onTap pushes SET_EVENT op with sign', () => {
    const el = nodeOps.createElement('view');
    drainOps();

    const handler = vi.fn();
    nodeOps.patchProp(el, 'onTap', null, handler);
    const ops = drainOps();
    const records = parseOps(ops);

    const eventOp = records.find(r => r[0] === OP.SET_EVENT);
    expect(eventOp).toBeDefined();
    expect(eventOp![1]).toBe(el.id);
    expect(eventOp![2]).toBe('bindEvent'); // event type
    expect(eventOp![3]).toBe('tap'); // event name
    expect(typeof eventOp![4]).toBe('string'); // sign
    expect((eventOp![4] as string)).toMatch(/^sigx:/);
  });

  // Test 6: patchProp with style pushes SET_STYLE op with normalised values
  it('patchProp with style pushes SET_STYLE op', () => {
    const el = nodeOps.createElement('view');
    drainOps();

    nodeOps.patchProp(el, 'style', null, { width: 100, opacity: 0.5 });
    const ops = drainOps();
    const records = parseOps(ops);

    const styleOp = records.find(r => r[0] === OP.SET_STYLE);
    expect(styleOp).toBeDefined();
    const styleObj = styleOp![2] as Record<string, unknown>;
    expect(styleObj.width).toBe('100px'); // numeric → px
    expect(styleObj.opacity).toBe(0.5); // dimensionless — kept as number
  });

  // The flex shorthand must expand to longhands — the native inline-style
  // path doesn't expand CSS shorthands, so a raw `flex` reaches the engine
  // as an unknown property and silently does nothing (#264).
  it('expands the flex shorthand into flexGrow/flexShrink/flexBasis', () => {
    const styleFor = (style: Record<string, unknown>): Record<string, unknown> => {
      const el = nodeOps.createElement('view');
      drainOps();
      nodeOps.patchProp(el, 'style', null, style);
      const op = parseOps(drainOps()).find(r => r[0] === OP.SET_STYLE);
      return op![2] as Record<string, unknown>;
    };

    expect(styleFor({ flex: 1 })).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: '0%' });
    expect(styleFor({ flex: 0 })).toEqual({ flexGrow: 0, flexShrink: 1, flexBasis: '0%' });
    expect(styleFor({ flex: 'none' })).toEqual({ flexGrow: 0, flexShrink: 0, flexBasis: 'auto' });
    expect(styleFor({ flex: 'auto' })).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: 'auto' });
    expect(styleFor({ flex: 'initial' })).toEqual({ flexGrow: 0, flexShrink: 1, flexBasis: 'auto' });
    expect(styleFor({ flex: '200px' })).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: '200px' });
    expect(styleFor({ flex: '2 3' })).toEqual({ flexGrow: 2, flexShrink: 3, flexBasis: '0%' });
    expect(styleFor({ flex: '2 200px' })).toEqual({ flexGrow: 2, flexShrink: 1, flexBasis: '200px' });
    expect(styleFor({ flex: '2 3 200px' })).toEqual({ flexGrow: 2, flexShrink: 3, flexBasis: '200px' });
  });

  it('flex shorthand respects CSS source-order overrides', () => {
    const styleFor = (style: Record<string, unknown>): Record<string, unknown> => {
      const el = nodeOps.createElement('view');
      drainOps();
      nodeOps.patchProp(el, 'style', null, style);
      const op = parseOps(drainOps()).find(r => r[0] === OP.SET_STYLE);
      return op![2] as Record<string, unknown>;
    };

    // Longhand after the shorthand wins…
    expect(styleFor({ flex: 1, flexShrink: 0 }))
      .toEqual({ flexGrow: 1, flexShrink: 0, flexBasis: '0%' });
    // …and the shorthand overrides an earlier longhand.
    expect(styleFor({ flexGrow: 5, flex: 1 }))
      .toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: '0%' });
  });

  // Invalid per CSS (non-finite/negative factors, blank strings) must pass
  // through unchanged, not expand to bogus longhands.
  it('flex shorthand passes invalid values through unchanged', () => {
    const styleFor = (style: Record<string, unknown>): Record<string, unknown> => {
      const el = nodeOps.createElement('view');
      drainOps();
      nodeOps.patchProp(el, 'style', null, style);
      const op = parseOps(drainOps()).find(r => r[0] === OP.SET_STYLE);
      return op![2] as Record<string, unknown>;
    };

    expect(styleFor({ flex: NaN })).toEqual({ flex: NaN });
    expect(styleFor({ flex: Infinity })).toEqual({ flex: Infinity });
    expect(styleFor({ flex: -1 })).toEqual({ flex: -1 });
    expect(styleFor({ flex: '' })).toEqual({ flex: '' });
    expect(styleFor({ flex: '   ' })).toEqual({ flex: '   ' });
    expect(styleFor({ flex: '-1' })).toEqual({ flex: '-1' });
    expect(styleFor({ flex: 'Infinity' })).toEqual({ flex: 'Infinity' });
    expect(styleFor({ flex: '1 -2' })).toEqual({ flex: '1 -2' });
    expect(styleFor({ flex: '-1 2 0%' })).toEqual({ flex: '-1 2 0%' });
    expect(styleFor({ flex: '1 2 3 4' })).toEqual({ flex: '1 2 3 4' });
  });

  // Test 7: patchProp with class pushes SET_CLASS op
  it('patchProp with class pushes SET_CLASS op', () => {
    const el = nodeOps.createElement('view');
    drainOps();

    nodeOps.patchProp(el, 'class', null, 'foo bar');
    const ops = drainOps();
    const records = parseOps(ops);

    const classOp = records.find(r => r[0] === OP.SET_CLASS);
    expect(classOp).toBeDefined();
    expect(classOp![2]).toBe('foo bar');
  });
});

// ---------------------------------------------------------------------------
// Programmatic <input>/<textarea> value updates → setValue UI method (#143)
//
// The native field treats the `value` attribute as initial-only once the user
// has edited it, so programmatic model writes (clear-on-send, toolbar
// inserts) must additionally emit INVOKE_UI_METHOD('setValue'). The model
// echo — the re-render caused by the user's own typing — must NOT re-invoke,
// or cursor/IME composition gets disturbed on every keystroke.
// ---------------------------------------------------------------------------

describe('patchProp input value → INVOKE_UI_METHOD (#143)', () => {
  beforeEach(() => {
    resetOpQueue();
    resetRegistry();
    // Both resets together: recycling element ids (resetShadowState) is only
    // safe when nodeOps' module-level per-element maps are cleared too, or
    // stale event slots from earlier tests would be resolved by id.
    resetNodeOpsState();
    resetShadowState();
  });

  function invokeOps(records: unknown[][]): unknown[][] {
    return records.filter(r => r[0] === OP.INVOKE_UI_METHOD);
  }

  /**
   * Mirror the real mount order (verified below against the actual renderer:
   * props are patched BEFORE insertion): create → initial props → insert.
   * Returns the element and, when `withInput`, the registered event sign.
   */
  function mountField(
    type: 'input' | 'textarea',
    initialValue: string,
    withInput = false,
  ): { el: ReturnType<typeof nodeOps.createElement>; sign: string } {
    const parent = nodeOps.createElement('view');
    const el = nodeOps.createElement(type);
    nodeOps.patchProp(el, 'value', null, initialValue);
    if (withInput) nodeOps.patchProp(el, 'bindinput', null, () => undefined);
    nodeOps.insert(el, parent);
    const setup = parseOps(drainOps());
    const sign = (setup.find(r => r[0] === OP.SET_EVENT)?.[4] as string) ?? '';
    return { el, sign };
  }

  it('initial mount emits SET_PROP only (attribute covers first render)', () => {
    const parent = nodeOps.createElement('view');
    const el = nodeOps.createElement('input');
    drainOps();

    nodeOps.patchProp(el, 'value', null, 'seed'); // before insert, as on mount
    nodeOps.insert(el, parent);
    const records = parseOps(drainOps());

    expect(records.find(r => r[0] === OP.SET_PROP && r[2] === 'value' && r[3] === 'seed')).toBeDefined();
    expect(invokeOps(records)).toHaveLength(0);
  });

  it('real renderer mount of <input value=…> emits no INVOKE_UI_METHOD', () => {
    const renderer = createRenderer(nodeOps) as { render: (v: unknown, c: unknown) => void };
    const root = nodeOps.createElement('page');
    drainOps();

    renderer.render(jsx('input', { value: 'seed' }), root);
    const records = parseOps(drainOps());

    expect(records.find(r => r[0] === OP.SET_PROP && r[2] === 'value' && r[3] === 'seed')).toBeDefined();
    expect(invokeOps(records)).toHaveLength(0);
  });

  it('programmatic update emits SET_PROP + INVOKE_UI_METHOD setValue', () => {
    const { el } = mountField('input', 'a');

    nodeOps.patchProp(el, 'value', 'a', 'b');
    const records = parseOps(drainOps());

    expect(records.find(r => r[0] === OP.SET_PROP && r[2] === 'value' && r[3] === 'b')).toBeDefined();
    const invokes = invokeOps(records);
    expect(invokes).toHaveLength(1);
    expect(invokes[0]![1]).toBe(el.id);
    expect(invokes[0]![2]).toBe('setValue');
    expect(invokes[0]![3]).toEqual({ value: 'b' });
  });

  it('post-mount nullish → text transition still invokes (guard is insertion, not prev value)', () => {
    const { el } = mountField('input', 'a');

    nodeOps.patchProp(el, 'value', 'a', null); // value={null} render
    nodeOps.patchProp(el, 'value', null, 'text'); // back to text — prev is nullish
    const invokes = invokeOps(parseOps(drainOps()));
    expect(invokes).toHaveLength(2);
    expect(invokes[0]![3]).toEqual({ value: '' });
    expect(invokes[1]![3]).toEqual({ value: 'text' });
  });

  it('does NOT re-invoke on the model echo of the user typing', () => {
    const { el, sign } = mountField('input', '', true);

    // The user types — Lynx fires the input event, model writes the signal,
    // sigx re-renders with the value the event just reported.
    publishEvent(sign, { detail: { value: 'typed' } });
    nodeOps.patchProp(el, 'value', '', 'typed');
    const records = parseOps(drainOps());

    expect(records.find(r => r[0] === OP.SET_PROP && r[3] === 'typed')).toBeDefined();
    expect(invokeOps(records)).toHaveLength(0);
  });

  it('clear-on-send after typing invokes setValue with the empty string', () => {
    const { el, sign } = mountField('input', '', true);

    publishEvent(sign, { detail: { value: 'hello' } });
    nodeOps.patchProp(el, 'value', '', 'hello'); // echo — no invoke
    drainOps();

    nodeOps.patchProp(el, 'value', 'hello', ''); // programmatic clear
    const invokes = invokeOps(parseOps(drainOps()));
    expect(invokes).toHaveLength(1);
    expect(invokes[0]![3]).toEqual({ value: '' });
  });

  it('toolbar insert after typing invokes setValue with the combined text', () => {
    const { el, sign } = mountField('textarea', '', true);

    publishEvent(sign, { detail: { value: 'hi ' } });
    nodeOps.patchProp(el, 'value', '', 'hi '); // echo
    drainOps();

    nodeOps.patchProp(el, 'value', 'hi ', 'hi **bold** ');
    const invokes = invokeOps(parseOps(drainOps()));
    expect(invokes).toHaveLength(1);
    expect(invokes[0]![3]).toEqual({ value: 'hi **bold** ' });
  });

  it('normalizes nullish writes to "" — no redundant re-invoke after a clear', () => {
    const { el } = mountField('input', 'seed');

    nodeOps.patchProp(el, 'value', 'seed', ''); // programmatic clear → invoke('')
    nodeOps.patchProp(el, 'value', '', null); // nullish — same as the '' already pushed
    const invokes = invokeOps(parseOps(drainOps()));
    expect(invokes).toHaveLength(1);
    expect(invokes[0]![3]).toEqual({ value: '' });
  });

  it('treats an input event without a detail value as the empty string', () => {
    const { el, sign } = mountField('input', 'x', true);

    publishEvent(sign, { detail: {} }); // host cleared the field; no value key
    nodeOps.patchProp(el, 'value', 'x', ''); // echo of the now-empty field
    expect(invokeOps(parseOps(drainOps()))).toHaveLength(0);
  });

  it('coerces non-string writes to strings for the setValue payload', () => {
    const { el } = mountField('input', 'a');

    nodeOps.patchProp(el, 'value', 'a', 5 as unknown as string);
    const invokes = invokeOps(parseOps(drainOps()));
    expect(invokes).toHaveLength(1);
    expect(invokes[0]![3]).toEqual({ value: '5' });
  });

  it('value on a non-form element stays a plain SET_PROP', () => {
    const parent = nodeOps.createElement('view');
    const el = nodeOps.createElement('view');
    nodeOps.patchProp(el, 'value', null, 'a');
    nodeOps.insert(el, parent);
    drainOps();

    nodeOps.patchProp(el, 'value', 'a', 'b');
    const records = parseOps(drainOps());
    expect(records.find(r => r[0] === OP.SET_PROP && r[3] === 'b')).toBeDefined();
    expect(invokeOps(records)).toHaveLength(0);
  });
});
