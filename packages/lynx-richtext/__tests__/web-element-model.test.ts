/**
 * DOM-free unit tests for the web `<sigx-richtext>` model transforms (#771).
 *
 * These cover the UTF-16 offset math and the pure model mutations that back the
 * imperative commands — no browser needed. The DOM round-trip (renderDoc /
 * readDoc / caret mapping) is covered in `web-element-dom.test.ts` (happy-dom),
 * and layout-dependent behaviour (caretRect / heightchange) on the running app.
 */
import { describe, it, expect } from 'vitest';

import {
  decode,
  encode,
  emptyDoc,
  segmentLines,
  replaceRange,
  insertChipModel,
  setInlineFormat,
  toggleInlineFormat,
  setBlockTypeRange,
} from '../src/web/element';
import type { RichDoc } from '../src/model/types';

const OBJ = '￼';

describe('web element — codec parity', () => {
  it('round-trips a document and matches src/model/codec shape', () => {
    const doc: RichDoc = {
      text: 'hi bold\nheading',
      spans: [{ start: 3, end: 7, type: 'bold' }],
      blocks: [{ start: 8, end: 15, type: 'heading', level: 2 }],
      v: 4,
    };
    expect(decode(encode(doc))).toEqual(doc);
  });

  it('degrades malformed / empty input to an empty doc', () => {
    expect(decode('{nope')).toEqual(emptyDoc());
    expect(decode('')).toEqual(emptyDoc());
    expect(decode(undefined)).toEqual(emptyDoc());
  });
});

describe('web element — segmentLines', () => {
  it('always yields at least one (paragraph) line, even for empty text', () => {
    const lines = segmentLines(emptyDoc());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ start: 0, end: 0, block: { type: 'paragraph' } });
  });

  it('splits on newlines and attaches each line its block record', () => {
    const doc: RichDoc = {
      text: 'title\nbody',
      spans: [],
      blocks: [{ start: 0, end: 5, type: 'heading', level: 1 }],
      v: 0,
    };
    const lines = segmentLines(doc);
    expect(lines.map((l) => [l.start, l.end, l.block.type])).toEqual([
      [0, 5, 'heading'],
      [6, 10, 'paragraph'],
    ]);
    expect(lines[0].block.level).toBe(1);
  });
});

describe('web element — replaceRange (offset shifting)', () => {
  const base: RichDoc = {
    text: 'hello world',
    spans: [{ start: 6, end: 11, type: 'bold' }], // "world"
    blocks: [{ start: 0, end: 11, type: 'paragraph' }],
    v: 3,
  };

  it('inserts text and shifts later spans right', () => {
    const next = replaceRange(base, 5, 5, ' big');
    expect(next.text).toBe('hello big world');
    expect(next.spans).toEqual([{ start: 10, end: 15, type: 'bold' }]);
  });

  it('deletes a range and shifts/clips spans', () => {
    const next = replaceRange(base, 0, 6, ''); // drop "hello "
    expect(next.text).toBe('world');
    expect(next.spans).toEqual([{ start: 0, end: 5, type: 'bold' }]);
  });

  it('drops spans wholly inside the replaced range', () => {
    const next = replaceRange(base, 6, 11, 'earth'); // replace "world"
    expect(next.text).toBe('hello earth');
    // the bold span covered exactly the replaced range → gone
    expect(next.spans).toEqual([]);
  });

  it('re-snaps blocks to new line boundaries when a newline is inserted', () => {
    const next = replaceRange(base, 5, 5, '\n'); // split into two lines
    expect(next.text).toBe('hello\n world');
    expect(next.blocks).toEqual([
      { start: 0, end: 5, type: 'paragraph' },
      { start: 6, end: 12, type: 'paragraph' },
    ]);
  });
});

