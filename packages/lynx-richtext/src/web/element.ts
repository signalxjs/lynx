/**
 * `<sigx-richtext>` — **web** implementation of the native rich-text element.
 *
 * The native element (`ios/SigxRichTextUI.swift`, `android/…SigxRichTextBehavior`)
 * has no web counterpart, so on `@lynx-js/web-core` the tag is an inert
 * `HTMLUnknownElement` — `MarkdownEditor` (and the composer) can't be focused or
 * typed into on web (#771). This is a real `contenteditable` custom element that
 * mirrors the native contract so every consumer of `RichTextInput` works on web.
 *
 * ## Where this runs
 *
 * web-core's `__CreateElement` does `document.createElement('sigx-richtext')` in
 * the **host page's main document** (same place it defines `x-view` etc.), so
 * this element is `customElements.define`'d there — served + imported by the
 * generated host page (`sigx run:web` / `build:web`). It is deliberately
 * **import-free at runtime** (type-only imports erase) so the built
 * `dist/web/element.js` is a self-contained ESM module the host page can load
 * without a bundler — the same constraint `@sigx/lynx-web-host`'s `host.ts` has.
 * The pure model/DOM helpers are exported so the package's vitest suite can test
 * them without a browser.
 *
 * ## Contract (must match `src/model/types.ts`, `src/methods.ts`, and native)
 *
 * - Attributes: `value` (JSON `RichDoc`, initial-only), `placeholder`,
 *   `editable`, `min-height`, `max-height`, `font-size`, `text-color`,
 *   `accent-color`, `placeholder-color`, `confirm-type`, `auto-focus`.
 * - Events (`CustomEvent`, bubbles/composed): `change` `{doc,isComposing}`,
 *   `selection` `{start,end,activeFormats,activeBlock,headingLevel?,caretX,caretY,caretHeight}`,
 *   `heightchange` `{height,lines}`, and `lynxfocus`/`lynxblur` — NOT `focus`/
 *   `blur`: web-core's event binding maps the Lynx `focus`/`blur` events to the
 *   DOM `lynxfocus`/`lynxblur` names (see web-elements' `renameEvent`).
 * - UI methods (web-core calls `element[method](params)`): `setDocument`,
 *   `toggleFormat`, `setBlockType`, `applyFormat`, `insertText`,
 *   `setSelectionRange`, `insertChip`, `focus`, `blur`.
 * - Version/echo (from `SigxRichTextUI.swift`): a `localVersion` bumped on every
 *   user edit; `setDocument` is dropped + current state re-emitted while
 *   composing or when `doc.v < localVersion`, else applied with
 *   `localVersion = max(localVersion, doc.v)`.
 *
 * Offsets are **UTF-16 code units** throughout — JS string indices and DOM text
 * node offsets are both UTF-16, so no translation is needed at any boundary.
 */

import type {
  BlockAttr,
  BlockAttrType,
  InlineSpan,
  InlineSpanType,
  RichDoc,
} from '../model/types.js';

// U+FFFC OBJECT REPLACEMENT CHARACTER — the single code unit a mention occupies
// in `text` (the visible label lives only in the span's attrs).
const OBJ = '￼';

const INLINE_TYPES: ReadonlySet<string> = new Set([
  'bold',
  'italic',
  'strike',
  'code',
  'link',
  'mention',
]);
const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'bullet',
  'ordered',
  'task',
  'blockquote',
  'codeBlock',
  'raw',
]);

// ---------------------------------------------------------------------------
// Minimal RichDoc codec (inlined — this module can't import codec.ts at
// runtime and stay servable raw; kept faithful to src/model/codec.ts).
// ---------------------------------------------------------------------------

