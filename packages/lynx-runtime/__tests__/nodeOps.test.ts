import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRenderer } from '@sigx/runtime-core/internals';
import { jsx } from '@sigx/runtime-core';
import { nodeOps } from '../src/nodeOps.js';
import { resetOpQueue, takeOps } from '../src/op-queue.js';
import { resetRegistry } from '../src/event-registry.js';
import { resetShadowState } from '../src/shadow-element.js';
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
