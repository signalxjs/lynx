/**
 * Query helpers for finding nodes in a TestNode tree.
 */
import { TestNode } from './test-node.js';

export function getByType(container: TestNode, type: string): TestNode {
  const node = container.findByType(type);
  if (!node) throw new Error(`No element found with type "${type}"`);
  return node;
}

export function getAllByType(container: TestNode, type: string): TestNode[] {
  return container.findAllByType(type);
}

export function getByText(container: TestNode, text: string): TestNode {
  const node = container.findByText(text);
  if (!node) throw new Error(`No element found with text "${text}"`);
  return node;
}

export function queryByType(container: TestNode, type: string): TestNode | null {
  return container.findByType(type);
}

export function queryByText(container: TestNode, text: string): TestNode | null {
  return container.findByText(text);
}

export function getByProp(
  container: TestNode,
  key: string,
  value: unknown,
): TestNode {
  function find(node: TestNode): TestNode | null {
    if (node.props[key] === value) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  }
  const node = find(container);
  if (!node) throw new Error(`No element found with ${key}="${value}"`);
  return node;
}
