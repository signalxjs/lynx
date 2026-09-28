/**
 * ChatLog — the transcript container around `Chat` rows (zero's `chat-log`
 * scope): a scroll box that follows its tail, and a trigger back to it.
 *
 * ```tsx
 * <ChatLog.Root label="Conversation with Ada" class="thread">
 *     <ChatLog.Content>
 *         {state.messages.map((m) => (
 *             <Chat.Root key={m.id} placement={m.mine ? 'end' : 'start'}>
 *                 <Chat.Bubble>{m.text}</Chat.Bubble>
 *             </Chat.Root>
 *         ))}
 *     </ChatLog.Content>
 *     <ChatLog.JumpTrigger />
 * </ChatLog.Root>
 * ```
 *
 * The root needs a definite height — give it one through its `class` (or
 * a flex parent that stretches it); no zero part takes `style`.
 *
 * The lynx spellings:
 *
 * - **The root is the frame, Content holds the scroller.** A lynx
 *   `scroll-view` scrolls every child it has, and the jump trigger must
 *   float over the rows, not scroll with them. So `ChatLog.Root` renders the
 *   frame (the skin's border, fill and radius), `ChatLog.Content` renders a
 *   native vertical `scroll-view` filling it with the `content` part inside,
 *   and the jump trigger docks over the frame's foot. The anatomy's part
 *   tree is unchanged: content and jump-trigger are both the root's.
 * - **Following the tail.** While `following` is true, every change of the
 *   content's height (a row appended, a last row growing) scrolls to the
 *   end — the measured content height minus the scroller's height — through
 *   the scroll-view's `scrollTo` UI method, re-checked a bounded number of
 *   times in case the first call lands before native has laid the new row
 *   out. The reader scrolling UP more than `threshold` px from the end
 *   lets go (`following` false) and the jump trigger appears; scrolling back
 *   within `threshold` follows again. Writing the model true jumps to the
 *   end.
 * - **The jump trigger** is `open` while not following and UNMOUNTS while
 *   `closed` — the lynx spelling of `hiddenIn: ['closed']` (lynx has no
 *   `hidden` attribute). It is a `view` with the `button` trait, tier-2
 *   press feedback and the name "Jump to latest" (`label` overrides; with
 *   no children it draws the label). Its dock spans the frame's foot with
 *   `pointer-events: none` so it never eats a tap meant for the rows; the
 *   trigger itself takes its own (`pointer-events: auto`).
 * - **No live region, no keyboard.** Lynx has no `role="log"` / `aria-live`
 *   and no keyboard focus: `label` names the scroller for the reader, and
 *   `focus-visible` (on the root and the trigger) is reachable through
 *   `ForceStates` only. Rows prepended above ("load earlier") are not
 *   anchored — the web behavior reads the rows' DOM rectangles.
 */
import type { Define, JSXElement, LayoutChangeEvent } from '@sigx/lynx';
import { OP, component, compound, defineInjectable, defineProvide, pushOp, scheduleFlush, watch } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, namedModel } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import type { InvokableElement } from '../../shared/native-text.js';
import { OVERLAY_ROOT_STYLE } from '../../overlay/OverlayHost.js';

const anatomy = anatomies['chat-log'];

/** The default name (and text) of the jump trigger. */
const JUMP_LABEL = 'Jump to latest';

/** How many times a pin re-checks that it landed at the end. */
export const CHAT_LOG_SETTLE_TRIES = 3;
/** The delay between those re-checks, in ms. */
export const CHAT_LOG_SETTLE_DELAY = 48;

/**
 * Scroll the native scroller — lynx has no `element.scrollTo()`. The
 * `focusNative` seam's shape: an element with its own `invoke` (main
 * thread, a test double) is called directly; a background-thread
 * ShadowElement rides the fire-and-forget `INVOKE_UI_METHOD` op.
 */
