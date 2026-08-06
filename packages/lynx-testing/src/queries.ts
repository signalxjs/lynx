/**
 * Query helpers for finding nodes in a TestNode tree.
 *
 * Three flavours, matching `@testing-library`'s convention so the naming is one
 * less thing to learn:
 *
 *  - `getBy*`   — throws if not found. Use when it must already be there.
 *  - `queryBy*` — returns `null` if not found. Use to assert absence.
 *  - `findBy*`  — async; waits for it to appear. Use when it arrives later.
 *
 * A failing `getBy*`/`findBy*` prints the tree it searched. Without that a
 * failure says only that something wasn't found, which is most of the way to
 * useless — it's what made a real flake in `@sigx/lynx-emoji` read as a bare
 * `-1` with nothing to go on.
 */
import { TestNode } from './test-node.js';
import { waitFor, type WaitForOptions } from './flush.js';

const PKG = '[@sigx/lynx-testing]';

/** Depth of the printed tree — enough to locate a node, short enough to read. */
const MAX_PRINT_DEPTH = 12;
/** Cap the printout so a 10k-cell list can't bury the actual message. */
const MAX_PRINT_NODES = 200;

/**
 * Render the tree the way an assertion failure needs to read it: type, the
 * props most likely to identify a node, and text.
 */
export function formatTree(node: TestNode): string {
  const lines: string[] = [];
  let printed = 0;

  const walk = (n: TestNode, depth: number): void => {
    if (printed >= MAX_PRINT_NODES) return;
    printed += 1;
    const indent = '  '.repeat(depth);
    if (depth > MAX_PRINT_DEPTH) {
      lines.push(`${indent}… (deeper nodes omitted)`);
      return;
    }
    const attrs: string[] = [];
    for (const key of ['id', 'name', 'role']) {
      const v = n.props[key];
      if (typeof v === 'string' && v !== '') attrs.push(`${key}="${v}"`);
    }
    if (n._class) attrs.push(`class="${n._class}"`);
    const text = n.text !== undefined && n.text !== '' ? ` — ${JSON.stringify(n.text)}` : '';
    lines.push(`${indent}<${n.type}${attrs.length ? ' ' + attrs.join(' ') : ''}>${text}`);
    for (const child of n.children) walk(child, depth + 1);
  };

  walk(node, 0);
  if (printed >= MAX_PRINT_NODES) lines.push(`… (truncated at ${MAX_PRINT_NODES} nodes)`);
  return lines.join('\n');
}

function notFound(what: string, container: TestNode): Error {
  return new Error(`${PKG} ${what}\n\nTree searched:\n${formatTree(container)}`);
}

export function getByType(container: TestNode, type: string): TestNode {
  const node = container.findByType(type);
  if (!node) throw notFound(`No element found with type "${type}".`, container);
  return node;
}

export function getAllByType(container: TestNode, type: string): TestNode[] {
  return container.findAllByType(type);
}

export function getByText(container: TestNode, text: string): TestNode {
  const node = container.findByText(text);
  if (!node) throw notFound(`No element found with text "${text}".`, container);
  return node;
}

export function queryByType(container: TestNode, type: string): TestNode | null {
  return container.findByType(type);
}

export function queryByText(container: TestNode, text: string): TestNode | null {
  return container.findByText(text);
}

function findPropIn(container: TestNode, key: string, value: unknown): TestNode | null {
  const find = (node: TestNode): TestNode | null => {
    if (node.props[key] === value) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  return find(container);
}

export function getByProp(container: TestNode, key: string, value: unknown): TestNode {
  const node = findPropIn(container, key, value);
  if (!node) throw notFound(`No element found with ${key}="${String(value)}".`, container);
  return node;
}

export function queryByProp(container: TestNode, key: string, value: unknown): TestNode | null {
  return findPropIn(container, key, value);
}

/**
 * Scope queries to a subtree.
 *
 * ```ts
 * const row = getByProp(container, 'id', 'row-3');
 * expect(within(row).queryByText('Delete')).toBeTruthy();
 * ```
 *
 * Without it, a query for a common node type finds the first one anywhere in
 * the tree, which is rarely the one the assertion meant.
 */
export function within(node: TestNode) {
  return {
    getByType: (type: string) => getByType(node, type),
    getAllByType: (type: string) => getAllByType(node, type),
    getByText: (text: string) => getByText(node, text),
    getByProp: (key: string, value: unknown) => getByProp(node, key, value),
    queryByType: (type: string) => queryByType(node, type),
    queryByText: (text: string) => queryByText(node, text),
    queryByProp: (key: string, value: unknown) => queryByProp(node, key, value),
  };
}

// ---------------------------------------------------------------------------
// Async queries — `waitFor` plus the matching `getBy*`.
//
// These exist so tests stop guessing how many turns a mount takes. Both flaky
// tests in @sigx/lynx-emoji came from that guess; see `flush.ts`.
// ---------------------------------------------------------------------------

export function findByType(
  container: TestNode,
  type: string,
  options?: WaitForOptions,
): Promise<TestNode> {
  return waitFor(() => getByType(container, type), { description: `type "${type}"`, ...options });
}

export function findByText(
  container: TestNode,
  text: string,
  options?: WaitForOptions,
): Promise<TestNode> {
  return waitFor(() => getByText(container, text), { description: `text "${text}"`, ...options });
}

export function findByProp(
  container: TestNode,
  key: string,
  value: unknown,
  options?: WaitForOptions,
): Promise<TestNode> {
  return waitFor(() => getByProp(container, key, value), {
    description: `${key}="${String(value)}"`,
    ...options,
  });
}