export function emptyDoc(v = 0): RichDoc {
  return { text: '', spans: [], blocks: [], v };
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

export function decode(raw: string | null | undefined): RichDoc {
  if (!raw) return emptyDoc();
  try {
    const p = JSON.parse(raw) as Partial<RichDoc>;
    const text = typeof p.text === 'string' ? p.text : '';
    const max = text.length;
    const spans: InlineSpan[] = [];
    if (Array.isArray(p.spans)) {
      for (const s of p.spans as InlineSpan[]) {
        if (!s || typeof s.start !== 'number' || typeof s.end !== 'number') continue;
        if (typeof s.type !== 'string' || !INLINE_TYPES.has(s.type)) continue;
        const start = clampInt(s.start, 0, max);
        const end = clampInt(s.end, 0, max);
        if (end <= start) continue;
        const attrs =
          s.attrs && typeof s.attrs === 'object' && !Array.isArray(s.attrs) ? s.attrs : undefined;
        spans.push({ start, end, type: s.type, ...(attrs ? { attrs } : {}) });
      }
    }
    const blocks: BlockAttr[] = [];
    if (Array.isArray(p.blocks)) {
      for (const b of p.blocks as BlockAttr[]) {
        if (!b || typeof b.start !== 'number' || typeof b.end !== 'number') continue;
        if (typeof b.type !== 'string' || !BLOCK_TYPES.has(b.type)) continue;
        const start = clampInt(b.start, 0, max);
        const end = clampInt(b.end, 0, max);
        if (end < start) continue;
        const rawLevel =
          typeof b.level === 'number' && Number.isFinite(b.level) ? Math.floor(b.level) : undefined;
        let level: number | undefined;
        if (rawLevel !== undefined) {
          if (b.type === 'heading') level = clampInt(rawLevel, 1, 6);
          else if (b.type === 'ordered' && rawLevel > 1) level = rawLevel;
        }
        blocks.push({
          start,
          end,
          type: b.type,
          ...(level !== undefined ? { level } : {}),
          ...(b.type === 'task' && typeof b.checked === 'boolean' ? { checked: b.checked } : {}),
          ...(b.type === 'codeBlock' && typeof b.lang === 'string' && b.lang !== ''
            ? { lang: b.lang }
            : {}),
        });
      }
    }
    return {
      text,
      spans,
      blocks,
      v: typeof p.v === 'number' && Number.isFinite(p.v) ? p.v : 0,
    };
  } catch {
    return emptyDoc();
  }
}

export function encode(doc: RichDoc): string {
  return JSON.stringify(doc);
}

// ---------------------------------------------------------------------------
// Block segmentation — `blocks` align to `\n` line boundaries. A doc's lines
// map 1:1 to block records; a line with no explicit block record is a
// paragraph. This is the normalization producers do and native re-snaps.
// ---------------------------------------------------------------------------

interface Line {
  /** Inclusive start offset (UTF-16). */
  start: number;
  /** Exclusive end offset (before the trailing `\n`, or end of text). */
  end: number;
  block: BlockAttr;
}

/** Split `doc.text` into line ranges, attaching each line's block record. */
export function segmentLines(doc: RichDoc): Line[] {
  const lines: Line[] = [];
  const text = doc.text;
  let start = 0;
  // Always at least one line, even for empty text.
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      const end = i;
      const block =
        doc.blocks.find((b) => b.start <= start && b.end >= end && b.end > b.start) ??
        doc.blocks.find((b) => b.start === start) ?? { start, end, type: 'paragraph' as BlockAttrType };
      lines.push({ start, end, block: { ...block, start, end } });
      start = i + 1;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// model → DOM
// ---------------------------------------------------------------------------

const BLOCK_ATTR = 'data-block';
const LEVEL_ATTR = 'data-level';
const CHECKED_ATTR = 'data-checked';
const LANG_ATTR = 'data-lang';
const MENTION_ATTR = 'data-mention';

/** Ordered inline wrapper tags for the simple formats (link/mention are special). */
const FORMAT_TAG: Partial<Record<InlineSpanType, string>> = {
  bold: 'b',
  italic: 'i',
  strike: 's',
  code: 'code',
};

interface RenderOptions {
  /** Document for a `ownerDocument` (so this works under jsdom + browser). */
  doc: Document;
}

/**
 * Build the editable DOM for a `RichDoc` under `root` (cleared first). One
 * block element per line; inline spans become nested wrappers; a mention is a
 * `contenteditable=false` chip standing in for its single U+FFFC.
 */
export function renderDoc(root: HTMLElement, model: RichDoc, opts: RenderOptions): void {
  const d = opts.doc;
  root.textContent = '';
  const lines = segmentLines(model);
  for (const line of lines) {
    const blockEl = d.createElement('div');
    blockEl.setAttribute(BLOCK_ATTR, line.block.type);
    if (line.block.level !== undefined) blockEl.setAttribute(LEVEL_ATTR, String(line.block.level));
    if (line.block.checked !== undefined)
      blockEl.setAttribute(CHECKED_ATTR, line.block.checked ? '1' : '0');
    if (line.block.lang) blockEl.setAttribute(LANG_ATTR, line.block.lang);
    styleBlock(blockEl, line.block.type);
    renderInline(blockEl, model, line.start, line.end, d);
    // An empty block needs a <br> so it has height and the caret can land.
    if (!blockEl.firstChild) blockEl.appendChild(d.createElement('br'));
    root.appendChild(blockEl);
  }
}

/** Render `[start,end)` of `model.text` with its spans into `parent`. */
function renderInline(
  parent: HTMLElement,
  model: RichDoc,
  start: number,
  end: number,
  d: Document,
): void {
  let i = start;
  while (i < end) {
    // A mention chip occupies exactly one code unit.
    const mention = model.spans.find(
      (s) => s.type === 'mention' && s.start === i && s.end === i + 1,
    );
    if (mention) {
      parent.appendChild(makeChip(mention, d));
      i += 1;
      continue;
    }
    // Otherwise, find the longest run whose active simple-formats are constant.
    let j = i + 1;
    const fmtsAt = (k: number) => formatKey(model, k);
    const key = fmtsAt(i);
    while (j < end && fmtsAt(j) === key && !isMentionAt(model, j)) j += 1;
    const segment = model.text.slice(i, j);
    parent.appendChild(wrapFormats(segment, activeSimpleFormats(model, i), linkAt(model, i), d));
    i = j;
  }
}

function isMentionAt(model: RichDoc, at: number): boolean {
  return model.spans.some((s) => s.type === 'mention' && s.start === at && s.end === at + 1);
}

function activeSimpleFormats(model: RichDoc, at: number): InlineSpanType[] {
  const out: InlineSpanType[] = [];
  for (const t of ['bold', 'italic', 'strike', 'code'] as InlineSpanType[]) {
    if (model.spans.some((s) => s.type === t && s.start <= at && s.end > at)) out.push(t);
  }
  return out;
}

function linkAt(model: RichDoc, at: number): string | undefined {
  const link = model.spans.find((s) => s.type === 'link' && s.start <= at && s.end > at);
  return link?.attrs?.href;
}

function formatKey(model: RichDoc, at: number): string {
  return activeSimpleFormats(model, at).join(',') + '|' + (linkAt(model, at) ?? '');
}

/** Nest the active simple-format wrappers (+ optional link) around `text`. */
function wrapFormats(
  text: string,
  formats: InlineSpanType[],
  href: string | undefined,
  d: Document,
): Node {
  let node: Node = d.createTextNode(text);
  for (const f of formats) {
    const tag = FORMAT_TAG[f];
    if (!tag) continue;
    const el = d.createElement(tag);
    el.appendChild(node);
    node = el;
  }
  if (href) {
    const a = d.createElement('a');
    a.setAttribute('href', href);
    a.setAttribute('data-href', href);
    a.appendChild(node);
    node = a;
  }
  return node;
}

function makeChip(span: InlineSpan, d: Document): HTMLElement {
  const chip = d.createElement('span');
  chip.setAttribute(MENTION_ATTR, '1');
  chip.setAttribute('contenteditable', 'false');
  chip.setAttribute('data-id', span.attrs?.id ?? '');
  chip.setAttribute('data-label', span.attrs?.label ?? '');
  if (span.attrs?.kind) chip.setAttribute('data-kind', span.attrs.kind);
  chip.textContent = '@' + (span.attrs?.label ?? '');
  chip.style.cssText =
    'display:inline;border-radius:4px;padding:0 2px;background:rgba(88,101,242,0.15);color:inherit;font-weight:600;';
  return chip;
}

function styleBlock(el: HTMLElement, type: BlockAttrType): void {
  // Minimal visual affordances; the host app's font/colors come from the root.
  el.style.margin = '0';
  switch (type) {
    case 'heading':
      el.style.fontWeight = '700';
      break;
    case 'blockquote':
      el.style.borderLeft = '3px solid currentColor';
      el.style.paddingLeft = '8px';
      el.style.opacity = '0.85';
      break;
    case 'codeBlock':
      el.style.fontFamily = 'monospace';
      el.style.whiteSpace = 'pre-wrap';
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// DOM → model
// ---------------------------------------------------------------------------

/**
 * Read the editable DOM back into a `RichDoc`. The DOM is authoritative after
 * user edits, so this tolerates the browser's structural changes (Enter splits
 * blocks, backspace merges them, etc.): each direct child of `root` is a line;
 * a child without an explicit block type is a paragraph. Mentions collapse to a
 * single U+FFFC; simple inline wrappers and links become spans.
 */
export function readDoc(root: HTMLElement, version: number): RichDoc {
  const blockEls = blockChildren(root);
  let text = '';
  const spans: InlineSpan[] = [];
  const blocks: BlockAttr[] = [];
  blockEls.forEach((blockEl, idx) => {
    if (idx > 0) text += '\n';
    const lineStart = text.length;
    text += readInline(blockEl, lineStart, spans);
    const lineEnd = text.length;
    blocks.push(readBlockAttr(blockEl, lineStart, lineEnd));
  });
  return { text, spans, blocks, v: version };
}

/** The line elements of the editable — its element children (never text nodes). */
function blockChildren(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 1) out.push(node as HTMLElement);
    else if (node.nodeType === 3 && (node.textContent ?? '') !== '') {
      // Bare text directly under root (browsers can produce this) — treat the
      // whole run as an implicit paragraph by wrapping conceptually.
      const span = root.ownerDocument.createElement('div');
      span.setAttribute(BLOCK_ATTR, 'paragraph');
      span.textContent = node.textContent;
      out.push(span);
    }
  }
  return out;
}

/** Append this block's text to the model and record its spans; return the text. */
function readInline(blockEl: HTMLElement, lineStart: number, spans: InlineSpan[]): string {
  let text = '';
  const walk = (node: Node, active: InlineSpanType[], href: string | undefined): void => {
    if (node.nodeType === 3) {
      const s = node.textContent ?? '';
      if (s) {
        const at = lineStart + text.length;
        for (const f of active) spans.push({ start: at, end: at + s.length, type: f });
        if (href) spans.push({ start: at, end: at + s.length, type: 'link', attrs: { href } });
        text += s;
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    if (el.hasAttribute(MENTION_ATTR)) {
      const at = lineStart + text.length;
      const attrs: Record<string, string> = {
        id: el.getAttribute('data-id') ?? '',
        label: el.getAttribute('data-label') ?? '',
      };
      const kind = el.getAttribute('data-kind');
      if (kind) attrs.kind = kind;
      spans.push({ start: at, end: at + 1, type: 'mention', attrs });
      text += OBJ;
      return;
    }
    if (el.tagName === 'BR') {
      // A trailing <br> in an otherwise-empty block is just filler.
      return;
    }
    const tag = el.tagName.toLowerCase();
    const nextActive =
      tag === 'b' || tag === 'strong'
        ? mergeFmt(active, 'bold')
        : tag === 'i' || tag === 'em'
          ? mergeFmt(active, 'italic')
          : tag === 's' || tag === 'strike' || tag === 'del'
            ? mergeFmt(active, 'strike')
            : tag === 'code'
              ? mergeFmt(active, 'code')
              : active;
    const nextHref = tag === 'a' ? el.getAttribute('data-href') ?? el.getAttribute('href') ?? href : href;
    for (const child of Array.from(el.childNodes)) walk(child, nextActive, nextHref);
  };
  for (const child of Array.from(blockEl.childNodes)) walk(child, [], undefined);
  return text;
}

function mergeFmt(active: InlineSpanType[], f: InlineSpanType): InlineSpanType[] {
  return active.includes(f) ? active : [...active, f];
}

function readBlockAttr(el: HTMLElement, start: number, end: number): BlockAttr {
  const rawType = el.getAttribute(BLOCK_ATTR);
  const type: BlockAttrType =
    rawType && BLOCK_TYPES.has(rawType) ? (rawType as BlockAttrType) : 'paragraph';
  const attr: BlockAttr = { start, end, type };
  const level = el.getAttribute(LEVEL_ATTR);
  if (type === 'heading' && level) attr.level = clampInt(Number(level), 1, 6);
  if (type === 'ordered' && level && Number(level) > 1) attr.level = Math.floor(Number(level));
  if (type === 'task') attr.checked = el.getAttribute(CHECKED_ATTR) === '1';
  const lang = el.getAttribute(LANG_ATTR);
  if (type === 'codeBlock' && lang) attr.lang = lang;
  return attr;
}

// ---------------------------------------------------------------------------
// Offset ↔ DOM point mapping (for restoring the caret after a re-render and
// for reading/writing the selection range).
// ---------------------------------------------------------------------------

interface DomPoint {
  node: Node;
  offset: number;
}

/** UTF-16 offset within the whole doc → a (node, offset) point in `root`. */
export function offsetToPoint(root: HTMLElement, target: number): DomPoint {
  let remaining = target;
  const blocks = Array.from(root.childNodes).filter((n) => n.nodeType === 1) as HTMLElement[];
  for (let bi = 0; bi < blocks.length; bi++) {
    if (bi > 0) {
      // The `\n` between blocks costs one unit but has no DOM node — landing
      // exactly on it resolves to the start of this block.
      if (remaining === 0) return { node: blocks[bi], offset: 0 };
      remaining -= 1;
    }
    const len = blockTextLength(blocks[bi]);
    // The offset falls in this block when it fits within its text (the last
    // block also absorbs any residue defensively).
    if (remaining <= len || bi === blocks.length - 1) {
      return pointInBlock(blocks[bi], remaining);
    }
    remaining -= len;
  }
  return { node: root, offset: root.childNodes.length };
}

function pointInBlock(block: HTMLElement, target: number): DomPoint {
  let consumed = 0;
  let point: DomPoint | null = null;
  const visit = (node: Node): boolean => {
    if (point) return true;
    if (node.nodeType === 3) {
      const len = (node.textContent ?? '').length;
      if (target <= consumed + len) {
        point = { node, offset: target - consumed };
        return true;
      }
      consumed += len;
      return false;
    }
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      if (el.hasAttribute(MENTION_ATTR)) {
        if (target <= consumed) {
          point = { node: el.parentNode ?? el, offset: indexOfChild(el) };
          return true;
        }
        consumed += 1;
        return false;
      }
      if (el.tagName === 'BR') return false;
      for (const c of Array.from(el.childNodes)) if (visit(c)) return true;
    }
    return false;
  };
  for (const c of Array.from(block.childNodes)) if (visit(c)) break;
  if (!point) point = { node: block, offset: block.childNodes.length };
  return point;
}

function indexOfChild(el: Node): number {
  let i = 0;
  let n = el.previousSibling;
  while (n) {
    i += 1;
    n = n.previousSibling;
  }
  return i;
}

/** A (node, offset) DOM point → its UTF-16 offset within the whole doc. */
export function pointToOffset(root: HTMLElement, node: Node, nodeOffset: number): number {
  const blocks = Array.from(root.childNodes).filter((n) => n.nodeType === 1) as HTMLElement[];
  let total = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    if (bi > 0) total += 1; // the inter-block newline
    const block = blocks[bi];
    if (block === node || block.contains(node)) {
      return total + offsetWithin(block, node, nodeOffset);
    }
    total += blockTextLength(block);
  }
  return total;
}

function blockTextLength(block: HTMLElement): number {
  let len = 0;
  const visit = (n: Node): void => {
    if (n.nodeType === 3) len += (n.textContent ?? '').length;
    else if (n.nodeType === 1) {
      const el = n as HTMLElement;
      if (el.hasAttribute(MENTION_ATTR)) len += 1;
      else if (el.tagName !== 'BR') for (const c of Array.from(el.childNodes)) visit(c);
    }
  };
  for (const c of Array.from(block.childNodes)) visit(c);
  return len;
}

function offsetWithin(block: HTMLElement, node: Node, nodeOffset: number): number {
  // The point can address the block container itself — `(block, k)` means
  // "before child k", so sum the first k children's lengths (0 → start).
  if (node === block) {
    let len = 0;
    for (const k of Array.from(block.childNodes).slice(0, nodeOffset)) len += subtreeLen(k);
    return len;
  }
  let len = 0;
  let done = false;
  const visit = (n: Node): void => {
    if (done) return;
    if (n === node) {
      // For an element container, nodeOffset counts child nodes; approximate by
      // summing the lengths of the first `nodeOffset` children.
      if (n.nodeType === 3) {
        len += nodeOffset;
        done = true;
        return;
      }
      const kids = Array.from(n.childNodes).slice(0, nodeOffset);
      for (const k of kids) len += subtreeLen(k);
      done = true;
      return;
    }
    if (n.nodeType === 3) {
      len += (n.textContent ?? '').length;
      return;
    }
    if (n.nodeType === 1) {
      const el = n as HTMLElement;
      if (el.hasAttribute(MENTION_ATTR)) {
        len += 1;
        return;
      }
      if (el.tagName === 'BR') return;
      for (const c of Array.from(el.childNodes)) visit(c);
    }
  };
  for (const c of Array.from(block.childNodes)) visit(c);
  return len;
}

function subtreeLen(n: Node): number {
  if (n.nodeType === 3) return (n.textContent ?? '').length;
  if (n.nodeType === 1) {
    const el = n as HTMLElement;
    if (el.hasAttribute(MENTION_ATTR)) return 1;
    if (el.tagName === 'BR') return 0;
    let l = 0;
    for (const c of Array.from(el.childNodes)) l += subtreeLen(c);
    return l;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Pure model mutations (used by the imperative commands; unit-testable).
// ---------------------------------------------------------------------------

/** Shift spans/blocks to account for `delta` code units inserted/removed at `at`. */
function shift(model: RichDoc, at: number, delta: number): { spans: InlineSpan[]; blocks: BlockAttr[] } {
  const adj = (p: number): number => (p >= at ? Math.max(at, p + delta) : p);
  const spans = model.spans
    .map((s) => ({ ...s, start: adj(s.start), end: adj(s.end) }))
    .filter((s) => s.end > s.start);
  const blocks = model.blocks
    .map((b) => ({ ...b, start: adj(b.start), end: adj(b.end) }))
    .filter((b) => b.end >= b.start);
  return { spans, blocks };
}

/** Replace `[from,to)` with `text`, optionally seeding `newSpans` (offsets relative to `from`). */
export function replaceRange(
  model: RichDoc,
  from: number,
  to: number,
  text: string,
  newSpans: InlineSpan[] = [],
): RichDoc {
  const a = clampInt(from, 0, model.text.length);
  const b = clampInt(to, a, model.text.length);
  const removed = model.text.slice(0, a) + model.text.slice(b);
  const nextText = removed.slice(0, a) + text + removed.slice(a);
  // Drop spans fully inside the removed range, then shift for the delta.
  const kept = model.spans.filter((s) => !(s.start >= a && s.end <= b));
  const delta = text.length - (b - a);
  const shifted = shift({ ...model, spans: kept }, a, delta);
  const seeded = newSpans.map((s) => ({
    ...s,
    start: a + s.start,
    end: a + s.end,
  }));
  return {
    text: nextText,
    spans: [...shifted.spans, ...seeded],
    blocks: rebuildBlocks(nextText, shifted.blocks),
    v: model.v,
  };
}

/** Re-snap block ranges to the (possibly changed) line boundaries of `text`. */
function rebuildBlocks(text: string, blocks: BlockAttr[]): BlockAttr[] {
  const out: BlockAttr[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      const end = i;
      const existing = blocks.find((b) => b.start <= start && b.end >= start);
      out.push({ ...(existing ?? { type: 'paragraph' as BlockAttrType }), start, end });
      start = i + 1;
    }
  }
  return out;
}

export interface Chip {
  id: string;
  label: string;
  kind?: string;
}

/** Insert an atomic mention chip (one U+FFFC + a `mention` span), replacing `[from,to)`. */
export function insertChipModel(
  model: RichDoc,
  chip: Chip,
  from: number,
  to: number,
): RichDoc {
  const attrs: Record<string, string> = { id: chip.id, label: chip.label };
  if (chip.kind) attrs.kind = chip.kind;
  return replaceRange(model, from, to, OBJ, [{ start: 0, end: 1, type: 'mention', attrs }]);
}

/**
 * Set (or clear) a no-payload inline format over `[start,end)`, re-coalescing
 * the type's spans into contiguous runs. Attribute-carrying formats (link,
 * mention) are handled separately — this is for bold/italic/strike/code.
 */
export function setInlineFormat(
  model: RichDoc,
  type: InlineSpanType,
  start: number,
  end: number,
  on: boolean,
  attrs?: Record<string, string>,
): RichDoc {
  const len = model.text.length;
  const covered = Array.from<boolean>({ length: len }).fill(false);
  for (const s of model.spans) {
    if (s.type !== type) continue;
    for (let i = Math.max(0, s.start); i < Math.min(len, s.end); i++) covered[i] = true;
  }
  for (let i = Math.max(0, start); i < Math.min(len, end); i++) covered[i] = on;
  const others = model.spans.filter((s) => s.type !== type);
  const runs: InlineSpan[] = [];
  let i = 0;
  while (i < len) {
    if (covered[i]) {
      let j = i + 1;
      while (j < len && covered[j]) j += 1;
      runs.push({ start: i, end: j, type, ...(attrs ? { attrs } : {}) });
      i = j;
    } else {
      i += 1;
    }
  }
  return { ...model, spans: [...others, ...runs] };
}

/** Toggle a no-payload inline format over `[start,end)` (no-op when collapsed). */
export function toggleInlineFormat(
  model: RichDoc,
  type: InlineSpanType,
  start: number,
  end: number,
): RichDoc {
  if (end <= start) return model; // collapsed typing-attribute toggle: see element note
  return setInlineFormat(model, type, start, end, !fullyCovers(model, type, start, end));
}

/** Set the block type of every line overlapping `[start,end)`. */
export function setBlockTypeRange(
  model: RichDoc,
  type: BlockAttrType,
  start: number,
  end: number,
  level?: number,
  checked?: boolean,
): RichDoc {
  const blocks = segmentLines(model).map((l): BlockAttr => {
    const overlaps = l.start <= end && l.end >= start;
    if (!overlaps) return { ...l.block };
    return {
      start: l.start,
      end: l.end,
      type,
      ...(type === 'heading' && level !== undefined ? { level: clampInt(level, 1, 6) } : {}),
      ...(type === 'ordered' && level !== undefined && level > 1 ? { level: Math.floor(level) } : {}),
      ...(type === 'task' && checked !== undefined ? { checked } : {}),
    };
  });
  return { ...model, blocks };
}

// ---------------------------------------------------------------------------
// The custom element
// ---------------------------------------------------------------------------

const TAG = 'sigx-richtext';

interface RichParams {
  [k: string]: unknown;
}

// Extend a real `HTMLElement` in the browser, but fall back to a dummy base so
// this module can be imported in a non-DOM context (the package's vitest suite,
// a bundler's SSR pass) without `class extends undefined` throwing at load. The
// element only functions once `connectedCallback` runs in a real document.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

export class SigxRichTextElement extends HTMLElementBase {
  private editRoot!: HTMLDivElement;
  private placeholderEl!: HTMLDivElement;
  private model: RichDoc = emptyDoc();
  private localVersion = 0;
  private composing = false;
  private built = false;
  private lastHeight = -1;
  private readonly onSelectionChange = (): void => this.emitSelection();

  static get observedAttributes(): string[] {
    return [
      'placeholder',
      'editable',
      'min-height',
      'max-height',
      'font-size',
      'text-color',
      'accent-color',
      'placeholder-color',
    ];
  }

  connectedCallback(): void {
    if (!this.built) this.buildOnce();
    // `selectionchange` is a DOCUMENT-level listener, so it must be (re)attached
    // on every (re)connect — `disconnectedCallback` removes it, and the element
    // can be moved/re-inserted by conditional rendering or navigation. The
    // per-element listeners live on `editRoot` (a child that travels with the
    // element), so they don't need re-adding. `addEventListener` dedupes by the
    // same stable handler, so a double connect is harmless.
    this.ownerDocument.addEventListener('selectionchange', this.onSelectionChange);
    this.reportHeight();
  }

  /** One-time DOM construction + initial-value seed (idempotent via `built`). */
  private buildOnce(): void {
    this.built = true;
    const d = this.ownerDocument;

    this.style.display = this.style.display || 'block';
    this.style.position = this.style.position || 'relative';

    this.editRoot = d.createElement('div');
    this.editRoot.setAttribute('part', 'edit');
    this.editRoot.style.cssText =
      'outline:none;white-space:pre-wrap;word-break:break-word;min-height:1em;';
    this.editRoot.setAttribute('contenteditable', this.getAttribute('editable') === 'false' ? 'false' : 'true');

    this.placeholderEl = d.createElement('div');
    this.placeholderEl.style.cssText =
      'position:absolute;top:0;left:0;pointer-events:none;opacity:0.5;white-space:pre-wrap;';
    this.placeholderEl.textContent = this.getAttribute('placeholder') ?? '';

    this.appendChild(this.placeholderEl);
    this.appendChild(this.editRoot);

    this.applyStyleAttrs();

    // Seed from the initial `value` (JSON RichDoc); it's initial-only, so this
    // runs once — later replacements go through setDocument().
    this.model = decode(this.getAttribute('value'));
    this.localVersion = this.model.v;
    this.render();
    this.updatePlaceholder();

    // These live on `editRoot` (a child), so they persist across
    // disconnect/reconnect — attached once with the element's construction.
    this.editRoot.addEventListener('input', this.handleInput);
    this.editRoot.addEventListener('compositionstart', this.handleCompositionStart);
    this.editRoot.addEventListener('compositionend', this.handleCompositionEnd);
    this.editRoot.addEventListener('focus', this.handleFocus);
    this.editRoot.addEventListener('blur', this.handleBlur);
    this.editRoot.addEventListener('paste', this.handlePaste);

    if (this.getAttribute('auto-focus') === '' || this.getAttribute('auto-focus') === 'true') {
      this.focusEditor();
    }
  }

  disconnectedCallback(): void {
    this.ownerDocument.removeEventListener('selectionchange', this.onSelectionChange);
  }

  attributeChangedCallback(name: string): void {
    if (!this.built) return;
    if (name === 'placeholder') {
      this.placeholderEl.textContent = this.getAttribute('placeholder') ?? '';
      this.updatePlaceholder();
    } else if (name === 'editable') {
      this.editRoot.setAttribute(
        'contenteditable',
        this.getAttribute('editable') === 'false' ? 'false' : 'true',
      );
    } else {
      this.applyStyleAttrs();
      this.reportHeight();
    }
  }

  // --- rendering / state ---------------------------------------------------

  private render(): void {
    renderDoc(this.editRoot, this.model, { doc: this.ownerDocument });
  }

  private applyStyleAttrs(): void {
    const fontSize = this.getAttribute('font-size');
    if (fontSize) this.editRoot.style.fontSize = `${fontSize}px`;
    const color = this.getAttribute('text-color');
    if (color) this.editRoot.style.color = color;
    const accent = this.getAttribute('accent-color');
    if (accent) this.editRoot.style.caretColor = accent;
    const placeholderColor = this.getAttribute('placeholder-color');
    if (placeholderColor) {
      this.placeholderEl.style.color = placeholderColor;
      this.placeholderEl.style.opacity = '1';
    }
    if (fontSize) this.placeholderEl.style.fontSize = `${fontSize}px`;
    const minH = this.getAttribute('min-height');
    if (minH) this.editRoot.style.minHeight = `${minH}px`;
    const maxH = this.getAttribute('max-height');
    if (maxH && Number(maxH) > 0) {
      this.editRoot.style.maxHeight = `${maxH}px`;
      this.editRoot.style.overflowY = 'auto';
    } else {
      this.editRoot.style.maxHeight = '';
      this.editRoot.style.overflowY = '';
    }
  }

  private updatePlaceholder(): void {
    this.placeholderEl.style.display = this.model.text.length === 0 ? 'block' : 'none';
  }

  // --- user-edit handlers --------------------------------------------------

  private handleInput = (): void => {
    if (this.composing) {
      // Still emit change during composition so consumers can gate echo, but
      // read from the live DOM.
      this.model = readDoc(this.editRoot, this.localVersion + 1);
      this.localVersion = this.model.v;
      this.updatePlaceholder();
      this.emitChange(true);
      this.reportHeight();
      return;
    }
    this.model = readDoc(this.editRoot, this.localVersion + 1);
    this.localVersion = this.model.v;
    this.updatePlaceholder();
    this.emitChange(false);
    this.reportHeight();
  };

  private handleCompositionStart = (): void => {
    this.composing = true;
  };

  private handleCompositionEnd = (): void => {
    this.composing = false;
    this.model = readDoc(this.editRoot, this.localVersion + 1);
    this.localVersion = this.model.v;
    this.updatePlaceholder();
    this.emitChange(false);
    this.reportHeight();
  };

  private handleFocus = (): void => {
    this.emit('lynxfocus', {});
  };

  private handleBlur = (): void => {
    this.emit('lynxblur', {});
  };

  private handlePaste = (e: ClipboardEvent): void => {
    // Phase 1: paste as plain text — the safest normalization (no arbitrary
    // HTML into the model). Phase 2 can map basic inline/block structure.
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) this.insertAtCaret(text);
  };

  // --- events --------------------------------------------------------------

  private emit(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, cancelable: true, detail }));
  }

  private emitChange(isComposing: boolean): void {
    this.emit('change', { doc: encode({ ...this.model, v: this.localVersion }), isComposing });
  }

  /**
   * The selection scope for this element. web-core hosts the whole app inside
   * a `<lynx-view>` shadow root, and `document.getSelection()` cannot see a
   * selection inside a shadow tree (it reports the shadow host). Chrome exposes
   * `ShadowRoot.getSelection()`, which returns ranges anchored on our real text
   * nodes — without it, no `selection` events fire (mentions/caret break).
   */
  private selectionScope(): { getSelection(): Selection | null } {
    const root = this.getRootNode() as Node & { getSelection?: () => Selection | null };
    if (typeof root.getSelection === 'function') return root as { getSelection(): Selection | null };
    return this.ownerDocument;
  }

  private emitSelection(): void {
    const sel = this.selectionScope().getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!this.editRoot.contains(range.startContainer)) return;
    const start = pointToOffset(this.editRoot, range.startContainer, range.startOffset);
    const end = pointToOffset(this.editRoot, range.endContainer, range.endOffset);
    const line = segmentLines(this.model).find((l) => start >= l.start && start <= l.end);
    const rect = this.caretRect(range);
    const detail: Record<string, unknown> = {
      start,
      end,
      activeFormats: selectionFormats(this.model, start, end).join(','),
      activeBlock: line?.block.type ?? 'paragraph',
      caretX: rect.x,
      caretY: rect.y,
      caretHeight: rect.height,
    };
    if (line?.block.type === 'heading' && line.block.level !== undefined) {
      detail.headingLevel = line.block.level;
    }
    this.emit('selection', detail);
  }

  private caretRect(range: Range): { x: number; y: number; height: number } {
    const host = this.getBoundingClientRect();
    const rects = range.getClientRects();
    const r = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!r || (r.x === 0 && r.y === 0 && r.height === 0)) return { x: 0, y: 0, height: 0 };
    return { x: r.left - host.left, y: r.top - host.top, height: r.height };
  }

  private reportHeight(): void {
    const height = this.editRoot.scrollHeight;
    const lines = Math.max(1, this.model.text.split('\n').length);
    if (height === this.lastHeight) return;
    this.lastHeight = height;
    this.emit('heightchange', { height, lines });
  }

  // --- caret helpers -------------------------------------------------------

  private currentRange(): { start: number; end: number } {
    const sel = this.selectionScope().getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (this.editRoot.contains(range.startContainer)) {
        return {
          start: pointToOffset(this.editRoot, range.startContainer, range.startOffset),
          end: pointToOffset(this.editRoot, range.endContainer, range.endOffset),
        };
      }
    }
    const len = this.model.text.length;
    return { start: len, end: len };
  }

  private setCaret(start: number, end: number): void {
    const sel = this.selectionScope().getSelection();
    if (!sel) return;
    const a = offsetToPoint(this.editRoot, Math.max(0, start));
    const b = offsetToPoint(this.editRoot, Math.max(0, end));
    const range = this.ownerDocument.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  private insertAtCaret(text: string): void {
    const { start, end } = this.currentRange();
    this.model = replaceRange(this.model, start, end, text);
    this.localVersion += 1;
    this.render();
    this.setCaret(start + text.length, start + text.length);
    this.updatePlaceholder();
    this.emitChange(false);
    this.reportHeight();
  }

  private focusEditor(): void {
    this.editRoot.focus();
    // Place the caret at the end if nothing is selected inside.
    const sel = this.selectionScope().getSelection();
    if (!sel || sel.rangeCount === 0 || !this.editRoot.contains(sel.getRangeAt(0).startContainer)) {
      this.setCaret(this.model.text.length, this.model.text.length);
    }
  }

  // --- UI methods (web-core calls element[method](params)) -----------------

  setDocument(params: RichParams): void {
    if (this.composing) {
      this.emitChange(true);
      return;
    }
    const incoming = decode(String(params.doc ?? ''));
    if (incoming.v < this.localVersion) {
      this.emitChange(false); // re-emit current — stale write dropped
      return;
    }
    this.model = incoming;
    this.localVersion = Math.max(this.localVersion, incoming.v);
    this.render();
    this.updatePlaceholder();
    this.emitChange(false);
    this.reportHeight();
  }

  insertText(params: RichParams): void {
    if (this.composing) return;
    // insertAtCaret bumps localVersion and fires change (native's insertText
    // does exactly one edit).
    this.insertAtCaret(String(params.text ?? ''));
  }

  setSelectionRange(params: RichParams): void {
    const start = Number(params.start ?? 0);
    const end = Number(params.end ?? start);
    this.setCaret(start, end);
  }

  insertChip(params: RichParams): void {
    if (this.composing) return;
    const chip: Chip = {
      id: String(params.id ?? ''),
      label: String(params.label ?? ''),
      ...(params.kind !== undefined ? { kind: String(params.kind) } : {}),
    };
    const sel = this.currentRange();
    const hasReplace = params.replaceFrom !== undefined && params.replaceTo !== undefined;
    const from = hasReplace ? Number(params.replaceFrom) : sel.start;
    const to = hasReplace ? Number(params.replaceTo) : sel.end;
    this.model = insertChipModel(this.model, chip, from, to);
    this.localVersion += 1;
    this.render();
    this.setCaret(from + 1, from + 1);
    this.updatePlaceholder();
    this.emitChange(false);
    this.reportHeight();
  }

  /**
   * Toggle a no-payload inline format over the current selection. A collapsed
   * selection is a no-op here (native flips *typing attributes* so the next
   * char inherits the format; the web element applies formats over an explicit
   * selection instead — the common toolbar flow "select text → bold").
   */
  toggleFormat(params: RichParams): void {
    if (this.composing) return;
    const type = String(params.type ?? '') as InlineSpanType;
    if (!INLINE_TYPES.has(type) || type === 'mention' || type === 'link') return;
    const { start, end } = this.currentRange();
    if (end <= start) return;
    this.model = toggleInlineFormat(this.model, type, start, end);
    this.commitCommand(start, end);
  }

  setBlockType(params: RichParams): void {
    if (this.composing) return;
    const type = String(params.type ?? 'paragraph') as BlockAttrType;
    if (!BLOCK_TYPES.has(type)) return;
    const level = params.level !== undefined ? Number(params.level) : undefined;
    const checked = params.checked !== undefined ? Boolean(params.checked) : undefined;
    const { start, end } = this.currentRange();
    this.model = setBlockTypeRange(this.model, type, start, end, level, checked);
    this.commitCommand(start, end);
  }

  applyFormat(params: RichParams): void {
    if (this.composing) return;
    if (String(params.type ?? '') !== 'link') return;
    const start = Number(params.start ?? 0);
    const end = Number(params.end ?? start);
    if (end <= start) return;
    const attrs = (params.attrs as { href?: string } | undefined) ?? {};
    const href = typeof attrs.href === 'string' ? attrs.href : '';
    // A non-empty href (re)links the range; empty/missing unlinks it.
    this.model = setInlineFormat(this.model, 'link', start, end, href !== '', href !== '' ? { href } : undefined);
    this.commitCommand(start, end);
  }

  /** Shared tail for a formatting/block command: bump, re-render, restore caret, emit. */
  private commitCommand(selStart: number, selEnd: number): void {
    this.localVersion += 1;
    this.render();
    this.setCaret(selStart, selEnd);
    this.updatePlaceholder();
    this.emitChange(false);
    this.reportHeight();
  }

  // `focus`/`blur` override HTMLElement's — the native element IS the editable,
  // so directing focus into the contenteditable child matches its semantics.
  override focus(): void {
    this.focusEditor();
  }

  override blur(): void {
    this.editRoot.blur();
  }
}

