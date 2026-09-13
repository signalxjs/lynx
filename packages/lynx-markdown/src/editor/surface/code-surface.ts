/**
 * `createLynxCodeSurface()` — the `CodeSurface` of the block editor core over
 * a Lynx `<textarea>`.
 *
 * The textarea reports its value through `bindinput` and nothing about its
 * caret, so `getSelection()` is `null` until the core sets one and the
 * boundaries are limited to what the value tells us: Backspace on an empty
 * value cannot be observed (no key events), so a code block is left through
 * the block's own "done" affordance (`exitCode`) or the toolbar. The view
 * owns the element; it feeds `native.*` and renders `value`.
 */

import type { CodeSurface, CodeSurfaceInit, Range } from '@sigx/richtext/editor';

export interface LynxCodeSurfaceNative {
    input(value: string): void;
    focus(): void;
    blur(): void;
}

export interface LynxCodeSurface extends CodeSurface {
    readonly key: string;
    readonly native: LynxCodeSurfaceNative;
    /** The value the view should render into the textarea (reactive through `onValue`). */
    readonly value: string;
    readonly lang: string | null;
    readonly focused: boolean;
    readonly wantsFocus: boolean;
}

export interface LynxCodeSurfaceOptions {
    /** Called when the value the textarea must show changes (an external write). */
    onValue(value: string): void;
    onLang?(lang: string | null): void;
    /** Ask the view to focus / blur the textarea. */
    onFocusRequest(focus: boolean): void;
}

export function createLynxCodeSurface(init: CodeSurfaceInit, opts: LynxCodeSurfaceOptions): LynxCodeSurface {
    const { events } = init;
    let value = init.value;
    let lang = init.lang;
    let focused = false;
    let wantsFocus = false;
    let selection: Range | null = null;
    let readOnly = init.readOnly;

    const native: LynxCodeSurfaceNative = {
        input(next) {
            if (readOnly || next === value) return;
            value = next;
            // Caret unknown: assume it followed the edit to the end of the changed prefix.
            selection = null;
            events.change({ value: next, selection: null, composing: false });
        },
        focus() {
            focused = true;
            wantsFocus = false;
            events.focus();
        },
        blur() {
            focused = false;
            events.blur();
        },
    };

    const surface: LynxCodeSurface = {
        key: init.key,
        native,
        get value() {
            return value;
        },
        get lang() {
            return lang;
        },
        get focused() {
            return focused;
        },
        get wantsFocus() {
            return wantsFocus;
        },
        setValue(next) {
            if (next === value) return;
            value = next;
            opts.onValue(next);
        },
        getValue: () => value,
        setLang(next) {
            if (next === lang) return;
            lang = next;
            opts.onLang?.(next);
        },
        setSelection(r) {
            selection = { start: Math.max(0, Math.min(r.start, value.length)), end: Math.max(0, Math.min(r.end, value.length)) };
        },
        focus(target) {
            const len = value.length;
            const offset = !target ? (selection?.start ?? len) : 'edge' in target ? (target.edge === 'start' ? 0 : len) : target.offset;
            selection = { start: offset, end: offset };
            if (!focused) {
                wantsFocus = true;
                opts.onFocusRequest(true);
            }
        },
        blur() {
            if (focused) opts.onFocusRequest(false);
        },
        getSelection: () => selection,
        setReadOnly(next) {
            readOnly = next;
        },
        destroy() {
            /* the textarea goes with its component */
        },
    };
    return surface;
}