function scrollNative(el: InvokableElement | null, offset: number): void {
    if (!el) return;
    const params = { offset, smooth: false };
    if (typeof el.invoke === 'function') {
        try {
            const result = el.invoke('scrollTo', params);
            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch(() => {});
            }
        } catch {
            // No native node yet — the next layout pins again.
        }
        return;
    }
    if (typeof el.id === 'number') {
        pushOp(OP.INVOKE_UI_METHOD, el.id, 'scrollTo', params);
        scheduleFlush();
    }
}

/** A layout event's height — the modern `detail`, else Android's legacy `params`. */
function heightOf(event: LayoutChangeEvent): number | null {
    const h = (event.detail ?? event.params)?.height;
    return typeof h === 'number' && Number.isFinite(h) ? h : null;
}

/** The scroll offset that shows the end: content taller than the viewport, else 0. */
export function chatLogEndOffset(contentHeight: number, viewportHeight: number): number {
    return Math.max(0, contentHeight - viewportHeight);
}

interface ScrollDetail {
    scrollTop?: number;
    deltaY?: number;
}

interface ChatLogContext {
    following(): boolean;
    /** Jump to the end and follow. */
    jump(): void;
    /** The scroller element (for `scrollTo`). */
    setScroller(el: InvokableElement | null): void;
    viewportLayout(event: LayoutChangeEvent): void;
    contentLayout(event: LayoutChangeEvent): void;
    scrolled(detail: ScrollDetail): void;
    label(): string | undefined;
}

const useChatLogContext = defineInjectable<ChatLogContext>(() => ({
    following: () => true,
    jump: () => {},
    setScroller: () => {},
    viewportLayout: () => {},
    contentLayout: () => {},
    scrolled: () => {},
    label: () => undefined,
}));

// ── Root ──

export type ChatLogRootProps =
    /** The transcript's accessible name (on the scroller). */
    & Define.Prop<'label', string, false>
    /** Distance from the end, in px, that still counts as AT the end. Default 24. */
    & Define.Prop<'threshold', number, false>
    /**
     * Whether the log follows its tail. The reader's scroll writes it
     * (false on scrolling up, true on reaching the end); writing true jumps
     * to the end.
     */
    & Define.Model<'following', boolean>
    & Define.Prop<'defaultFollowing', boolean, false>
    & Define.Event<'followingChange', boolean>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const ChatLogRoot = component<ChatLogRootProps>(({ props, slots, emit, onUnmounted }) => {
    const following = createControllableState<boolean>(
        () => namedModel<boolean>(props.following),
        props.defaultFollowing ?? true,
        (v) => emit('followingChange', v),
    );
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));

    // Geometry — not reactive: nothing renders from it.
    let scroller: InvokableElement | null = null;
    let viewportH: number | null = null;
    let contentH: number | null = null;
    let scrollTop = 0;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const threshold = (): number => props.threshold ?? 24;
    const endOffset = (): number | null =>
        (viewportH === null || contentH === null ? null : chatLogEndOffset(contentH, viewportH));

    const clearTimer = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
    };

    /**
     * Scroll to the end, then re-check a bounded number of times: a pin
     * issued in the same frame a row lands can reach native before the row
     * is laid out, and the end moves under it.
     */
    const settle = (): void => {
        clearTimer();
        const target = endOffset();
        if (target === null || !following.value) return;
        if (scrollTop >= target - 1) return;
        scrollNative(scroller, target);
        if (tries >= CHAT_LOG_SETTLE_TRIES) return;
        tries += 1;
        timer = setTimeout(settle, CHAT_LOG_SETTLE_DELAY);
    };
    const pin = (): void => {
        tries = 0;
        settle();
    };
    onUnmounted(clearTimer);

    // Following again — the reader's scroll, the trigger, or the app
    // writing the model — puts the end in view.
    watch(() => following.value, (on) => {
        if (on) pin();
        else clearTimer();
    });

    const ctx: ChatLogContext = {
        following: () => following.value,
        jump: () => {
            if (following.value) pin();
            else following.value = true;
        },
        setScroller: (el) => { scroller = el; },
        viewportLayout: (event) => {
            const h = heightOf(event);
            if (h === null) return;
            viewportH = h;
            if (following.value) pin();
        },
        contentLayout: (event) => {
            const h = heightOf(event);
            if (h === null) return;
            contentH = h;
            if (following.value) pin();
        },
        scrolled: (detail) => {
            if (typeof detail.scrollTop === 'number') scrollTop = detail.scrollTop;
            const target = endOffset();
            if (target === null) return;
            const distance = target - scrollTop;
            if (distance <= threshold()) {
                if (!following.value) following.value = true;
            } else if ((detail.deltaY ?? 0) < 0 && following.value) {
                // The reader pulled the history down: let go of the tail.
                clearTimer();
                following.value = false;
            }
        },
        label: () => props.label,
    };
    defineProvide(useChatLogContext, () => ctx);

    return () => (
        <view
            {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}
            // The dock positions against the frame.
            style={{ position: 'relative' }}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'ChatLog.Root' });

