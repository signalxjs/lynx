/**
 * SigxError and unwrapNative — the one error shape and the one native-result
 * unwrap for every `@sigx/lynx-*` package (conventions C4 and C10).
 *
 * `callAsync` rejects only when the *synchronous* call into the bridge throws.
 * Native-side failures arrive on the resolved callback as `{ error: string }`,
 * so every package has to unwrap — and five different unwraps grew:
 * `settleCapture` (camera), `unwrap` (secure-storage), `unwrapVoid` (audio),
 * inline `if (r?.error) throw`, and — worst — swallowing the error entirely
 * (datetime-picker, where a bridge failure became `{ cancelled: true }` and
 * was indistinguishable from the user tapping Cancel).
 *
 * One unwrap, one message format, one place to fix the next edge case.
 */

/**
 * Base error for anything a caller might branch on.
 *
 * `code` is the stable, machine-readable discriminant; the message is for
 * humans and may change. Modeled on `UpdatesError`/`UpdatesErrorCode`, which
 * was the only typed error in the repo before this.
 */
export class SigxError extends Error {
    /** Stable, machine-readable discriminant — branch on this, not the message. */
    readonly code: string;
    /** The `@sigx/lynx-*` package that raised it. */
    readonly package: string;
    /**
     * The underlying value — usually the raw native payload.
     *
     * Declared and assigned here rather than passed to `super`: this package
     * targets ES2020, which predates the two-argument `Error` constructor and
     * `Error.cause`. The field is shaped the same, so it merges cleanly if the
     * target is ever raised.
     */
    readonly cause?: unknown;

    constructor(pkg: string, code: string, message: string, options?: { cause?: unknown }) {
        super(message);
        this.name = 'SigxError';
        this.code = code;
        this.package = pkg;
        if (options && 'cause' in options) this.cause = options.cause;
        // Native/older runtimes don't always honour `new.target` for subclassed
        // builtins; without this, `instanceof` fails after transpilation.
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** True for a `SigxError`, narrowing `unknown` in a catch block. */
export function isSigxError(e: unknown): e is SigxError {
    return e instanceof SigxError;
}

/** The `{ error }` envelope a native module resolves on failure. */
interface NativeErrorEnvelope {
    error?: unknown;
}

/**
 * Unwrap a native result, throwing on the `{ error }` envelope.
 *
 * ```ts
 * const raw = await callAsync<{ uri?: string; error?: string }>('Camera', 'takePicture', opts);
 * const { uri } = unwrapNative('lynx-camera', 'takePicture', raw);
 * ```
 *
 * Throws a `SigxError` with `code: 'native_error'` and the message
 * `[@sigx/lynx-<pkg>] <action> failed: <native message>` (C10). A package that
 * deliberately returns failures as values instead — Haptics is the reasoned
 * example — documents that in both the method's JSDoc and its README, per C3.
 *
 * @param pkg package short name without the scope, e.g. `'lynx-camera'`
 * @param action what was attempted, for the message — usually the method name
 * @param raw whatever the bridge resolved
 */
export function unwrapNative<T>(pkg: string, action: string, raw: T): T {
    const envelope = raw as NativeErrorEnvelope | null | undefined;
    if (envelope != null && typeof envelope === 'object' && envelope.error != null) {
        const detail =
            typeof envelope.error === 'string' ? envelope.error : JSON.stringify(envelope.error);
        throw new SigxError(
            pkg,
            'native_error',
            `[@sigx/${pkg}] ${action} failed: ${detail}`,
            { cause: raw },
        );
    }
    return raw;
}

/**
 * `unwrapNative` for calls whose success payload is nothing.
 *
 * Native void methods resolve `undefined` on success and `{ error }` on
 * failure, so the return value is never useful — this keeps the call site from
 * having to ignore it.
 */
export function unwrapNativeVoid(pkg: string, action: string, raw: unknown): void {
    unwrapNative(pkg, action, raw);
}