describe('web element — insertChipModel', () => {
  it('inserts one U+FFFC covered by a mention span (label only in attrs)', () => {
    const next = insertChipModel(emptyDoc(), { id: 'u1', label: 'Andy' }, 0, 0);
    expect(next.text).toBe(OBJ);
    expect(next.spans).toEqual([
      { start: 0, end: 1, type: 'mention', attrs: { id: 'u1', label: 'Andy' } },
    ]);
  });

  it('replaces a trigger query run before inserting the chip', () => {
    const doc: RichDoc = { text: 'hi @an', spans: [], blocks: [{ start: 0, end: 6, type: 'paragraph' }], v: 0 };
    // Replace "@an" (offsets 3..6) with the chip.
    const next = insertChipModel(doc, { id: 'u1', label: 'Andy', kind: 'user' }, 3, 6);
    expect(next.text).toBe('hi ' + OBJ);
    expect(next.spans).toEqual([
      { start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy', kind: 'user' } },
    ]);
  });
});

describe('web element — inline format commands (Phase 2)', () => {
  const base: RichDoc = {
    text: 'hello world',
    spans: [],
    blocks: [{ start: 0, end: 11, type: 'paragraph' }],
    v: 0,
  };

  it('toggles a format on over a selection, then off again', () => {
    const on = toggleInlineFormat(base, 'bold', 0, 5); // "hello"
    expect(on.spans).toEqual([{ start: 0, end: 5, type: 'bold' }]);
    const off = toggleInlineFormat(on, 'bold', 0, 5);
    expect(off.spans).toEqual([]);
  });

  it('coalesces adjacent runs when a format is extended', () => {
    const a = setInlineFormat(base, 'italic', 0, 3, true);
    const b = setInlineFormat(a, 'italic', 3, 6, true);
    expect(b.spans).toEqual([{ start: 0, end: 6, type: 'italic' }]);
  });

  it('splits a run when a middle slice is cleared', () => {
    const full = setInlineFormat(base, 'code', 0, 11, true);
    const punched = setInlineFormat(full, 'code', 5, 6, false); // clear the space
    expect(punched.spans).toEqual([
      { start: 0, end: 5, type: 'code' },
      { start: 6, end: 11, type: 'code' },
    ]);
  });

  it('is a no-op for a collapsed toggle (typing-attribute path is native-only)', () => {
    expect(toggleInlineFormat(base, 'bold', 3, 3)).toBe(base);
  });

  it('applies and clears a link with its href', () => {
    const linked = setInlineFormat(base, 'link', 6, 11, true, { href: 'https://x.dev' });
    expect(linked.spans).toEqual([
      { start: 6, end: 11, type: 'link', attrs: { href: 'https://x.dev' } },
    ]);
    const unlinked = setInlineFormat(linked, 'link', 6, 11, false);
    expect(unlinked.spans).toEqual([]);
  });
});

describe('web element — setBlockTypeRange (Phase 2)', () => {
  const doc: RichDoc = {
    text: 'one\ntwo\nthree',
    spans: [],
    blocks: [
      { start: 0, end: 3, type: 'paragraph' },
      { start: 4, end: 7, type: 'paragraph' },
      { start: 8, end: 13, type: 'paragraph' },
    ],
    v: 0,
  };

  it('sets the block type of only the lines overlapping the selection', () => {
    // Selection spanning line 1 and 2 (offsets 5..9).
    const next = setBlockTypeRange(doc, 'bullet', 5, 9);
    expect(next.blocks.map((b) => b.type)).toEqual(['paragraph', 'bullet', 'bullet']);
  });

  it('carries heading level, clamped 1–6', () => {
    const next = setBlockTypeRange(doc, 'heading', 0, 0, 9);
    expect(next.blocks[0]).toMatchObject({ type: 'heading', level: 6 });
  });

  it('seeds a task checkbox', () => {
    const next = setBlockTypeRange(doc, 'task', 0, 0, undefined, false);
    expect(next.blocks[0]).toMatchObject({ type: 'task', checked: false });
  });
});
