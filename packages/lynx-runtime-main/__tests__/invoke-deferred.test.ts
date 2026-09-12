/**
 * A UI method invoked on an element created in the same batch must wait for
 * the flush that creates its native UI (#1117).
 *
 * `<MarkdownEditor>` splits a block and focuses the new field in one
 * transaction: the field's `ref` fires while the batch is still being
 * applied, so `RichTextMethods.focus` lands in the same ops array as the
 * CREATE. Invoked right there, `__InvokeUIMethod` has no UI to address and
 * the fire-and-forget path swallows the refusal — the focus is simply lost.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { OP } from '@sigx/lynx-runtime-internal';
import { applyOps, resetMainThreadState } from '../src/ops-apply';

/** Every native call in order: `flush` or `invoke:<method>`. */
let calls: string[];

beforeEach(() => {
  resetMainThreadState();
  calls = [];
  vi.stubGlobal('__FlushElementTree', () => { calls.push('flush'); });
  vi.stubGlobal('__InvokeUIMethod', (_el: unknown, method: string) => { calls.push(`invoke:${method}`); });
  vi.stubGlobal('__CreateElement', () => ({}));
  vi.stubGlobal('__CreateView', () => ({}));
  vi.stubGlobal('__CreateText', () => ({}));
  vi.stubGlobal('__CreateRawText', () => ({}));
  vi.stubGlobal('__SetCSSId', () => {});
  vi.stubGlobal('__SetAttribute', () => {});
  vi.stubGlobal('__AppendElement', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMainThreadState();
});

describe('INVOKE_UI_METHOD on an element created in the same batch', () => {
  it('is replayed after the flush that creates the UI, and flushed again', () => {
    applyOps([OP.CREATE, 7, 'sigx-richtext', OP.INVOKE_UI_METHOD, 7, 'focus', {}]);
    expect(calls).toEqual(['flush', 'invoke:focus', 'flush']);
  });

  it('runs inline for an element created in an earlier batch', () => {
    applyOps([OP.CREATE, 7, 'sigx-richtext']);
    calls = [];
    applyOps([OP.INVOKE_UI_METHOD, 7, 'focus', {}]);
    expect(calls).toEqual(['invoke:focus', 'flush']);
  });

  it('keeps the batch order for a mix, and does not carry the parked set across batches', () => {
    applyOps([OP.CREATE, 1, 'view']);
    calls = [];
    applyOps([
      OP.INVOKE_UI_METHOD, 1, 'blur', {},
      OP.CREATE, 2, 'sigx-richtext',
      OP.INVOKE_UI_METHOD, 2, 'setSelectionRange', { start: 0, end: 0 },
      OP.INVOKE_UI_METHOD, 2, 'focus', {},
    ]);
    expect(calls).toEqual(['invoke:blur', 'flush', 'invoke:setSelectionRange', 'invoke:focus', 'flush']);
    calls = [];
    applyOps([OP.INVOKE_UI_METHOD, 2, 'focus', {}]);
    expect(calls).toEqual(['invoke:focus', 'flush']);
  });
});
