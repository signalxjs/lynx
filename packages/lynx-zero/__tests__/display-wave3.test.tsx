/**
 * Wave 3, display (W3C #1237, epic #1140): Avatar, AvatarGroup, Skeleton,
 * Spinner, and Toast.Indicator with promise toasts (#1196). Every state the
 * tests drive is held to BOTH oracles (anatomy + class grammar).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { anatomies } from '@sigx/zero/anatomy';
import { component, signal } from '@sigx/lynx';
import {
    Avatar, AvatarGroup, OverlayHost, Skeleton, Spinner, Toast, createToaster, partBag, registerAxisDefaults,
} from '../src/index';
import { clearAxisDefaults } from '../src/contract/axis-defaults';
import type { AvatarStatus, ToastItem } from '../src/index';
import { avatarStacked } from '../src/components/avatar/Avatar';
import { ForceStates, expectAnatomy, expectClassGrammar } from '../src/testing/index';

const conforms = (container: unknown, scope: keyof typeof anatomies, axes?: string[]): void => {
    expectAnatomy(container as never, anatomies[scope], axes ? { axes } : {});
    expectClassGrammar(container as never, anatomies[scope], axes ? { axes } : {});
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
const byPart = (root: TestNode, scope: string, part: string): TestNode | null => allParts(root, scope, part)[0] ?? null;

/** Let the one-turn deferrals (`Promise.resolve().then`) and their renders run. */
const flush = async (): Promise<void> => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

const fire = async (node: TestNode, handler: string): Promise<void> => {
    await act(() => {
        const fn = node._handlers.get(handler);
        if (!fn) throw new Error(`no ${handler} handler`);
        fn({ type: handler, detail: {} });
    });
};

afterEach(() => clearAxisDefaults());

