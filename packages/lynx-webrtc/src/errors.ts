/**
 * Errors and diagnostics for the WebRTC module (convention C10).
 *
 * The whole package exists so browser code ports unchanged, and browser code
 * branches on the DOMException `name` (`err.name === 'NotAllowedError'`). So
 * the W3C name *is* the machine-readable discriminant: it lands on both `name`
 * and `SigxError.code`, rather than inventing a second sigx-only vocabulary
 * for the same failures. Where the spec has no specific name for a failed
 * operation it uses `OperationError`, and so do we.
 *
 * That is also why core's `unwrapNative` isn't used here — it has nowhere to
 * put the W3C name that native reports back as `errorName`.
 */
import { SigxError, createLogger } from '@sigx/lynx-core';

const PKG = 'lynx-webrtc';

/** Module diagnostics — reaches the `sigx dev` terminal via the console transport. */
export const log = createLogger(PKG);

/**
 * A WebRTC failure: a `SigxError` wearing the DOMException name callers expect.
 *
 * Not the W3C `RTCError` (which reports SCTP/DTLS `errorDetail`s); this is the
 * package's own error type, named so it can't be mistaken for it.
 *
 * @param code DOMException-style name, e.g. `'InvalidStateError'` — surfaces as
 *   both `err.code` (C10) and `err.name` (W3C).
 * @param action what was attempted, for the message — usually the method name.
 * @param detail why it failed, lower-cased and ending in a period.
 */
export class WebRTCError extends SigxError {
    constructor(code: string, action: string, detail: string, options?: { cause?: unknown }) {
        super(PKG, code, `[@sigx/${PKG}] ${action} failed: ${detail}`, options);
        this.name = code;
    }
}
