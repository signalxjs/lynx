/**
 * Avatar — an image with a graceful fallback (zero's `avatar` scope).
 *
 * ```tsx
 * <Avatar.Root>
 *     <Avatar.Image src={user.photo} alt="Andreas Ekdahl" />
 *     <Avatar.Fallback><text>AE</text></Avatar.Fallback>
 * </Avatar.Root>
 * ```
 *
 * Display-only (no model): every part mirrors the image's load status as
 * `loading|loaded|error`, and `statusChange` reports it. The status comes
 * from the lynx `<image>`'s own load and error events. A missing `src` is
 * `error`, and so is a root with no `Avatar.Image` at all once it has
 * mounted — the fallback is then the avatar, not a placeholder stuck
 * `loading`.
 *
 * The swap is by presence, as zero's anatomy says (`hiddenIn`): lynx has no
 * `hidden` attribute, so the part a state hides is not rendered. The image
 * is dropped while `error` (a broken image would paint nothing, or a
 * platform placeholder) and the fallback once the image has `loaded`. While
 * `loading` both render and the skin stacks the fallback over the image
 * until it reports in.
 *
 * `Avatar.Fallback delay={ms}` keeps the fallback out of the tree for that
 * long, so a fast image never flashes initials first.
 *
 * Accessibility: once loaded, the image is the avatar's accessible element,
 * named by `alt`. Until then the fallback's content is what a reader finds.
 *
 * Inside an `AvatarGroup.Root` the avatar takes the group's `size` and
 * `color` unless it sets its own. That is the lynx spelling of the web
 * recipe's `composes`, which has no class form on this target. Every avatar
 * after the first also carries the `stacked` modifier (`zx-m-stacked`) for
 * the skin's overlap, because lynx has no `:first-child`.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, onMounted, onUnmounted, signal, watch } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.avatar;

export type AvatarStatus = 'loading' | 'loaded' | 'error';

// ── The group seam (AvatarGroup.Root provides it) ──

/**
 * What an enclosing `AvatarGroup.Root` hands its avatars: the axes it pushes
 * down, and the mount order that decides which avatars are `stacked`.
 *
 * @internal — AvatarGroup's half of the seam.
 */
export interface AvatarGroupSeam {
    /** The group's resolved `size` / `color` — an avatar's own prop wins. */
    axes(): { size?: string; color?: string };
    /** Join the group's avatar order (mount order); returns the leave function. */
    register(id: number): () => void;
    /** Whether avatar `id` sits after the first one (it overlaps its neighbour). */
    stacked(id: number): boolean;
}

const useAvatarGroupSeam = defineInjectable<AvatarGroupSeam | null>(() => null);

/** @internal — provided by `AvatarGroup.Root`. */
export function provideAvatarGroupSeam(seam: AvatarGroupSeam): void {
    defineProvide(useAvatarGroupSeam, () => seam);
}

/**
 * Whether `id` is stacked in `order`: present and not first. An avatar that
 * mounts later (a conditional one) joins the END of the order, wherever it
 * sits in the row.
 */
export function avatarStacked(order: readonly number[], id: number): boolean {
    const at = order.indexOf(id);
    return at > 0;
}

/** Avatar ids, unique across every group (only compared, never shown). */
let nextAvatarId = 0;

// ── Context ──

interface AvatarContext {
    status(): AvatarStatus;
    setStatus(status: AvatarStatus): void;
    /** An Image reports its presence; returns the leave function. */
    addImage(): () => void;
}

const useAvatarContext = defineInjectable<AvatarContext>(() => ({
    status: () => 'error',
    setStatus: () => {},
    addImage: () => () => {},
}));

/**
 * One turn later — a status write must land after the render pass that
 * mounted the part, or the root never sees it. A promise, not
 * `queueMicrotask`: the background thread lacks it on some engines.
 */
const later = (fn: () => void): void => {
    void Promise.resolve().then(fn);
};

// ── Root ──

