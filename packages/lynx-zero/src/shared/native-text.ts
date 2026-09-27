/**
 * The native text-field seam shared by Input, Textarea (and Field's label):
 * zero's web text attributes mapped onto the lynx `<input>`/`<textarea>`
 * attribute set, the UI-method focus call, and the lynx spelling of a
 * visually-hidden label.
 *
 * Every mapper returns ONLY the keys that carry a value: an unset optional
 * string must never reach the wire, because iOS hands a nulled string prop
 * to the native setter as `NSNull`, which crashes the string bridge.
 */

/** The text-shaped input types zero's Input accepts (`number` is NumberInput's). */
export type InputType = 'text' | 'email' | 'password' | 'search' | 'tel' | 'url';

/** Which virtual keyboard to show (the web `inputmode`). */
export type InputMode = 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';

/** What the virtual keyboard's Enter key says (the web `enterkeyhint`). */
export type EnterKeyHint = 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';

/** The lynx `<input type>` set. */
export type LynxInputType = 'text' | 'number' | 'digit' | 'password' | 'tel' | 'email';

/**
 * The lynx `type` for a zero type + keyboard hint. Lynx has no `search`
 * or `url` field (they are text fields with a different Enter key), and
 * the keyboard hint is how it picks a numeric pad — so `inputmode` decides
 * for a plain text field only; a password or email keeps its own type.
 */
export function lynxInputType(type: InputType | undefined, inputmode: InputMode | undefined): LynxInputType {
    switch (type) {
        case 'password':
        case 'email':
        case 'tel':
            return type;
        default:
            break;
    }
    switch (inputmode) {
        case 'numeric':
            return 'digit';
        case 'decimal':
            return 'number';
        case 'tel':
            return 'tel';
        case 'email':
            return 'email';
        default:
            return 'text';
    }
}

/** Lynx's `confirm-type` covers five of the web's seven Enter-key hints. */
const CONFIRM_TYPES: Partial<Record<EnterKeyHint, string>> = {
    done: 'done', go: 'go', next: 'next', search: 'search', send: 'send',
};

export interface NativeTextOptions {
    placeholder?: string;
    maxlength?: number;
    enterkeyhint?: EnterKeyHint;
    /** A `search` field's Enter key says search unless told otherwise. */
    type?: InputType;
    spellcheck?: boolean;
    autocorrect?: 'on' | 'off';
    autofocus?: boolean;
    disabled: boolean;
    readonly: boolean;
}

/** The native attributes for a text field, with every unset key left out. */
export function nativeTextAttrs(o: NativeTextOptions): Record<string, unknown> {
    const attrs: Record<string, unknown> = {
        disabled: o.disabled,
        readonly: o.readonly,
    };
    if (o.placeholder != null) attrs['placeholder'] = o.placeholder;
    if (o.maxlength != null && Number.isFinite(o.maxlength)) attrs['maxlength'] = o.maxlength;
    const confirm = CONFIRM_TYPES[o.enterkeyhint ?? (o.type === 'search' ? 'search' : 'enter')];
    if (confirm) attrs['confirm-type'] = confirm;
    if (o.spellcheck != null) attrs['ios-spell-check'] = o.spellcheck;
    if (o.autocorrect != null) attrs['ios-auto-correct'] = o.autocorrect === 'on';
    if (o.autofocus) attrs['focus'] = true;
    return attrs;
}

/** The slice of a rendered element the focus call needs (a lynx ShadowElement). */
export interface InvokableElement {
    invoke?: (method: string, params?: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * Focus a native text field through its `focus` UI method — lynx has no
 * `element.focus()`. A stale or not-yet-native element rejects; that is a
 * no-op here, never an unhandled rejection.
 */
export function focusNative(el: InvokableElement | null | undefined): void {
    if (!el || typeof el.invoke !== 'function') return;
    try {
        const result = el.invoke('focus', {});
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
            (result as Promise<unknown>).catch(() => {});
        }
    } catch {
        // No native node yet — nothing to focus.
    }
}

/**
 * A visually-hidden label on lynx: kept in the tree (the reader still has
 * it) but out of layout and paint. The web's `clip` rectangle has no lynx
 * spelling; a 1px transparent absolute box is the same effect.
 */
export const VISUALLY_HIDDEN: Record<string, string> = {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    opacity: '0',
};
