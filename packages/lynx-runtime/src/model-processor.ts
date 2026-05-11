/**
 * Platform-specific model processor for Lynx form elements.
 *
 * Wires sigx's `model={() => state.field}` two-way binding directive to
 * Lynx's <input> and <textarea> elements. The processor runs at JSX
 * creation time (called from runtime-core/jsx-runtime.ts when an
 * intrinsic element has a `model` prop) and rewrites the props to:
 *
 *   1. Set the initial `value` from the bound state
 *   2. Install a `bindinput` handler that pushes the new value back into state
 *
 * Lynx differs from DOM in two important ways:
 *
 *   - Lynx <input> fires `bindinput` with `event.detail.value` containing
 *     the new text. There is no DOM-style `target.value` property — the
 *     value lives on the event detail object.
 *   - Lynx Go (and most current Lynx hosts) have no native checkbox or
 *     radio elements. We only handle text-style <input> and <textarea>
 *     here. Adding checkbox/radio later is straightforward — mirror the
 *     branches in packages/runtime-dom/src/model-processor.ts.
 *
 * Mirrors packages/runtime-dom/src/model-processor.ts.
 */

import { setPlatformModelProcessor } from '@sigx/runtime-core/internals';

interface LynxInputEvent {
    detail?: { value?: unknown };
}

setPlatformModelProcessor((type, props, [stateObj, key], _originalProps) => {
    // Helper to set value — uses onUpdate handler if available (for props
    // model forwarding through component boundaries).
    const setValue = (v: unknown): void => {
        const updateHandler = stateObj[`onUpdate:${key}`];
        if (typeof updateHandler === 'function') {
            updateHandler(v);
        } else {
            stateObj[key] = v;
        }
    };

    // Text <input>
    if (type === 'input') {
        props.value = stateObj[key] ?? '';
        const existingBindInput = props.bindinput as
            | ((e: LynxInputEvent) => void)
            | undefined;
        props.bindinput = (e: LynxInputEvent) => {
            const v = e?.detail?.value ?? '';
            setValue(v);
            if (existingBindInput) existingBindInput(e);
        };
        const existingHandler = props['onUpdate:modelValue'];
        props['onUpdate:modelValue'] = (v: unknown) => {
            setValue(v);
            if (existingHandler) existingHandler(v);
        };
        return true;
    }

    // <textarea>
    if (type === 'textarea') {
        props.value = stateObj[key] ?? '';
        const existingBindInput = props.bindinput as
            | ((e: LynxInputEvent) => void)
            | undefined;
        props.bindinput = (e: LynxInputEvent) => {
            const v = e?.detail?.value ?? '';
            setValue(v);
            if (existingBindInput) existingBindInput(e);
        };
        const existingHandler = props['onUpdate:modelValue'];
        props['onUpdate:modelValue'] = (v: unknown) => {
            setValue(v);
            if (existingHandler) existingHandler(v);
        };
        return true;
    }

    // Not handled — fall back to the generic modelValue/onUpdate:modelValue
    // pair so component-level model forwarding still works.
    return false;
});