/** Caret-position inline formats: at a collapsed caret, look one unit back. */
function caretFormats(model: RichDoc, at: number): InlineSpanType[] {
  const probe = at > 0 ? at - 1 : 0;
  return activeSimpleFormats(model, probe);
}

/**
 * Formats to report for a selection (toolbar active-state). Non-empty: the
 * formats that FULLY cover `[start,end)` (+ a covering link). Collapsed: the
 * formats at the caret. Mirrors what a toolbar highlights.
 */
function selectionFormats(model: RichDoc, start: number, end: number): InlineSpanType[] {
  if (end <= start) return caretFormats(model, start);
  const out: InlineSpanType[] = [];
  for (const t of ['bold', 'italic', 'strike', 'code'] as InlineSpanType[]) {
    if (fullyCovers(model, t, start, end)) out.push(t);
  }
  if (fullyCovers(model, 'link', start, end)) out.push('link');
  return out;
}

/** Whether `[start,end)` is fully covered by a span of `type` (selection variant). */
function fullyCovers(model: RichDoc, type: InlineSpanType, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (!model.spans.some((s) => s.type === type && s.start <= i && s.end > i)) return false;
  }
  return true;
}

export function defineSigxRichText(): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(TAG)) customElements.define(TAG, SigxRichTextElement);
}

defineSigxRichText();
