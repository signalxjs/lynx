import type { DirectiveState } from '@sigx/lynx';

/**
 * TestNode — lightweight in-memory tree node for test rendering.
 * Replaces ShadowElement + Lynx PAPI for testing purposes.
 */
export class TestNode {
  type: string;
  props: Record<string, unknown> = {};
  children: TestNode[] = [];
  parent: TestNode | null = null;
  text?: string;

  /** Event handlers keyed by prop name (e.g. 'bindtap', 'bindtouchstart'). */
  _handlers: Map<string, Function> = new Map();

  /**
   * Effective style — the raw style merged with the `show` directive's
   * visibility (`display:none` when hidden). This is what assertions read, so
   * `use:show` is observable in the test tree (mirrors the real renderer, where
   * the effective style is what gets pushed to the main thread).
   */
  _style: Record<string, unknown> = {};

  /** Raw style last set via patchProp('style'), before the `show` merge. */
  _rawStyle: Record<string, unknown> = {};

  /** Set by the `show` directive when the element should be hidden. */
  _vShowHidden = false;

  /** Per-name state for `use:*` directives (managed by the shared runtime). */
  _directives?: Map<string, DirectiveState>;

  /** Class string. */
  _class = '';

  constructor(type: string) {
    this.type = type;
  }

  /**
   * Recompute the effective `_style` from `_rawStyle` + `_vShowHidden`. Called
   * by the test renderer's patchProp and by the test `show` directive.
   */
  _applyStyle(): void {
    this._style = this._vShowHidden
      ? { ...this._rawStyle, display: 'none' }
      : this._rawStyle;
  }

  /** Whether the node is visible (not hidden by `use:show`). */
  get isVisible(): boolean {
    return this._style['display'] !== 'none';
  }

  // -- Tree queries --

  /** Find first descendant matching element type. */
  findByType(type: string): TestNode | null {
    for (const child of this.children) {
      if (child.type === type) return child;
      const found = child.findByType(type);
      if (found) return found;
    }
    return null;
  }

  /** Find all descendants matching element type. */
  findAllByType(type: string): TestNode[] {
    const results: TestNode[] = [];
    for (const child of this.children) {
      if (child.type === type) results.push(child);
      results.push(...child.findAllByType(type));
    }
    return results;
  }

  /** Find first descendant containing the given text. */
  findByText(text: string): TestNode | null {
    if (this.text !== undefined && String(this.text).includes(text)) return this;
    for (const child of this.children) {
      const found = child.findByText(text);
      if (found) return found;
    }
    return null;
  }

  /** Get all text content from this node and descendants. */
  textContent(): string {
    if (this.text !== undefined) return String(this.text);
    return this.children.map(c => c.textContent()).join('');
  }

  /** Debug: serialize tree to a readable string. */
  toDebugString(indent = 0): string {
    const pad = '  '.repeat(indent);
    if (this.type === '#text') return `${pad}${JSON.stringify(this.text)}`;
    if (this.type === '#comment') return `${pad}<!-- -->`;
    const attrs = Object.keys(this.props).length > 0
      ? ' ' + Object.entries(this.props).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
      : '';
    if (this.children.length === 0) return `${pad}<${this.type}${attrs} />`;
    const childStr = this.children.map(c => c.toDebugString(indent + 1)).join('\n');
    return `${pad}<${this.type}${attrs}>\n${childStr}\n${pad}</${this.type}>`;
  }
}
