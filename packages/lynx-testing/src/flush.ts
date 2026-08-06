/**
 * Waiting on reactive updates in tests.
 *
 * Two levels, and picking the right one is the difference between a stable
 * test and one that fails on a busy CI runner:
 *
 *  - {@link waitForUpdate} / {@link act} advance a **fixed** amount — one
 *    microtask plus one macrotask. Right when the work completes in one turn:
 *    a signal write, a synchronous effect.
 *  - {@link waitFor} polls until a **condition** holds. Right for anything
 *    whose turn count you can't know: a dynamic import, chained effects, a
 *    deferred callback.
 *
 * Guessing turn counts is how tests rot. Two tests in `@sigx/lynx-emoji` did
 * it — one pumped five turns, the other slept 60ms — and both failed once the
 * machine was busy enough. If you're writing `for (let i = 0; i < N; i++)
 * await act(...)` or `setTimeout(r, 60)`, you want `waitFor`.
 */

/**
 * Advance one microtask and one macrotask.
 *
 * Enough for a signal write to reach the rendered tree. **Not** enough for
 * anything involving a dynamic import or a chain of effects — reach for
 * {@link waitFor} there rather than calling this in a loop.
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

export interface WaitForOptions {
  /** Give up after this long, in milliseconds. Default 1000. */
  timeout?: number;
  /** Extra delay between attempts, in milliseconds. Default 0 — one turn. */
  interval?: number;
  /** Named in the timeout message, to say what was being waited for. */
  description?: string;
}

/**
 * Poll `condition` until it returns a truthy value, then return that value.
 *
 * The condition may also signal "not yet" by throwing, which is what lets
 * `waitFor(() => getByText(container, 'Done'))` read naturally — the `getBy*`
 * queries throw when they find nothing.
 *
 * On timeout this throws the condition's **last error** if there was one,
 * rather than a bare "timed out". That error is almost always the useful one:
 * it names what was missing and prints the tree.
 *
 * @example
 * ```ts
 * // Takes however many turns the hydration actually needs.
 * const tabBar = await waitFor(() => getByProp(container, 'role', 'tablist'));
 * ```
 */
export async function waitFor<T>(
  condition: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<T> {
  const { timeout = 1000, interval = 0, description } = options;
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    try {
      const result = await condition();
      if (result) return result;
      lastError = undefined;
    } catch (err) {
      lastError = err;
    }

    if (Date.now() >= deadline) {
      const what = description ? ` waiting for ${description}` : '';
      const prefix =
        `[@sigx/lynx-testing] timed out after ${timeout}ms${what} (${attempts} attempts)`;
      if (lastError instanceof Error) {
        // Re-throw the condition's own failure: `getByText` already says what
        // was missing and prints the tree. Replacing that with a generic
        // timeout turns a useful failure into an unreadable one.
        lastError.message = `${prefix}: ${lastError.message}`;
        throw lastError;
      }
      if (lastError !== undefined) throw lastError;
      // Prefix inlined rather than interpolated from `prefix`: the C10 check
      // reads throw sites textually, so a computed prefix reads as unprefixed.
      throw new Error(
        `[@sigx/lynx-testing] timed out after ${timeout}ms${what} (${attempts} attempts) `
        + '— the condition never returned a truthy value.',
      );
    }

    // A full turn between attempts, so pending effects and microtasks land.
    await waitForUpdate();
    if (interval > 0) await new Promise<void>(r => setTimeout(r, interval));
  }
}
