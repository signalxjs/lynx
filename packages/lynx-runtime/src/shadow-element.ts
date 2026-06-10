/**
 * ShadowElement: a lightweight doubly-linked tree node that lives entirely in
 * the Background Thread. It lets the renderer call parentNode() / nextSibling()
 * synchronously, while the real Lynx elements exist only on the Main Thread.
 *
 * id=1 is reserved for the page root (created via __CreatePage on Main Thread).
 * Regular elements start from id=2.
 */

export class ShadowElement {
  static nextId = 2; // 1 is reserved for the page root

  id: number;
  type: string;
  parent: ShadowElement | null = null;
  firstChild: ShadowElement | null = null;
  lastChild: ShadowElement | null = null;
  prev: ShadowElement | null = null;
  next: ShadowElement | null = null;

  // Cached style object (last value passed to patchProp 'style').
  // Used by vShow to merge display:none without losing the original styles.
  _style: Record<string, unknown> = {};
  // Set to true by vShow when the element should be hidden.
  _vShowHidden = false;

  // Class management for Transition support.
  _baseClass = '';
  _transitionClasses: Set<string> = new Set();

  // Last text known to be in the native <input>/<textarea>: recorded from the
  // native input event by nodeOps, and updated by post-mount programmatic
  // writes that go through the setValue UI method. Used to tell a model echo
  // (signal update caused by typing) apart from a programmatic write
  // (clear-on-send, toolbar insert) — only the latter must be pushed back to
  // the native field. Always stored as a string ('' for nullish, matching
  // what setValue pushes); `undefined` until the first input event or
  // setValue-pushing write (the first-render `value` attribute does NOT
  // initialize it).
  _lastInputValue: string | undefined = undefined;

  // Non-empty initial <input>/<textarea> value captured at mount, when the
  // element isn't inserted yet so a setValue UI method can't target it. insert()
  // flushes it via setValue once the element is live and then clears it. Needed
  // because iOS ignores the `value` attribute for initial display — only the
  // setValue UI method updates the field — so model-bound prefill would
  // otherwise show only the placeholder (#404). `undefined` when nothing pending.
  _pendingInitialValue: string | undefined = undefined;

  constructor(type: string, forceId?: number) {
    this.id = forceId !== undefined ? forceId : ShadowElement.nextId++;
    this.type = type;
  }

  insertBefore(child: ShadowElement, anchor: ShadowElement | null): void {
    // Detach from current parent first
    if (child.parent) {
      child.parent.removeChild(child);
    }
    child.parent = this;

    if (anchor) {
      // Insert before anchor
      const prev = anchor.prev;
      child.next = anchor;
      child.prev = prev;
      anchor.prev = child;
      if (prev) {
        prev.next = child;
      } else {
        this.firstChild = child;
      }
    } else {
      // Append at end
      if (this.lastChild) {
        this.lastChild.next = child;
        child.prev = this.lastChild;
      } else {
        this.firstChild = child;
        child.prev = null;
      }
      this.lastChild = child;
      child.next = null;
    }
  }

  removeChild(child: ShadowElement): void {
    const prev = child.prev;
    const next = child.next;
    if (prev) {
      prev.next = next;
    } else {
      this.firstChild = next;
    }
    if (next) {
      next.prev = prev;
    } else {
      this.lastChild = prev;
    }
    child.parent = null;
    child.prev = null;
    child.next = null;
  }
}

export const PAGE_ROOT_ID = 1;

/** Create the page root shadow element with the reserved id=1. */
export function createPageRoot(): ShadowElement {
  return new ShadowElement('page', PAGE_ROOT_ID);
}

/** Reset the ID counter — for testing only. */
export function resetShadowState(): void {
  ShadowElement.nextId = 2;
}
