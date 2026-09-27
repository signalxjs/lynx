/**
 * Wave 2 W2C (#1205, epic #1140): Input, Textarea and Field on the zero
 * anatomy. Every state the tests drive is held to BOTH oracles (anatomy +
 * class grammar); the native-field seams (model write-through, the lynx
 * attribute mapping, focus through the UI method, NSNull-safe attributes)
 * are pinned on the rendered TestNode tree.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, touch } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { provideFieldsetContext } from '@sigx/zero/behaviors/core';
import { component } from '@sigx/lynx';
import type { Define } from '@sigx/lynx';
import { Field, Input, Switch, Textarea } from '../src/index';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';
import { lynxInputType, nativeTextAttrs } from '../src/shared/native-text';

const conforms = (container: unknown, scope: keyof typeof anatomies): void => {
    expectAnatomy(container as never, anatomies[scope]);
    expectClassGrammar(container as never, anatomies[scope]);
};

const allParts = (root: TestNode, scope: string, part: string): TestNode[] => {
    const out: TestNode[] = [];
    const walk = (n: TestNode): void => {
        if (n.props['data-scope'] === scope && n.props['data-part'] === part) out.push(n);
        for (const child of n.children) walk(child);
    };
    walk(root);
    return out;
};
const byPart = (root: TestNode, scope: string, part: string): TestNode => {
    const found = allParts(root, scope, part)[0];
    if (!found) throw new Error(`no ${scope}.${part}`);
    return found;
};
const byType = (root: TestNode, type: string): TestNode => {
    let found: TestNode | null = null;
    const walk = (n: TestNode): void => {
        if (!found && n.type === type) found = n;
        for (const child of n.children) walk(child);
    };
    walk(root);
    if (!found) throw new Error(`no <${type}>`);
    return found;
};
const handler = (node: TestNode, key: string): ((e?: unknown) => void) => {
    const h = node._handlers.get(key);
    if (!h) throw new Error(`no ${key} on ${node.type}`);
    return h as (e?: unknown) => void;
};
const cls = (node: TestNode): string => String(node._class ?? node.props['class'] ?? '');

/**
 * Type into a native field. On device the lynx model processor turns the
 * element's `model` into `value` + a `bindinput` handler; this test graph
 * resolves the generic processor instead (`value` + `onUpdate:modelValue`),
 * so drive whichever the binding installed — both write the same Model.
 */
const typeInto = (node: TestNode, value: string): void => {
    if (node._handlers.has('bindinput')) fireEvent.input(node, { detail: { value } });
    else (node.props['onUpdate:modelValue'] as (v: string) => void)(value);
};

/** Give the native field a spy `invoke` — the lynx UI-method call focus goes through. */
const spyInvoke = (node: TestNode): ReturnType<typeof vi.fn> => {
    const invoke = vi.fn(() => Promise.resolve());
    (node as unknown as { invoke: unknown }).invoke = invoke;
    return invoke;
};

const BasicInput = (extra: Record<string, unknown> = {}) => (
    <Input.Root {...extra}>
        <Input.Label>Email</Input.Label>
        <Input.Control>
            <Input.Adornment placement="start"><text>@</text></Input.Adornment>
            <Input.Input placeholder="you@example.com" />
            <Input.ClearTrigger />
        </Input.Control>
    </Input.Root>
);

