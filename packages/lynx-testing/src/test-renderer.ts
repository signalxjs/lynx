/**
 * Test renderer — implements RendererOptions<TestNode, TestNode> for
 * in-memory rendering without Lynx PAPI.
 */
import { createRenderer } from '@sigx/runtime-core/internals';
import type { RendererOptions } from '@sigx/runtime-core/internals';
import { TestNode } from './test-node.js';

const nodeOps: RendererOptions<TestNode, TestNode> = {
  createElement(type: string): TestNode {
    return new TestNode(type);
  },

  createText(text: string): TestNode {
    const node = new TestNode('#text');
    node.text = text;
    return node;
  },

  createComment(_text: string): TestNode {
    return new TestNode('#comment');
  },

  setText(node: TestNode, text: string): void {
    node.text = text;
  },

  setElementText(el: TestNode, text: string): void {
    el.children = [];
    const textNode = new TestNode('#text');
    textNode.text = text;
    textNode.parent = el;
    el.children.push(textNode);
  },

  insert(child: TestNode, parent: TestNode, anchor?: TestNode | null): void {
    // Remove from old parent
    if (child.parent) {
      const idx = child.parent.children.indexOf(child);
      if (idx !== -1) child.parent.children.splice(idx, 1);
    }
    child.parent = parent;

    if (anchor) {
      const anchorIdx = parent.children.indexOf(anchor);
      if (anchorIdx !== -1) {
        parent.children.splice(anchorIdx, 0, child);
        return;
      }
    }
    parent.children.push(child);
  },

  remove(child: TestNode): void {
    if (child.parent) {
      const idx = child.parent.children.indexOf(child);
      if (idx !== -1) child.parent.children.splice(idx, 1);
      child.parent = null;
    }
  },

  patchProp(
    el: TestNode,
    key: string,
    _prevValue: unknown,
    nextValue: unknown,
  ): void {
    if (key === 'style') {
      el._style = (nextValue as Record<string, unknown>) ?? {};
      el.props[key] = nextValue;
    } else if (key === 'class') {
      el._class = (nextValue as string) ?? '';
      el.props[key] = nextValue;
    } else if (
      key.startsWith('bind') ||
      key.startsWith('catch') ||
      key.startsWith('on') ||
      key.startsWith('main-thread-bind') ||
      key.startsWith('main-thread-catch') ||
      key.startsWith('global-')
    ) {
      // Event handler
      if (typeof nextValue === 'function') {
        el._handlers.set(key, nextValue as Function);
      } else {
        el._handlers.delete(key);
      }
      el.props[key] = nextValue;
    } else {
      if (nextValue != null) {
        el.props[key] = nextValue;
      } else {
        delete el.props[key];
      }
    }
  },

  parentNode(node: TestNode): TestNode | null {
    return node.parent;
  },

  nextSibling(node: TestNode): TestNode | null {
    if (!node.parent) return null;
    const idx = node.parent.children.indexOf(node);
    return node.parent.children[idx + 1] ?? null;
  },

  cloneNode(node: TestNode): TestNode {
    return new TestNode(node.type);
  },
};

export const testRenderer = createRenderer<TestNode, TestNode>(nodeOps);
export { nodeOps as testNodeOps };