// ── Content ──

export type ChatLogContentProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/** A native vertical scroller filling the frame, the content part inside it. */
const SCROLLER_STYLE = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 } as const;

const ChatLogContent = component<ChatLogContentProps>(({ props, slots }) => {
    const log = useChatLogContext();
    const axes = useVariantAxes();
    // One ref for the component's life: an inline arrow re-attaches per render.
    const scrollerRef = (el: InvokableElement | null): void => log.setScroller(el);
    return () => {
        const label = log.label();
        return (
            <scroll-view
                style={SCROLLER_STYLE}
                scroll-orientation="vertical"
                scroll-y
                ref={scrollerRef}
                {...(label ? { 'accessibility-label': label } : {})}
                bindlayoutchange={log.viewportLayout}
                bindscroll={(event: { detail?: ScrollDetail }) => log.scrolled(event.detail ?? {})}
            >
                <view
                    {...partBag(anatomy, 'content', { ...partAxes(axes()), class: props.class })}
                    bindlayoutchange={log.contentLayout}
                >
                    {slots.default?.()}
                </view>
            </scroll-view>
        );
    };
}, { name: 'ChatLog.Content' });

// ── JumpTrigger ──

export type ChatLogJumpTriggerProps =
    /** Its accessible name — and its text, with no children. Default "Jump to latest". */
    & Define.Prop<'label', string, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** The dock: the frame's foot, centring the trigger, never taking a tap itself. */
const DOCK_STYLE = {
    position: 'absolute',
    left: '0px',
    right: '0px',
    bottom: '8px',
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    pointerEvents: 'none',
} as const;

const ChatLogJumpTrigger = component<ChatLogJumpTriggerProps>(({ props, slots }) => {
    const log = useChatLogContext();
    const axes = useVariantAxes();
    const press = createPressFeedback({ feel: props.pressFeel !== false });
    return () => {
        // hiddenIn: ['closed'] — while the log follows, the trigger is gone.
        if (log.following()) return null;
        const label = props.label ?? JUMP_LABEL;
        return (
            <view style={DOCK_STYLE}>
                <view
                    {...partBag(anatomy, 'jump-trigger', {
                        state: 'open',
                        flags: { pressed: press.pressed() },
                        ...partAxes(axes()),
                        class: props.class,
                    })}
                    {...partA11y({ trait: 'button', label })}
                    style={OVERLAY_ROOT_STYLE}
                    bindtap={() => log.jump()}
                    {...press.handlers}
                >
                    {(slots.default?.() as JSXElement | undefined) ?? <text>{label}</text>}
                </view>
            </view>
        );
    };
}, { name: 'ChatLog.JumpTrigger' });

export const ChatLog = compound(ChatLogRoot, {
    Root: ChatLogRoot,
    Content: ChatLogContent,
    JumpTrigger: ChatLogJumpTrigger,
});