describe('Input — anatomy', () => {
    it('renders root/label/control/input/adornment on the native <input> and conforms', () => {
        const { container } = render(BasicInput());
        expect(byPart(container, 'input', 'input').type).toBe('input');
        expect(byPart(container, 'input', 'control').type).toBe('view');
        expect(byPart(container, 'input', 'adornment').props['data-placement']).toBe('start');
        expect(cls(byPart(container, 'input', 'adornment'))).toContain('zx-p-start');
        // Empty: the clear-trigger renders nothing.
        expect(allParts(container, 'input', 'clear-trigger')).toHaveLength(0);
        conforms(container, 'input');
    });

    it('stamps every flag on the parts that declare it, and conforms', () => {
        const { container } = render(BasicInput({ disabled: true, invalid: true, required: true, readonly: true, defaultValue: 'x' }));
        const root = byPart(container, 'input', 'root');
        for (const flag of ['disabled', 'invalid', 'required', 'readonly']) expect(cls(root)).toContain(`zx-f-${flag}`);
        const control = byPart(container, 'input', 'control');
        expect(cls(control)).toContain('zx-f-invalid');
        expect(cls(control)).not.toContain('zx-f-required'); // not declared on control
        const input = byPart(container, 'input', 'input');
        expect(input.props['disabled']).toBe(true);
        expect(input.props['readonly']).toBe(true);
        // Clearing is an edit: inert while readonly/disabled.
        expect(cls(byPart(container, 'input', 'clear-trigger'))).toContain('zx-f-disabled');
        conforms(container, 'input');
    });

    it('carries color + size axes down to every part', () => {
        const { container } = render(BasicInput({ color: 'primary', size: 'lg', defaultValue: 'hi' }));
        for (const part of ['root', 'label', 'control', 'input', 'adornment', 'clear-trigger']) {
            const c = cls(byPart(container, 'input', part));
            expect(c, part).toContain('zx-a-size-lg');
            expect(c, part).toContain('zx-a-color-primary');
        }
        conforms(container, 'input');
    });

    it('forced focus-visible narrowed to the control conforms', () => {
        const { container } = render(
            <ForceStates flags={{ 'focus-visible': true }} parts={['control']}>
                {BasicInput()}
            </ForceStates>,
        );
        expect(cls(byPart(container, 'input', 'control'))).toContain('zx-f-focus-visible');
        expect(cls(byPart(container, 'input', 'input'))).not.toContain('zx-f-focus-visible');
        conforms(container, 'input');
    });
});

