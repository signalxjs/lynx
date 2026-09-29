/**
 * #1291: a `position: fixed` node removed together with its ancestors in one
 * flush left its native view on the page root (a popped screen stranded an
 * open dialog's panel and scrim). The MT executor commits a fixed node's
 * removal with its own flush, while its ancestors are still attached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { elements } from '../src/element-registry';
import { applyOps, resetMainThreadState, setPlaceholder } from '../src/ops-apply';

type FakeEl = { __id: number; tag: string; children: FakeEl[] };
let nextUid = 5000;
const makeEl = (tag: string): FakeEl => ({ __id: nextUid++, tag, children: [] });

/** The call log: removals and flushes, in order. */
let calls: string[] = [];

beforeEach(() => {
  resetMainThreadState();
  elements.clear();
  calls = [];
  vi.stubGlobal('__CreateView', vi.fn(() => makeEl('view')));
  vi.stubGlobal('__CreateElement', vi.fn((tag: string) => makeEl(tag)));
  vi.stubGlobal('__CreateRawText', vi.fn(() => makeEl('raw-text')));
  vi.stubGlobal('__AppendElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children.push(child);
  }));
  vi.stubGlobal('__InsertElementBefore', vi.fn());
  vi.stubGlobal('__RemoveElement', vi.fn((parent: FakeEl, child: FakeEl) => {
    parent.children = parent.children.filter((c) => c !== child);
    calls.push(`remove ${child.tag}`);
  }));
  vi.stubGlobal('__SetCSSId', vi.fn());
  vi.stubGlobal('__SetAttribute', vi.fn());
  vi.stubGlobal('__SetInlineStyles', vi.fn());
  vi.stubGlobal('__SetClasses', vi.fn());
  vi.stubGlobal('__AddEvent', vi.fn());
  vi.stubGlobal('__FlushElementTree', vi.fn(() => { calls.push('flush'); }));
  vi.stubGlobal('__GetElementUniqueID', vi.fn((el: FakeEl) => el.__id));
  const page = makeEl('page');
  elements.set(1, page as never);
  setPlaceholder(page as never, makeEl('placeholder') as never);
});

/** screen (10) > host (11) > layer (12) > panel (13); the layer's style is `style`. */
function mount(style: unknown): void {
  applyOps([
    OP.CREATE, 10, 'view', OP.CREATE, 11, 'view', OP.CREATE, 12, 'view', OP.CREATE, 13, 'view',
    OP.INSERT, 1, 10, -1, OP.INSERT, 10, 11, -1, OP.INSERT, 11, 12, -1, OP.INSERT, 12, 13, -1,
    OP.SET_STYLE, 12, style,
  ]);
  (elements.get(10) as unknown as FakeEl).tag = 'screen';
  (elements.get(11) as unknown as FakeEl).tag = 'host';
  (elements.get(12) as unknown as FakeEl).tag = 'layer';
  (elements.get(13) as unknown as FakeEl).tag = 'panel';
  calls = [];
}

/** The post-order teardown the BG renderer sends when the screen unmounts. */
const TEARDOWN = [OP.REMOVE, 12, 13, OP.REMOVE, 11, 12, OP.REMOVE, 10, 11, OP.REMOVE, 1, 10];

describe('fixed-position removal (#1291)', () => {
  it('flushes right after a fixed node leaves, before its ancestors do', () => {
    mount({ position: 'fixed', top: 0, left: 0 });
    applyOps(TEARDOWN);
    expect(calls).toEqual([
      'remove panel', 'remove layer', 'flush',
      'remove host', 'remove screen', 'flush',
    ]);
  });

  it('recognises the string style form too', () => {
    mount('top: 0; position: fixed;');
    applyOps(TEARDOWN);
    expect(calls.filter((c) => c === 'flush')).toHaveLength(2);
  });

  it('keeps one flush per batch for ordinary nodes', () => {
    mount({ position: 'absolute' });
    applyOps(TEARDOWN);
    expect(calls).toEqual(['remove panel', 'remove layer', 'remove host', 'remove screen', 'flush']);
  });

  it('stops tracking a node whose style leaves fixed', () => {
    mount({ position: 'fixed' });
    applyOps([OP.SET_STYLE, 12, { position: 'relative' }]);
    calls = [];
    applyOps(TEARDOWN);
    expect(calls.filter((c) => c === 'flush')).toHaveLength(1);
  });
});
