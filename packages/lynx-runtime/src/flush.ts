/**
 * Flush scheduler — re-exports from op-queue.ts.
 *
 * In the new architecture, the BG thread no longer calls __FlushElementTree
 * directly. Instead, ops are batched in a queue and flushed to the Main Thread
 * via sigxPatchUpdate. This file exists for backwards-compatible imports.
 */
export { scheduleFlush, flushNow, resetOpQueue as resetFlushState } from './op-queue.js';