describe('Input — model and native field', () => {
    it('writes the model through on every keystroke and emits valueChange', async () => {
        const state = signal({ email: '' });
        const changes: string[] = [];
        const { container } = render(
            <Input.Root model={() => state.email} onValueChange={(v: string) => changes.push(v)}>
                <Input.Control><Input.Input /></Input.Control>
            </Input.Root>,
        );
        const input = byPart(container, 'input', 'input');
        await act(() => typeInto(input, 'a@b'));
        expect(state.email).toBe('a@b');
        expect(changes).toEqual(['a@b']);
        // The native field is updated in place, never remounted (a remount
        // would clear its text through the model binding).
        expect(byPart(container, 'input', 'input')).toBe(input);
    });

    it('uncontrolled: defaultValue seeds the native value', () => {
        const { container } = render(
            <Input.Root defaultValue="seed"><Input.Control><Input.Input /></Input.Control></Input.Root>,
        );
        expect(byPart(container, 'input', 'input').props['value']).toBe('seed');
    });

    it('focus/blur drive focus-visible on control + input, and emit', async () => {
        const events: string[] = [];
        const { container } = render(
            <Input.Root>
                <Input.Control>
                    <Input.Input onFocus={() => events.push('focus')} onBlur={() => events.push('blur')} />
                </Input.Control>
            </Input.Root>,
        );
        await act(() => handler(byPart(container, 'input', 'input'), 'bindfocus')());
        expect(cls(byPart(container, 'input', 'control'))).toContain('zx-f-focus-visible');
        expect(cls(byPart(container, 'input', 'input'))).toContain('zx-f-focus-visible');
        conforms(container, 'input');
        await act(() => handler(byPart(container, 'input', 'input'), 'bindblur')());
        expect(cls(byPart(container, 'input', 'control'))).not.toContain('zx-f-focus-visible');
        expect(events).toEqual(['focus', 'blur']);
    });

    it('confirm (Enter) emits the text', async () => {
        const confirmed: string[] = [];
        const { container } = render(
            <Input.Root defaultValue="go">
                <Input.Control><Input.Input onConfirm={(v: string) => confirmed.push(v)} /></Input.Control>
            </Input.Root>,
        );
        await act(() => handler(byPart(container, 'input', 'input'), 'bindconfirm')({ detail: { value: 'go!' } }));
        expect(confirmed).toEqual(['go!']);
    });

    it('never puts an unset optional string attribute on the wire (iOS NSNull)', () => {
        const { container } = render(<Input.Root><Input.Control><Input.Input /></Input.Control></Input.Root>);
        const props = byPart(container, 'input', 'input').props;
        for (const key of ['placeholder', 'accessibility-label', 'maxlength', 'confirm-type', 'ios-spell-check']) {
            expect(key in props, key).toBe(false);
        }
    });

    it('maps type/inputmode/enterkeyhint onto the lynx attribute set', () => {
        expect(lynxInputType('password', 'numeric')).toBe('password');
        expect(lynxInputType('text', 'numeric')).toBe('digit');
        expect(lynxInputType('text', 'decimal')).toBe('number');
        expect(lynxInputType('search', undefined)).toBe('text');
        expect(lynxInputType('url', undefined)).toBe('text');
        expect(lynxInputType(undefined, 'email')).toBe('email');
        expect(nativeTextAttrs({ type: 'search', disabled: false, readonly: false })['confirm-type']).toBe('search');
        expect(nativeTextAttrs({ enterkeyhint: 'send', disabled: false, readonly: false })['confirm-type']).toBe('send');
        expect('confirm-type' in nativeTextAttrs({ enterkeyhint: 'enter', disabled: false, readonly: false })).toBe(false);
        expect(nativeTextAttrs({ autocorrect: 'off', spellcheck: false, autofocus: true, maxlength: 4, disabled: false, readonly: false }))
            .toMatchObject({ 'ios-auto-correct': false, 'ios-spell-check': false, focus: true, maxlength: 4 });
    });

    it('a tap on the control or the label focuses the field through its UI method', async () => {
        const { container } = render(BasicInput());
        const invoke = spyInvoke(byPart(container, 'input', 'input'));
        await act(() => fireEvent.tap(byPart(container, 'input', 'control')));
        await act(() => handler(byPart(container, 'input', 'label'), 'bindtap')());
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(invoke).toHaveBeenCalledWith('focus', {});
    });

    it('a disabled field is not focused by a tap', async () => {
        const { container } = render(BasicInput({ disabled: true }));
        const invoke = spyInvoke(byPart(container, 'input', 'input'));
        await act(() => fireEvent.tap(byPart(container, 'input', 'control')));
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('Input — clear-trigger', () => {
    it('renders once there is text, clears the model and refocuses', async () => {
        const state = signal({ q: '' });
        const { container } = render(
            <Input.Root model={() => state.q} type="search">
                <Input.Control><Input.Input /><Input.ClearTrigger /></Input.Control>
            </Input.Root>,
        );
        expect(allParts(container, 'input', 'clear-trigger')).toHaveLength(0);
        await act(() => typeInto(byPart(container, 'input', 'input'), 'abc'));
        const trigger = byPart(container, 'input', 'clear-trigger');
        expect(trigger.props['accessibility-label']).toBe('Clear');
        const invoke = spyInvoke(byPart(container, 'input', 'input'));
        // Held: the pressed flag lands on the trigger.
        await act(() => fireEvent.touchStart(trigger, { touches: [touch(1, 1)] }));
        expect(cls(byPart(container, 'input', 'clear-trigger'))).toContain('zx-f-pressed');
        conforms(container, 'input');
        await act(() => fireEvent.touchEnd(trigger));
        await act(() => handler(trigger, 'catchtap')());
        expect(state.q).toBe('');
        expect(invoke).toHaveBeenCalledWith('focus', {});
        expect(allParts(container, 'input', 'clear-trigger')).toHaveLength(0);
    });

    it('readonly refuses the clear', async () => {
        const state = signal({ q: 'keep' });
        const { container } = render(
            <Input.Root model={() => state.q} readonly>
                <Input.Control><Input.Input /><Input.ClearTrigger /></Input.Control>
            </Input.Root>,
        );
        await act(() => handler(byPart(container, 'input', 'clear-trigger'), 'catchtap')());
        expect(state.q).toBe('keep');
    });
});

describe('Input — visibility-trigger', () => {
    it('toggles a password field between password and text, stating on/off', async () => {
        const changes: boolean[] = [];
        const { container } = render(
            <Input.Root type="password" onVisibleChange={(v: boolean) => changes.push(v)}>
                <Input.Control><Input.Input /><Input.VisibilityTrigger /></Input.Control>
            </Input.Root>,
        );
        const input = byPart(container, 'input', 'input');
        expect(input.props['type']).toBe('password');
        const trigger = byPart(container, 'input', 'visibility-trigger');
        expect(trigger.props['data-state']).toBe('off');
        expect(cls(trigger)).toContain('zx-s-off');
        conforms(container, 'input');
        await act(() => handler(trigger, 'catchtap')());
        expect(byPart(container, 'input', 'visibility-trigger').props['data-state']).toBe('on');
        expect(byPart(container, 'input', 'visibility-trigger').props['accessibility-status']).toBe('selected');
        expect(byPart(container, 'input', 'input').props['type']).toBe('text');
        // Same native node — the type changes in place.
        expect(byPart(container, 'input', 'input')).toBe(input);
        expect(changes).toEqual([true]);
        conforms(container, 'input');
    });

    it('model:visible controls it', async () => {
        const state = signal({ shown: true });
        const { container } = render(
            <Input.Root type="password" model:visible={() => state.shown}>
                <Input.Control><Input.Input /><Input.VisibilityTrigger /></Input.Control>
            </Input.Root>,
        );
        expect(byPart(container, 'input', 'input').props['type']).toBe('text');
        await act(() => handler(byPart(container, 'input', 'visibility-trigger'), 'catchtap')());
        expect(state.shown).toBe(false);
        expect(byPart(container, 'input', 'input').props['type']).toBe('password');
    });

    it('a disabled field refuses the toggle and shows no press', async () => {
        const { container } = render(
            <Input.Root type="password" disabled>
                <Input.Control><Input.Input /><Input.VisibilityTrigger /></Input.Control>
            </Input.Root>,
        );
        const trigger = byPart(container, 'input', 'visibility-trigger');
        await act(() => fireEvent.touchStart(trigger, { touches: [touch(1, 1)] }));
        expect(cls(byPart(container, 'input', 'visibility-trigger'))).not.toContain('zx-f-pressed');
        await act(() => handler(trigger, 'catchtap')());
        expect(byPart(container, 'input', 'visibility-trigger').props['data-state']).toBe('off');
    });
});

describe('Textarea', () => {
    it('renders the textarea part as a view around the native text face, and conforms', () => {
        const { container } = render(
            <Textarea.Root size="sm" color="accent">
                <Textarea.Label>Bio</Textarea.Label>
                <Textarea.Textarea placeholder="About you" />
            </Textarea.Root>,
        );
        const part = byPart(container, 'textarea', 'textarea');
        expect(part.type).toBe('view');
        const face = byType(part, 'textarea');
        // The face wears the part's base + axis classes, never a flag, and
        // is not a second part instance.
        expect(cls(face).split(' ').sort()).toEqual(['zx-a-color-accent', 'zx-a-size-sm', 'zx-textarea__textarea'].sort());
        expect(face.props['data-part']).toBeUndefined();
        expect(face.props['placeholder']).toBe('About you');
        conforms(container, 'textarea');
    });

    it('state classes land on the view, not the native face', async () => {
        const { container } = render(
            <Textarea.Root invalid required readonly disabled>
                <Textarea.Textarea />
            </Textarea.Root>,
        );
        const part = byPart(container, 'textarea', 'textarea');
        for (const flag of ['invalid', 'required', 'readonly', 'disabled']) expect(cls(part)).toContain(`zx-f-${flag}`);
        const face = byType(part, 'textarea');
        expect(cls(face)).not.toContain('zx-f-');
        expect(face.props['readonly']).toBe(true);
        expect(face.props['disabled']).toBe(true);
        conforms(container, 'textarea');
    });

    it('focus drives focus-visible on the part; the model writes through', async () => {
        const state = signal({ bio: '' });
        const { container } = render(
            <Textarea.Root model={() => state.bio}><Textarea.Textarea /></Textarea.Root>,
        );
        const face = byType(byPart(container, 'textarea', 'textarea'), 'textarea');
        await act(() => handler(face, 'bindfocus')());
        expect(cls(byPart(container, 'textarea', 'textarea'))).toContain('zx-f-focus-visible');
        conforms(container, 'textarea');
        await act(() => typeInto(face, 'line one\nline two'));
        expect(state.bio).toBe('line one\nline two');
        await act(() => handler(face, 'bindblur')());
        expect(cls(byPart(container, 'textarea', 'textarea'))).not.toContain('zx-f-focus-visible');
    });

    it('autosize: data-autosize on the part, auto-height + maxlines on the face', () => {
        const { container } = render(
            <Textarea.Root minRows={2} maxRows={6}><Textarea.Textarea /></Textarea.Root>,
        );
        const part = byPart(container, 'textarea', 'textarea');
        expect(part.props['data-autosize']).toBe('');
        const face = byType(part, 'textarea');
        expect(face.props['auto-height']).toBe(true);
        expect(face.props['maxlines']).toBe(6);
        conforms(container, 'textarea');
    });

    it('a tap on the box focuses the native face', async () => {
        const { container } = render(<Textarea.Root><Textarea.Textarea /></Textarea.Root>);
        const part = byPart(container, 'textarea', 'textarea');
        const invoke = spyInvoke(byType(part, 'textarea'));
        await act(() => fireEvent.tap(part));
        expect(invoke).toHaveBeenCalledWith('focus', {});
    });

    it('forced focus-visible conforms', () => {
        const { container } = render(
            <ForceStates flags={{ 'focus-visible': true }}>
                <Textarea.Root><Textarea.Label>Notes</Textarea.Label><Textarea.Textarea /></Textarea.Root>
            </ForceStates>,
        );
        expect(cls(byPart(container, 'textarea', 'textarea'))).toContain('zx-f-focus-visible');
        conforms(container, 'textarea');
    });
});

describe('Field', () => {
    it('renders root/label/description/error and conforms', () => {
        const { container } = render(
            <Field.Root invalid required color="primary" size="lg">
                <Field.Label>Email</Field.Label>
                <Field.Description>We never share it.</Field.Description>
                <Field.Error>Required.</Field.Error>
            </Field.Root>,
        );
        const root = byPart(container, 'field', 'root');
        expect(cls(root)).toContain('zx-f-invalid');
        expect(cls(root)).toContain('zx-f-required');
        const label = byPart(container, 'field', 'label');
        expect(cls(label)).toContain('zx-f-required');
        expect(cls(label)).toContain('zx-a-size-lg');
        expect(cls(byPart(container, 'field', 'error'))).toContain('zx-f-invalid');
        conforms(container, 'field');
    });

    it('controls inside adopt its flags and size', () => {
        const { container } = render(
            <Field.Root disabled invalid required readonly size="xs">
                <Field.Label>Email</Field.Label>
                <Input.Root><Input.Control><Input.Input /></Input.Control></Input.Root>
                <Textarea.Root><Textarea.Textarea /></Textarea.Root>
            </Field.Root>,
        );
        const input = byPart(container, 'input', 'root');
        for (const flag of ['disabled', 'invalid', 'required', 'readonly']) expect(cls(input)).toContain(`zx-f-${flag}`);
        expect(cls(input)).toContain('zx-a-size-xs');
        const ta = byPart(container, 'textarea', 'textarea');
        expect(cls(ta)).toContain('zx-f-readonly');
        expect(cls(ta)).toContain('zx-a-size-xs');
        conforms(container, 'field');
        conforms(container, 'input');
        conforms(container, 'textarea');
    });

    it("a control's own size wins over the Field's", () => {
        const { container } = render(
            <Field.Root size="xs">
                <Input.Root size="xl"><Input.Control><Input.Input /></Input.Control></Input.Root>
            </Field.Root>,
        );
        expect(cls(byPart(container, 'input', 'root'))).toContain('zx-a-size-xl');
    });

    it('a tap on Field.Label focuses the first control', async () => {
        const { container } = render(
            <Field.Root>
                <Field.Label>Email</Field.Label>
                <Input.Root><Input.Control><Input.Input /></Input.Control></Input.Root>
            </Field.Root>,
        );
        const invoke = spyInvoke(byPart(container, 'input', 'input'));
        await act(() => handler(byPart(container, 'field', 'label'), 'bindtap')());
        expect(invoke).toHaveBeenCalledWith('focus', {});
    });

    it('a visually-hidden label stays in the tree, off screen', () => {
        const { container } = render(
            <Field.Root><Field.Label visuallyHidden>Search</Field.Label></Field.Root>,
        );
        const label = byPart(container, 'field', 'label');
        expect(label.props['data-visually-hidden']).toBe('');
        conforms(container, 'field');
    });

    it('existing controls (Switch) adopt the Field too', () => {
        const { container } = render(
            <Field.Root readonly invalid><Switch.Root defaultChecked /></Field.Root>,
        );
        const root = byPart(container, 'switch', 'root');
        expect(cls(root)).toContain('zx-f-readonly');
        expect(cls(root)).toContain('zx-f-invalid');
    });

    it("ORs in an enclosing fieldset's flags (W2D's Fieldset contract)", () => {
        const FakeFieldset = component<Define.Slot<'default'>>(({ slots }) => {
            provideFieldsetContext({ inert: false, disabled: () => true, readonly: () => false, invalid: () => true });
            return () => <view>{slots.default?.()}</view>;
        });
        const { container } = render(
            <FakeFieldset>
                <Field.Root>
                    <Field.Label>Name</Field.Label>
                    <Input.Root><Input.Control><Input.Input /></Input.Control></Input.Root>
                </Field.Root>
            </FakeFieldset>,
        );
        expect(cls(byPart(container, 'field', 'root'))).toContain('zx-f-disabled');
        expect(cls(byPart(container, 'field', 'label'))).toContain('zx-f-invalid');
        expect(cls(byPart(container, 'input', 'root'))).toContain('zx-f-disabled');
        conforms(container, 'field');
    });
});
