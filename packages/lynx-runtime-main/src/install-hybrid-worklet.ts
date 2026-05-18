/**
 * Side-effect module that installs the hybrid worklet into upstream's
 * `lynxWorkletImpl._workletMap`.
 *
 * Must be loaded AFTER `@lynx-js/react/worklet-runtime` (which populates
 * `lynxWorkletImpl`) but BEFORE user code runs. The MT bootstrap preamble
 * in `lynx-plugin/src/loaders/worklet-loader-mt.ts` lists it third in the
 * import order:
 *
 *   1. @sigx/lynx-runtime-main/entry-main      (sets SystemInfo + globals)
 *   2. @lynx-js/react/worklet-runtime          (installs lynxWorkletImpl)
 *   3. @sigx/lynx-runtime-main/install-hybrid  (this file)
 *   4. user code                                (calls registerWorkletInternal)
 *
 * Splitting this out is necessary because vite would otherwise hoist any
 * bare `import` statement above whatever sets up its prerequisites.
 */

import { installHybridWorklet } from './hybrid-worklet';

installHybridWorklet();

export {};
