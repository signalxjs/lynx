/**
 * Standard Schema validation helper (sync only).
 *
 * `hrefFor` and `parseHref` run on hot paths (link rendering, deep-link
 * resolution) so we restrict to sync validators. Zod/Valibot/ArkType are all
 * sync, which covers the common case. Async validators throw a clear error.
 */

import type { StandardSchemaV1 } from '../types.js';

/**
 * Extended runtime view of a Standard Schema — adds the `validate` function
 * that the spec mandates but `types.ts`'s minimal type omits (for test-fixture
 * ergonomics). Treat any schema-shaped object as potentially carrying it.
 */
interface StandardSchemaRuntime {
    readonly '~standard': {
        readonly version: 1;
        readonly vendor: string;
        readonly validate?: (input: unknown) => StandardResult | PromiseLike<StandardResult>;
    };
}

type StandardResult =
    | { readonly value: unknown; readonly issues?: undefined }
    | { readonly issues: ReadonlyArray<{ readonly message: string }> };

/** Outcome of a sync validation call — discriminated for explicit handling. */
export type ValidateOutcome =
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly issues: ReadonlyArray<string> };

/**
 * Run a Standard Schema's `validate` synchronously. When the schema lacks a
 * `validate` function (e.g. our test `fakeSchema`), passthrough — assume the
 * input is already in the correct shape. This is a deliberate ergonomic
 * choice so the type-spike fixtures stay terse.
 */
export function validateSync(
    schema: StandardSchemaV1 | undefined,
    input: unknown,
): ValidateOutcome {
    if (!schema) return { ok: true, value: input };
    const validate = (schema as StandardSchemaRuntime)['~standard']?.validate;
    if (!validate) return { ok: true, value: input };
    const result = validate(input);
    if (isPromiseLike(result)) {
        throw new Error(
            '[lynx-navigation] Async schema validation is not supported on the URL bridge — use a sync validator (Zod/Valibot/ArkType are all sync).',
        );
    }
    if (result.issues !== undefined && result.issues.length > 0) {
        return {
            ok: false,
            issues: result.issues.map((i) => i.message),
        };
    }
    return { ok: true, value: (result as { value: unknown }).value };
}

function isPromiseLike<T>(v: unknown): v is PromiseLike<T> {
    return (
        v !== null
        && typeof v === 'object'
        && typeof (v as { then?: unknown }).then === 'function'
    );
}
