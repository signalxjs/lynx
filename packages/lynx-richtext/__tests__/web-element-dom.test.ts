/**
 * @vitest-environment happy-dom
 *
 * DOM round-trip tests for the web `<sigx-richtext>` element (#771).
 *
 * Covers the render↔read direction (model → editable DOM → model) and the
 * element's document/version behaviour. Layout-dependent behaviour (caretRect,
 * scrollHeight-driven heightchange, live `selectionchange`) has no layout under
 * happy-dom and is verified on the running app.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  SigxRichTextElement,
  defineSigxRichText,
  renderDoc,
  readDoc,
  offsetToPoint,
  pointToOffset,
  encode,
  decode,
} from '../src/web/element';
import type { RichDoc } from '../src/model/types';

const OBJ = '￼';

defineSigxRichText();

function makeRoot(): HTMLDivElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

describe('renderDoc ↔ readDoc round-trip', () => {
  const cases: Record<string, RichDoc> = {
    'plain single line': { text: 'hello world', spans: [], blocks: [{ start: 0, end: 11, type: 'paragraph' }], v: 1 },
    'multi-line paragraphs': {
      text: 'line one\nline two\nline three',
      spans: [],
      blocks: [
        { start: 0, end: 8, type: 'paragraph' },
        { start: 9, end: 17, type: 'paragraph' },
        { start: 18, end: 28, type: 'paragraph' },
      ],
      v: 2,
    },
    'a heading and a body': {
      text: 'Title\nbody text',
      spans: [],
      blocks: [
        { start: 0, end: 5, type: 'heading', level: 2 },
        { start: 6, end: 15, type: 'paragraph' },
      ],
      v: 3,
    },
    'inline formats': {
      text: 'a bold and italic run',
      spans: [
        { start: 2, end: 6, type: 'bold' },
        { start: 11, end: 17, type: 'italic' },
      ],
      blocks: [{ start: 0, end: 21, type: 'paragraph' }],
      v: 4,
    },
    'a mention chip (one U+FFFC)': {
      text: 'hi ' + OBJ + ' there',
      spans: [{ start: 3, end: 4, type: 'mention', attrs: { id: 'u1', label: 'Andy' } }],
      blocks: [{ start: 0, end: 10, type: 'paragraph' }],
      v: 5,
    },
    'emoji stays two code units': {
      text: 'wave 👋 done',
      spans: [{ start: 0, end: 4, type: 'bold' }],
      blocks: [{ start: 0, end: 12, type: 'paragraph' }],
      v: 6,
    },
  };

  for (const [name, doc] of Object.entries(cases)) {
    it(name, () => {
      const root = makeRoot();
      renderDoc(root, doc, { doc: document });
      const read = readDoc(root, doc.v);
      expect(read.text).toBe(doc.text);
      // Spans/blocks compare after JSON round-trip (order-independent by design
      // in these cases — one span/block per feature).
      expect(read.spans).toEqual(doc.spans);
      expect(read.blocks.map((b) => [b.start, b.end, b.type, b.level])).toEqual(
        doc.blocks.map((b) => [b.start, b.end, b.type, b.level]),
      );
    });
  }
});

describe('offset ↔ DOM point mapping', () => {
  it('round-trips every offset in a multi-line doc with a chip', () => {
    const doc: RichDoc = {
      text: 'ab\n' + OBJ + 'cd',
      spans: [{ start: 3, end: 4, type: 'mention', attrs: { id: 'x', label: 'X' } }],
      blocks: [
        { start: 0, end: 2, type: 'paragraph' },
        { start: 3, end: 6, type: 'paragraph' },
      ],
      v: 0,
    };
    const root = makeRoot();
    renderDoc(root, doc, { doc: document });
    for (let off = 0; off <= doc.text.length; off++) {
      const p = offsetToPoint(root, off);
      const back = pointToOffset(root, p.node, p.offset);
      expect(back).toBe(off);
    }
  });
});

describe('SigxRichTextElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function mount(attrs: Record<string, string> = {}): SigxRichTextElement {
    const el = document.createElement('sigx-richtext') as SigxRichTextElement;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.body.appendChild(el);
    return el;
  }

  it('seeds from the initial `value` and renders it', () => {
    const doc: RichDoc = { text: 'seeded', spans: [], blocks: [{ start: 0, end: 6, type: 'paragraph' }], v: 2 };
    const el = mount({ value: encode(doc) });
    expect(el.textContent).toContain('seeded');
  });

  it('setDocument applies a newer doc and emits change carrying it', () => {
    const el = mount({ value: encode({ text: 'old', spans: [], blocks: [], v: 1 }) });
    const changes: Array<{ doc: string; isComposing: boolean }> = [];
    el.addEventListener('change', (e) => changes.push((e as CustomEvent).detail));
    el.setDocument({ doc: encode({ text: 'fresh', spans: [], blocks: [], v: 5 }) });
    expect(changes).toHaveLength(1);
    expect(decode(changes[0].doc).text).toBe('fresh');
    expect(changes[0].isComposing).toBe(false);
  });

  it('setDocument drops a stale write (v < localVersion) and re-emits current', () => {
    const el = mount({ value: encode({ text: 'current', spans: [], blocks: [], v: 10 }) });
    const changes: Array<{ doc: string }> = [];
    el.addEventListener('change', (e) => changes.push((e as CustomEvent).detail));
    el.setDocument({ doc: encode({ text: 'stale', spans: [], blocks: [], v: 3 }) });
    // Dropped: text stays 'current', but a re-emit fires so JS reconciles.
    expect(changes).toHaveLength(1);
    expect(decode(changes[0].doc).text).toBe('current');
    expect(el.textContent).toContain('current');
  });

  it('dispatches lynxfocus / lynxblur (not focus / blur) for the bridge', () => {
    const el = mount();
    const seen: string[] = [];
    el.addEventListener('lynxfocus', () => seen.push('focus'));
    el.addEventListener('lynxblur', () => seen.push('blur'));
    // Drive the inner editable's focus/blur listeners directly (happy-dom
    // focus() doesn't always emit).
    const edit = el.querySelector('[part="edit"]') as HTMLElement;
    edit.dispatchEvent(new Event('focus'));
    edit.dispatchEvent(new Event('blur'));
    expect(seen).toEqual(['focus', 'blur']);
  });

  it('keeps firing selection events after a disconnect + reconnect', () => {
    // The document-level `selectionchange` listener must be re-attached on
    // reconnect — conditional rendering / navigation moves the element.
    const el = mount({ value: encode({ text: 'abc', spans: [], blocks: [], v: 1 }) });
    const parent = el.parentElement!;
    parent.removeChild(el); // disconnectedCallback removes the listener
    parent.appendChild(el); // connectedCallback must re-add it

    const sels: unknown[] = [];
    el.addEventListener('selection', (e) => sels.push((e as CustomEvent).detail));
    const edit = el.querySelector('[part="edit"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(edit);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    expect(sels.length).toBeGreaterThan(0);
  });

  it('reads user edits back into the model on input', () => {
    const el = mount();
    const edit = el.querySelector('[part="edit"]') as HTMLElement;
    edit.textContent = '';
    const block = document.createElement('div');
    block.setAttribute('data-block', 'paragraph');
    block.textContent = 'typed';
    edit.appendChild(block);
    const changes: Array<{ doc: string }> = [];
    el.addEventListener('change', (e) => changes.push((e as CustomEvent).detail));
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toHaveLength(1);
    expect(decode(changes[0].doc).text).toBe('typed');
  });
});