describe('Avatar', () => {
    it('loading → loaded: the image reports in, the fallback leaves (hiddenIn)', async () => {
        const statuses: AvatarStatus[] = [];
        const { container } = render(
            <Avatar.Root onStatusChange={(s: AvatarStatus) => statuses.push(s)}>
                <Avatar.Image src="https://example.com/me.png" alt="Andreas Ekdahl" />
                <Avatar.Fallback><text>AE</text></Avatar.Fallback>
            </Avatar.Root>,
        );
        await flush();
        const root = byPart(container, 'avatar', 'root')!;
        expect(root.props['data-state']).toBe('loading');
        expect(root._class).toContain('zx-s-loading');
        // While loading both render: the skin stacks the fallback over the image.
        const image = byPart(container, 'avatar', 'image')!;
        expect(image.type).toBe('image');
        expect(image.props['src']).toBe('https://example.com/me.png');
        expect(image.props['mode']).toBe('aspectFill');
        expect(image.props['accessibility-label']).toBeUndefined();
        expect(byPart(container, 'avatar', 'fallback')).not.toBeNull();
        conforms(container, 'avatar');

        await fire(image, 'onLoad');
        expect(byPart(container, 'avatar', 'root')!.props['data-state']).toBe('loaded');
        expect(byPart(container, 'avatar', 'fallback')).toBeNull();
        const loaded = byPart(container, 'avatar', 'image')!;
        expect(loaded._class).toContain('zx-s-loaded');
        // Loaded, the image is the accessible element, named by alt.
        expect(loaded.props['accessibility-label']).toBe('Andreas Ekdahl');
        expect(loaded.props['accessibility-trait']).toBe('image');
        expect(statuses).toEqual(['loaded']);
        conforms(container, 'avatar');
    });

    it('a broken image settles on error: the image is dropped, the fallback stays', async () => {
        const { container } = render(
            <Avatar.Root>
                <Avatar.Image src="https://example.com/broken.png" alt="Nobody" />
                <Avatar.Fallback><text>NB</text></Avatar.Fallback>
            </Avatar.Root>,
        );
        await flush();
        await fire(byPart(container, 'avatar', 'image')!, 'onError');
        expect(byPart(container, 'avatar', 'root')!.props['data-state']).toBe('error');
        expect(byPart(container, 'avatar', 'image')).toBeNull();
        const fallback = byPart(container, 'avatar', 'fallback')!;
        expect(fallback._class).toContain('zx-s-error');
        expect(container.textContent()).toContain('NB');
        conforms(container, 'avatar');
    });

    it('no Image, or an empty src, is error once mounted — the fallback is the avatar', async () => {
        const { container } = render(
            <view>
                <Avatar.Root><Avatar.Fallback><text>A</text></Avatar.Fallback></Avatar.Root>
                <Avatar.Root><Avatar.Image alt="B" /><Avatar.Fallback><text>B</text></Avatar.Fallback></Avatar.Root>
            </view>,
        );
        await flush();
        const roots = allParts(container, 'avatar', 'root');
        expect(roots.map((r) => r.props['data-state'])).toEqual(['error', 'error']);
        expect(byPart(container, 'avatar', 'image')).toBeNull();
        conforms(container, 'avatar');
    });

    it('a new src loads again', async () => {
        const src = signal({ value: 'https://example.com/a.png' });
        const Host = component(() => () => (
            <Avatar.Root>
                <Avatar.Image src={src.value} alt="A" />
                <Avatar.Fallback><text>A</text></Avatar.Fallback>
            </Avatar.Root>
        ));
        const { container } = render(<Host />);
        await flush();
        await fire(byPart(container, 'avatar', 'image')!, 'onError');
        expect(byPart(container, 'avatar', 'root')!.props['data-state']).toBe('error');
        await act(() => { src.value = 'https://example.com/b.png'; });
        await flush();
        expect(byPart(container, 'avatar', 'root')!.props['data-state']).toBe('loading');
        expect(byPart(container, 'avatar', 'image')!.props['src']).toBe('https://example.com/b.png');
    });

    it('Fallback delay keeps it out of the tree for that long', async () => {
        const { container } = render(
            <Avatar.Root>
                <Avatar.Image src="https://example.com/me.png" alt="Me" />
                <Avatar.Fallback delay={30}><text>ME</text></Avatar.Fallback>
            </Avatar.Root>,
        );
        await flush();
        expect(byPart(container, 'avatar', 'fallback')).toBeNull();
        await act(() => new Promise((r) => setTimeout(r, 50)));
        expect(byPart(container, 'avatar', 'fallback')).not.toBeNull();
    });

    it('stamps color / size / shape on every part', async () => {
        const { container } = render(
            <Avatar.Root color="accent" size="lg" shape="rounded">
                <Avatar.Image src="x.png" alt="X" />
                <Avatar.Fallback><text>X</text></Avatar.Fallback>
            </Avatar.Root>,
        );
        await flush();
        for (const part of ['root', 'image', 'fallback']) {
            const node = byPart(container, 'avatar', part)!;
            expect(node._class, part).toContain('zx-a-color-accent');
            expect(node._class, part).toContain('zx-a-size-lg');
            expect(node._class, part).toContain('zx-a-shape-rounded');
        }
        conforms(container, 'avatar', ['shape']);
    });
});

