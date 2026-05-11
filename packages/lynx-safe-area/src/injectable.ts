import { defineInjectable } from '@sigx/lynx';
import type { SafeAreaContextValue } from './types.js';

/**
 * The DI handle for the safe-area context.
 *
 * - Inside `<SafeAreaProvider>`'s setup we call `defineProvide(useSafeAreaContext, factory)`
 *   to install a per-app instance.
 * - Anywhere downstream `useSafeAreaContext()` returns that instance, or
 *   `null` if no provider is in scope. Hooks defined in `./hooks.ts` wrap
 *   this with the null-check + signal subscription.
 *
 * The factory returns `null` at the global-singleton level so consumers
 * outside a `<SafeAreaProvider>` get a clear signal (vs. a phantom zero-
 * insets context that silently does nothing).
 */
export const useSafeAreaContext = defineInjectable<SafeAreaContextValue | null>(() => null);
