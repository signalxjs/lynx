/**
 * The package's short name and its namespaced logger (convention C10).
 *
 * `PKG` is what `unwrapNative(PKG, action, raw)` renders into the thrown
 * `[@sigx/lynx-appearance] <action> failed: <cause>` message; `log` is the
 * diagnostic channel — never a bare `console.*`, so module diagnostics reach
 * the leveled pipeline that streams to the `sigx dev` terminal.
 */
import { createLogger } from '@sigx/lynx-core';

/** Package short name (no scope), as `unwrapNative`/`SigxError` want it. */
export const PKG = 'lynx-appearance';

/** Module diagnostics — reaches the `sigx dev` terminal via the console transport. */
export const log = createLogger(PKG);