describe('AvatarGroup', () => {
    it('pushes its size and color down; an avatar\'s own prop wins', async () => {
        const { container } = render(
            <AvatarGroup.Root label="Members" size="sm" color="secondary">
                <Avatar.Root><Avatar.Fallback><text>A</text></Avatar.Fallback></Avatar.Root>
                <Avatar.Root size="xl"><Avatar.Fallback><text>B</text></Avatar.Fallback></Avatar.Root>
                <AvatarGroup.Overflow count={3} />
            </AvatarGroup.Root>,
        );
        await flush();
        const avatars = allParts(container, 'avatar', 'root');
        expect(avatars[0]!._class).toContain('zx-a-size-sm');
        expect(avatars[0]!._class).toContain('zx-a-color-secondary');
        expect(avatars[1]!._class).toContain('zx-a-size-xl');
        expect(avatars[1]!._class).toContain('zx-a-color-secondary');
        const overflow = byPart(container, 'avatar-group', 'overflow')!;
        expect(overflow._class).toContain('zx-a-size-sm');
        conforms(container, 'avatar-group');
        conforms(container, 'avatar');
    });

    it('stamps every avatar after the first `stacked` (mount order)', async () => {
        const { container } = render(
            <AvatarGroup.Root>
                <Avatar.Root><Avatar.Fallback><text>A</text></Avatar.Fallback></Avatar.Root>
                <Avatar.Root><Avatar.Fallback><text>B</text></Avatar.Fallback></Avatar.Root>
                <Avatar.Root><Avatar.Fallback><text>C</text></Avatar.Fallback></Avatar.Root>
            </AvatarGroup.Root>,
        );
        await flush();
        const avatars = allParts(container, 'avatar', 'root');
        expect(avatars.map((a) => a._class.includes('zx-m-stacked'))).toEqual([false, true, true]);
        expect(avatars[1]!.props['data-mod-stacked']).toBe('');
        conforms(container, 'avatar');
        // Outside a group nothing is stacked.
        const lone = render(<Avatar.Root><Avatar.Fallback><text>L</text></Avatar.Fallback></Avatar.Root>);
        expect(byPart(lone.container, 'avatar', 'root')!._class).not.toContain('zx-m-stacked');
    });

    it('avatarStacked: present and not first', () => {
        expect(avatarStacked([4, 5, 6], 4)).toBe(false);
        expect(avatarStacked([4, 5, 6], 6)).toBe(true);
        expect(avatarStacked([4, 5, 6], 9)).toBe(false);
        expect(avatarStacked([], 1)).toBe(false);
    });

    it('Overflow shows +N, is announced as "N more", and renders nothing at zero', async () => {
        const count = signal({ value: 3 });
        const Host = component(() => () => (
            <AvatarGroup.Root label="Members">
                <AvatarGroup.Overflow count={count.value} />
            </AvatarGroup.Root>
        ));
        const { container } = render(<Host />);
        const root = byPart(container, 'avatar-group', 'root')!;
        expect(root.props['accessibility-element']).toBe(true);
        expect(root.props['accessibility-label']).toBe('Members');
        const overflow = byPart(container, 'avatar-group', 'overflow')!;
        expect(overflow.textContent()).toBe('+3');
        expect(overflow.props['accessibility-label']).toBe('3 more');
        conforms(container, 'avatar-group');
        await act(() => { count.value = 0; });
        expect(byPart(container, 'avatar-group', 'overflow')).toBeNull();
        const labelled = render(<AvatarGroup.Root><AvatarGroup.Overflow count={2.7} label="two others" /></AvatarGroup.Root>);
        const chip = byPart(labelled.container, 'avatar-group', 'overflow')!;
        expect(chip.textContent()).toBe('+2');
        expect(chip.props['accessibility-label']).toBe('two others');
        // No label: the root is not an accessible element (its avatars are read on their own).
        expect(byPart(labelled.container, 'avatar-group', 'root')!.props['accessibility-element']).toBeUndefined();
    });
});

describe('Skeleton', () => {
    it('loading by default; children stay in the tree in both states', async () => {
        const loading = signal({ value: true });
        const changes: boolean[] = [];
        const { container } = render(
            <Skeleton.Root model={() => loading.value} onLoadingChange={(v: boolean) => changes.push(v)}>
                <text>Article title</text>
            </Skeleton.Root>,
        );
        let root = byPart(container, 'skeleton', 'root')!;
        expect(root.props['data-state']).toBe('loading');
        expect(root._class).toContain('zx-s-loading');
        expect(root.props['accessibility-label']).toBe('Loading');
        expect(root.props['accessibility-status']).toBe('busy');
        expect(container.textContent()).toContain('Article title');
        conforms(container, 'skeleton');

        await act(() => { loading.value = false; });
        root = byPart(container, 'skeleton', 'root')!;
        expect(root.props['data-state']).toBe('loaded');
        expect(root.props['accessibility-element']).toBeUndefined();
        expect(container.textContent()).toContain('Article title');
        conforms(container, 'skeleton');
        expect(changes).toEqual([]);
    });

    it('defaultLoading=false starts loaded; color and size stamp', () => {
        const { container } = render(
            <Skeleton.Root defaultLoading={false} color="primary" size="sm" label="Fetching"><view /></Skeleton.Root>,
        );
        const root = byPart(container, 'skeleton', 'root')!;
        expect(root.props['data-state']).toBe('loaded');
        expect(root._class).toContain('zx-a-color-primary');
        expect(root._class).toContain('zx-a-size-sm');
        conforms(container, 'skeleton');
    });
});