export type AvatarRootProps =
    & Define.Event<'statusChange', AvatarStatus>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    /** The skin's shape axis (daisy: `circle` / `square` / `rounded`). */
    & Define.Prop<'shape', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const AvatarRoot = component<AvatarRootProps>(({ props, slots, emit }) => {
    const group = useAvatarGroupSeam();
    const state = signal({ status: 'loading' as AvatarStatus });
    // A plain counter: nothing renders from it, only the settle reads it.
    let images = 0;
    let mounted = false;
    let alive = true;
    const setStatus = (status: AvatarStatus): void => {
        if (state.status === status) return;
        state.status = status;
        emit('statusChange', status);
    };
    // No Image once the mount settles (or the last one gone since): there is
    // nothing left to load, so the fallback is the avatar.
    const settle = (): void => {
        if (alive && mounted && images === 0) setStatus('error');
    };
    onMounted(() => later(() => {
        mounted = true;
        settle();
    }));
    onUnmounted(() => {
        alive = false;
    });

    const axes = provideVariantAxes((): VariantAxes => {
        const pushed = group?.axes() ?? {};
        return resolveVariantAxes(anatomy.scope, {
            color: props.color ?? pushed.color,
            size: props.size ?? pushed.size,
            ...(props.shape ? { axes: { shape: props.shape } } : {}),
        });
    });
    const ctx: AvatarContext = {
        status: () => state.status,
        setStatus,
        addImage: () => {
            images++;
            return () => {
                images = Math.max(0, images - 1);
                later(settle);
            };
        },
    };
    defineProvide(useAvatarContext, () => ctx);

    const id = ++nextAvatarId;
    if (group) onUnmounted(group.register(id));

    return () => {
        const a = axes();
        const stacked = group ? group.stacked(id) : false;
        return (
            <view
                {...partBag(anatomy, 'root', {
                    state: state.status,
                    ...partAxes(stacked ? { ...a, mods: { ...a.mods, stacked: true } } : a),
                    class: props.class,
                })}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Avatar.Root' });

// ── Image ──

export type AvatarImageProps =
    & Define.Prop<'src', string, false>
    /**
     * Required: once loaded, the image is the avatar's only accessible
     * representation (the fallback is gone). Pass `alt=""` only for an
     * avatar that is decorative next to a visible name.
     */
    & Define.Prop<'alt', string, true>
    & Define.Prop<'class', string, false>;

const AvatarImage = component<AvatarImageProps>(({ props, onMounted: mountedHook, onUnmounted: unmountedHook }) => {
    const avatar = useAvatarContext();
    const axes = useVariantAxes();
    unmountedHook(avatar.addImage());
    /** The element's own load/error event has settled the current src. */
    let answered = false;
    let alive = true;
    unmountedHook(() => {
        alive = false;
    });
    // A new src has something to load again — or, empty, never will. The
    // prop changes inside the root's own re-render, so the status write
    // waits a turn like every other one here.
    watch(
        () => props.src,
        (src, prev) => {
            if (src === prev) return;
            answered = false;
            later(() => {
                if (alive && !answered && props.src === src) avatar.setStatus(src ? 'loading' : 'error');
            });
        },
    );
    // A missing src can never load. Settled after the mount pass (the root's
    // render is still running during it); an image that mounts into a root
    // that already settled on `error` (none was there) starts loading again,
    // unless its own event has answered first.
    mountedHook(() => later(() => {
        if (!alive || answered) return;
        avatar.setStatus(props.src ? 'loading' : 'error');
    }));

    return () => {
        const status = avatar.status();
        // hiddenIn: ['error'] — a broken image is not rendered at all.
        if (status === 'error') return null;
        const loaded = status === 'loaded';
        return (
            <image
                {...partBag(anatomy, 'image', { state: status, ...partAxes(axes()), class: props.class })}
                // Until the image is what the avatar shows, the fallback is
                // the one accessible representation.
                {...(loaded && props.alt ? partA11y({ trait: 'image', label: props.alt }) : {})}
                src={props.src ?? ''}
                mode="aspectFill"
                // `onLoad` / `onError` are the runtime's aliases of lynx's
                // `bindload` / `binderror` (the spelling this JSX types).
                onLoad={() => {
                    answered = true;
                    avatar.setStatus('loaded');
                }}
                onError={() => {
                    answered = true;
                    avatar.setStatus('error');
                }}
            />
        );
    };
}, { name: 'Avatar.Image' });

// ── Fallback ──

export type AvatarFallbackProps =
    /**
     * Milliseconds the fallback stays out of the tree, so a fast image
     * never flashes initials first.
     */
    & Define.Prop<'delay', number, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const AvatarFallback = component<AvatarFallbackProps>(({ props, slots, onMounted: mountedHook, onUnmounted: unmountedHook }) => {
    const avatar = useAvatarContext();
    const axes = useVariantAxes();
    const wait = signal({ over: !(props.delay !== undefined && props.delay > 0) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    mountedHook(() => {
        if (wait.over) return;
        timer = setTimeout(() => {
            wait.over = true;
        }, props.delay);
    });
    unmountedHook(() => {
        if (timer !== undefined) clearTimeout(timer);
    });
    return () => {
        const status = avatar.status();
        // hiddenIn: ['loaded'] — the image is the avatar now.
        if (!wait.over || status === 'loaded') return null;
        return (
            <view {...partBag(anatomy, 'fallback', { state: status, ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Avatar.Fallback' });

export const Avatar = compound(AvatarRoot, {
    Root: AvatarRoot,
    Image: AvatarImage,
    Fallback: AvatarFallback,
});
