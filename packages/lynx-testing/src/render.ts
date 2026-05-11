/**
 * render() — mount a sigx Lynx component into a TestNode tree for testing.
 */
import type { JSXElement, AppContext } from '@sigx/lynx';
import { testRenderer } from './test-renderer.js';
import { TestNode } from './test-node.js';
import * as queries from './queries.js';

export interface RenderResult {
  /** The root container node. */
  container: TestNode;
  /** Unmount the component and clean up. */
  unmount: () => void;
  /** Find first node by element type (throws if not found). */
  getByType: (type: string) => TestNode;
  /** Find all nodes by element type. */
  getAllByType: (type: string) => TestNode[];
  /** Find first node containing text (throws if not found). */
  getByText: (text: string) => TestNode;
  /** Find first node by element type (returns null if not found). */
  queryByType: (type: string) => TestNode | null;
  /** Find first node containing text (returns null if not found). */
  queryByText: (text: string) => TestNode | null;
  /** Find first node by prop key/value (throws if not found). */
  getByProp: (key: string, value: unknown) => TestNode;
  /** Debug print the tree. */
  debug: () => string;
}

/**
 * Render a JSX element into an in-memory TestNode tree.
 *
 * @example
 * ```tsx
 * const { getByText, container } = render(<MyComponent name="World" />);
 * expect(getByText('Hello World')).toBeTruthy();
 * ```
 */
export function render(
  element: JSXElement,
  options?: { appContext?: AppContext },
): RenderResult {
  const container = new TestNode('root');

  testRenderer.render(element, container, options?.appContext ?? undefined);

  const unmount = () => {
    testRenderer.render(null, container);
  };

  return {
    container,
    unmount,
    getByType: (type) => queries.getByType(container, type),
    getAllByType: (type) => queries.getAllByType(container, type),
    getByText: (text) => queries.getByText(container, text),
    queryByType: (type) => queries.queryByType(container, type),
    queryByText: (text) => queries.queryByText(container, text),
    getByProp: (key, value) => queries.getByProp(container, key, value),
    debug: () => container.toDebugString(),
  };
}
