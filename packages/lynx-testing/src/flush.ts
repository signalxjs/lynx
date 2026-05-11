/**
 * Utilities for waiting on reactive updates in tests.
 */

/**
 * Wait for all pending reactive effects and microtasks to complete.
 * Use after mutating signal state to ensure the rendered tree is updated.
 *
 * @example
 * ```ts
 * state.count = 5;
 * await waitForUpdate();
 * expect(getByText(container, '5')).toBeTruthy();
 * ```
 */
export function waitForUpdate(): Promise<void> {
  return new Promise<void>((resolve) => {
    // Microtask (Promise.resolve) runs reactive effects,
    // then setTimeout(0) ensures any scheduled flushes complete.
    Promise.resolve()
      .then(() => new Promise<void>(r => setTimeout(r, 0)))
      .then(resolve);
  });
}

/**
 * Run a callback and wait for reactive effects to flush.
 *
 * @example
 * ```ts
 * await act(() => {
 *   state.count++;
 *   state.name = 'Alice';
 * });
 * // Tree is now updated
 * ```
 */
export async function act(fn: () => void | Promise<void>): Promise<void> {
  await fn();
  await waitForUpdate();
}
