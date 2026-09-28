/**
 * Chat — one message row (zero's `chat` scope): an avatar slot, a name
 * line, the bubble, a status line.
 *
 * ```tsx
 * <Chat.Root>
 *     <Chat.Avatar>
 *         <Avatar.Root size="sm"><Avatar.Fallback><text>AL</text></Avatar.Fallback></Avatar.Root>
 *     </Chat.Avatar>
 *     <Chat.Header>Ada · 12:45</Chat.Header>
 *     <Chat.Bubble>The contract is the anatomy.</Chat.Bubble>
 *     <Chat.Footer>Delivered</Chat.Footer>
 * </Chat.Root>
 * <Chat.Root placement="end" color="primary">
 *     <Chat.Bubble>Agreed.</Chat.Bubble>
 * </Chat.Root>
 * ```
 *
 * Pure content, like zero's web Chat: no state, no flags, no accessibility
 * props of its own. The lynx spellings:
 *
 * - **Placement is the root's.** `placement="start"` (the other party,
 *   default) or `"end"` (your own rows) stamps `zx-p-start` / `zx-p-end` on
 *   the root only — the anatomy declares placements on the root, and the
 *   oracle holds every other part to that. The web skin places the parts
 *   with `[data-placement] > &` selectors, which the class grammar cannot
 *   carry; the lynx skin restates them as descendant rules
 *   (`.zx-chat__root.zx-p-end .zx-chat__bubble`), the same shape as the
 *   theme restatements lynx is proven to match. Physical sides: lynx has no
 *   RTL flow, so `start` is the left edge.
 * - **The avatar hangs beside the column.** The web lays the row out on a
 *   two-column grid; lynx has no grid. Header, bubble and footer stack in
 *   the root's column, and the avatar is taken out of flow and pinned to
 *   the row's bottom corner on the placement's side. The root measures the
 *   avatar (`bindlayoutchange`) and reserves its width plus the skin's gap
 *   (`avatarGap`, default 8) on that side, and its height as the row's
 *   minimum, so any avatar — zero's `Avatar` at any size, an `<image>`,
 *   initials — sits clear of the bubble. Those few inline values are the
 *   runtime's measurement, not paint.
 * - **Header, Bubble and Footer are `view`s.** Pass a string and it is
 *   wrapped in a `<text>`; pass nodes and they render as-is. The skin's
 *   type and ink reach the text through CSS inheritance
 *   (`enableCSSInheritance`, as the showcase sets it).
 * - **Axis push-down.** The row carries `color` and `size`; every part
 *   stamps them, and the skin paints the bubble from them.
 * - **Not carried:** `asChild` (a row has no DOM element to merge into on
 *   lynx — wrap it in the list item instead).
 */
import type { Define, JSXElement, LayoutChangeEvent } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.chat;

/** Which side a row sits on — `start` is the other party, `end` your own. */
export type ChatPlacement = 'start' | 'end';

/** The measured avatar box, `null` while no avatar is mounted (or not yet laid out). */
interface AvatarBox {
    width: number;
    height: number;
}

interface ChatContext {
    placement(): ChatPlacement;
    /** Report the mounted avatar's laid-out box; `null` when it leaves. */
    setAvatar(box: AvatarBox | null): void;
}

const useChatContext = defineInjectable<ChatContext>(() => ({
    placement: () => 'start',
    setAvatar: () => {},
}));

/** A layout event's size — the modern `detail`, else Android's legacy `params`. */
function sizeOf(event: LayoutChangeEvent): AvatarBox | null {
    const box = event.detail ?? event.params;
    if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
    return { width: box.width, height: box.height };
}

/** A string child becomes a `<text>`; anything else renders as given. */
function textual(content: unknown): unknown {
    return typeof content === 'string' || typeof content === 'number' ? <text>{String(content)}</text> : content;
}

// ── Root ──

export type ChatRootProps =
    & Define.Prop<'placement', ChatPlacement, false>
    /** The room kept between the avatar and the column, in px. Default 8 (daisy's `--space-sm`). */
    & Define.Prop<'avatarGap', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const ChatRoot = component<ChatRootProps>(({ props, slots }) => {
    const avatar = signal<{ box: AvatarBox | null }>({ box: null });
    const placement = (): ChatPlacement => (props.placement === 'end' ? 'end' : 'start');
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    defineProvide(useChatContext, () => ({
        placement,
        setAvatar: (box) => {
            const prev = avatar.box;
            if (prev === box || (prev && box && prev.width === box.width && prev.height === box.height)) return;
            avatar.box = box;
        },
    }));

    return () => {
        const box = avatar.box;
        const side = placement() === 'end' ? 'paddingRight' : 'paddingLeft';
        const room = box
            ? { [side]: `${box.width + (props.avatarGap ?? 8)}px`, minHeight: `${box.height}px` }
            : undefined;
        return (
            <view
                {...partBag(anatomy, 'root', { ...partAxes(axes()), placement: placement(), class: props.class })}
                style={room}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Chat.Root' });

// ── Avatar ──

export type ChatAvatarProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const ChatAvatar = component<ChatAvatarProps>(({ props, slots, onUnmounted }) => {
    const chat = useChatContext();
    const axes = useVariantAxes();
    onUnmounted(() => chat.setAvatar(null));
    return () => (
        <view
            {...partBag(anatomy, 'avatar', { ...partAxes(axes()), class: props.class })}
            // Out of flow, pinned to the row's bottom corner on the placement's
            // side; the root reserves the room from the measured box.
            style={{ position: 'absolute', bottom: '0px', [chat.placement() === 'end' ? 'right' : 'left']: '0px' }}
            bindlayoutchange={(event: LayoutChangeEvent) => chat.setAvatar(sizeOf(event))}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Chat.Avatar' });

// ── Header / Bubble / Footer ──

export type ChatPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

function chatPart(part: 'header' | 'bubble' | 'footer', name: string) {
    return component<ChatPartProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        return () => {
            const out = slots.default?.() as unknown;
            const children = Array.isArray(out) ? out.map(textual) : textual(out);
            return (
                <view {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}>
                    {children as JSXElement}
                </view>
            );
        };
    }, { name });
}

const ChatHeader = chatPart('header', 'Chat.Header');
const ChatBubble = chatPart('bubble', 'Chat.Bubble');
const ChatFooter = chatPart('footer', 'Chat.Footer');

export const Chat = compound(ChatRoot, {
    Root: ChatRoot,
    Avatar: ChatAvatar,
    Header: ChatHeader,
    Bubble: ChatBubble,
    Footer: ChatFooter,
});