describe('Spinner', () => {
    it('announces its label (default "Loading") through a visually hidden label part', () => {
        const { container } = render(<Spinner color="accent" size="lg" />);
        const root = byPart(container, 'spinner', 'root')!;
        expect(root.props['accessibility-label']).toBe('Loading');
        expect(root.props['accessibility-status']).toBe('busy');
        expect(root._class).toContain('zx-a-color-accent');
        const label = byPart(container, 'spinner', 'label')!;
        expect(label.type).toBe('text');
        expect(label.textContent()).toBe('Loading');
        expect(label._style['opacity']).toBe('0');
        expect(label._style['position']).toBe('absolute');
        conforms(container, 'spinner');
    });

    it('label overrides the words; decorative drops them', () => {
        const named = render(<Spinner.Root label="Uploading" />);
        expect(byPart(named.container, 'spinner', 'label')!.textContent()).toBe('Uploading');
        expect(byPart(named.container, 'spinner', 'root')!.props['accessibility-label']).toBe('Uploading');
        const deco = render(<Spinner decorative size="xs" />);
        const root = byPart(deco.container, 'spinner', 'root')!;
        expect(byPart(deco.container, 'spinner', 'label')).toBeNull();
        expect(root.props['accessibility-element']).toBe(false);
        expect(root.props['accessibility-label']).toBeUndefined();
        conforms(deco.container, 'spinner');
    });

    it('stamps the registered skin defaults when unset', () => {
        registerAxisDefaults({ spinner: { color: 'primary', size: 'md' } });
        const { container } = render(<Spinner />);
        const root = byPart(container, 'spinner', 'root')!;
        expect(root._class).toContain('zx-a-color-primary');
        expect(root._class).toContain('zx-a-size-md');
    });
});

describe('Toast.Indicator (#1196)', () => {
    const item = (status?: ToastItem['status']): ToastItem => ({ id: 0, title: 'Saving', open: true, status });

    it('renders nothing for a plain toast, and marks nothing', async () => {
        const { container } = render(
            <view {...partBag(anatomies.toast, 'viewport', {})}>
                <Toast.Root toast={item()}>
                    <Toast.Indicator />
                    <Toast.Title>Saved</Toast.Title>
                </Toast.Root>
            </view>,
        );
        await flush();
        expect(byPart(container, 'toast', 'indicator')).toBeNull();
        expect(byPart(container, 'toast', 'root')!._class).not.toContain('zx-m-marked');
        conforms(container, 'toast');
    });

    it.each(['loading', 'complete', 'error'] as const)('%s: the mark renders, decorative, and every part is marked', async (status) => {
        const { container } = render(
            <view {...partBag(anatomies.toast, 'viewport', {})}>
                <Toast.Root toast={item(status)} color="success">
                    <Toast.Indicator />
                    <Toast.Title>Saving</Toast.Title>
                    <Toast.Description>Three files.</Toast.Description>
                    <Toast.Action><text>Undo</text></Toast.Action>
                    <Toast.Close />
                </Toast.Root>
            </view>,
        );
        await flush();
        const indicator = byPart(container, 'toast', 'indicator')!;
        expect(indicator.props['data-state']).toBe(status);
        expect(indicator._class).toContain(`zx-s-${status}`);
        expect(indicator._class).toContain('zx-a-color-success');
        expect(indicator.props['accessibility-element']).toBe(false);
        for (const part of ['root', 'indicator', 'title', 'description', 'action', 'close']) {
            expect(byPart(container, 'toast', part)!._class, part).toContain('zx-m-marked');
        }
        conforms(container, 'toast');
    });

    it('a status without an Indicator marks nothing (the text is not indented for a missing mark)', async () => {
        const { container } = render(
            <view {...partBag(anatomies.toast, 'viewport', {})}>
                <Toast.Root toast={item('loading')}><Toast.Title>Saving</Toast.Title></Toast.Root>
            </view>,
        );
        await flush();
        expect(byPart(container, 'toast', 'root')!._class).not.toContain('zx-m-marked');
    });

    it('forced flags still reach the action and close of a marked toast', async () => {
        const { container } = render(
            <view {...partBag(anatomies.toast, 'viewport', {})}>
                <ForceStates flags={{ pressed: true }} parts={['close']}>
                    <Toast.Root toast={item('complete')}>
                        <Toast.Indicator />
                        <Toast.Title>Done</Toast.Title>
                        <Toast.Close />
                    </Toast.Root>
                </ForceStates>
            </view>,
        );
        await flush();
        const close = byPart(container, 'toast', 'close')!;
        expect(close._class).toContain('zx-f-pressed');
        expect(close._class).toContain('zx-m-marked');
        conforms(container, 'toast');
    });

    it('the stock viewport composition carries the indicator', async () => {
        const toaster = createToaster({ exitDuration: 0 });
        const { container } = render(
            <OverlayHost>
                <Toast.Viewport toaster={toaster} />
            </OverlayHost>,
        );
        await act(() => { toaster.show({ title: 'Uploading', status: 'loading', duration: 0 }); });
        await act(() => new Promise((r) => setTimeout(r, 40)));
        const indicator = byPart(container, 'toast', 'indicator')!;
        expect(indicator.props['data-state']).toBe('loading');
        expect(byPart(container, 'toast', 'title')!._class).toContain('zx-m-marked');
        await act(() => { toaster.update(toaster.toasts()[0]!.id, { status: 'complete', title: 'Uploaded' }); });
        expect(byPart(container, 'toast', 'indicator')!.props['data-state']).toBe('complete');
        expect(container.textContent()).toContain('Uploaded');
        conforms(container, 'toast');
    });
});

describe('toaster.update / toaster.promise', () => {
    it('update patches in place; a new duration re-arms the timer', () => {
        vi.useFakeTimers();
        try {
            const toaster = createToaster({ exitDuration: 0 });
            const id = toaster.show({ title: 'Working', duration: 0 });
            vi.advanceTimersByTime(16);
            toaster.update(id, { title: 'Done', status: 'complete', duration: 1000 });
            expect(toaster.toasts()[0]).toMatchObject({ title: 'Done', status: 'complete', open: true });
            // An absent key keeps its value.
            toaster.update(id, { description: 'All files' });
            expect(toaster.toasts()[0]).toMatchObject({ title: 'Done', description: 'All files' });
            vi.advanceTimersByTime(999);
            expect(toaster.toasts().length).toBe(1);
            vi.advanceTimersByTime(1);
            expect(toaster.toasts()).toEqual([]);
            // Updating a gone toast is a no-op.
            toaster.update(id, { title: 'Ghost' });
            expect(toaster.toasts()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('promise: loading (sticky) → complete with the success stage', async () => {
        const toaster = createToaster({ exitDuration: 0 });
        let resolve!: (v: number) => void;
        const id = toaster.promise(new Promise<number>((r) => { resolve = r; }), {
            loading: 'Uploading',
            success: (n) => ({ title: `Uploaded ${n} files`, duration: 0 }),
            error: 'Upload failed',
        });
        expect(toaster.toasts()[0]).toMatchObject({ id, title: 'Uploading', status: 'loading', duration: 0 });
        resolve(3);
        await Promise.resolve();
        await Promise.resolve();
        expect(toaster.toasts()[0]).toMatchObject({ id, title: 'Uploaded 3 files', status: 'complete' });
    });

    it('promise: a rejection settles the error stage and is handled', async () => {
        const toaster = createToaster({ exitDuration: 0 });
        toaster.promise(Promise.reject(new Error('offline')), {
            loading: 'Saving',
            success: 'Saved',
            error: (e) => ({ title: `Failed: ${(e as Error).message}`, duration: 0 }),
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(toaster.toasts()[0]).toMatchObject({ title: 'Failed: offline', status: 'error' });
    });

    it('promise: a throwing success mapper settles the error stage; a throwing error mapper keeps the copy', async () => {
        const toaster = createToaster({ exitDuration: 0 });
        toaster.promise(Promise.resolve(1), {
            loading: 'Saving',
            success: () => { throw new Error('bad map'); },
            error: (e) => ({ title: String((e as Error).message), duration: 0 }),
        });
        toaster.promise(Promise.reject(new Error('x')), {
            loading: { title: 'Syncing', duration: 0 },
            success: 'ok',
            error: () => { throw new Error('worse'); },
        });
        await new Promise((r) => setTimeout(r, 0));
        const [first, second] = toaster.toasts();
        expect(first).toMatchObject({ title: 'bad map', status: 'error' });
        expect(second).toMatchObject({ title: 'Syncing', status: 'error' });
        for (const t of toaster.toasts()) toaster.remove(t.id);
    });
});
