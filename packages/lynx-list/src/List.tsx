import {
  component,
  effect,
  signal,
  useElementLayout,
  useMainThreadRef,
  useSharedValue,
  useAnimatedStyle,
  runOnBackground,
  runOnMainThread,
  Gesture,
  useGestureDetector,
  type MainThread,
} from '@sigx/lynx';
import type { ListProps } from './types.js';
import { SCROLL_METHOD } from './methods.js';
import {
  resolveWindowConfig,
  initialWindow,
  expandOlder,
  expandNewer,
  windowAfterItemsChange,
  type ListWindow,
} from './windowing.js';

// App-build define (see lynx-plugin source.define); typeof-guarded at use.
declare const __DEV__: boolean;

// Reserved item-keys for the optional header/footer/loading cells. Prefixed so
// they never collide with a consumer's keyExtractor output.
const HEADER_KEY = '__sigx_list_header__';
const FOOTER_KEY = '__sigx_list_footer__';
const LOADING_KEY = '__sigx_list_loading__';

const DEFAULT_PULL_THRESHOLD = 64;

// `List` always binds `bindscroll` internally (load-more re-arm, chat
// at-bottom tracking), so an unthrottled list streams scroll events to JS at
// frame rate — which helps trip the engine's dispatch limiter during a fling
// (error 204, #606). Nothing internal needs per-frame resolution, so default
// to a coarse interval; consumers can opt into finer ticks via
// `scrollEventThrottle`.
const DEFAULT_SCROLL_THROTTLE = 100;

type ScrollDetail = { detail?: { scrollTop?: number; scrollLeft?: number } };

/**
 * `<List>` — a data-driven, virtualized list built on Lynx's native `<list>`
 * recycler. Only on-screen cells exist as native views regardless of how many
 * items are passed, so it stays smooth for long feeds and grids.
 *
 * ## Sizing
 * The native `<list>` only lays out with a **concrete** main-axis size
 * (flex/percent resolve to zero → nothing renders). So `class`/`style` land on
 * a measuring wrapper `<view>` (where flex sizing works as usual — e.g.
 * `style={{ flexGrow: 1 }}` inside a column), the wrapper measures itself via
 * `bindlayoutchange`, and the list is pinned to the measured px. The list
 * stays mounted from the first render (a 1px placeholder until the measure
 * lands). First paint is one frame after mount. Same pattern as `EmojiGrid` in
 * `@sigx/lynx-emoji`.
 *
 * ## Pull-to-refresh
 * Opt in by passing the controlled `refreshing` prop. A `Gesture.Pan` on the
 * content wrapper (built on the native gesture arena, same recipe as
 * `<Draggable>`) reveals a fixed-height indicator as you pull down while
 * scrolled to the top; releasing past `pullThreshold` emits `refresh`. The
 * indicator stays open while `refreshing` is true and animates away when it
 * flips back to false.
 *
 * ## Load-more
 * `onEndReached` fires once per edge-hit (de-duped until you scroll back up or
 * new items arrive). Set `loadingMore` to show a trailing loading cell.
 *
 * ## Chat mode
 * Pass `inverted` for a bottom-anchored chat: items render oldest→newest, the
 * first paint is already scrolled to the newest (opacity-gated to hide the
 * jump), and new items stick to the bottom while you're there — or surface the
 * `newMessages` affordance when you've scrolled up. Vertical-only.
 *
 * @example
 * ```tsx
 * <List
 *   items={messages}
 *   keyExtractor={(m) => m.id}
 *   renderItem={(m) => <MessageRow message={m} />}
 *   style={{ flexGrow: 1 }}
 *   refreshing={refreshing.value}
 *   onRefresh={() => reload()}
 *   loadingMore={loadingMore.value}
 *   onEndReached={() => loadMore()}
 * />
 * ```
 */
const ListImpl = component<ListProps>(({ props, slots, emit }) => {
  const { layout, onLayoutChange } = useElementLayout();

  // ── Pull-to-refresh wiring (captured once at setup, like <Draggable>) ──
  // Opting in is signalled by passing the controlled `refreshing` prop; when
  // it's absent the gesture/animation registrations are skipped entirely (see
  // the guarded block below) so plain feeds pay nothing. Pull-to-refresh is
  // vertical-only — a horizontal list has no "pull down from the top" — so a
  // horizontal list opts out even if `refreshing` is passed.
  const refreshEnabled = props.refreshing !== undefined && !(props.horizontal ?? false);
  const pullThreshold = props.pullThreshold ?? DEFAULT_PULL_THRESHOLD;

  const contentRef = useMainThreadRef<MainThread.Element | null>(null);
  const pull = useSharedValue(0);

  // MT-side mirrors read by the gesture worklets.
  const atTopRef = useMainThreadRef<boolean>(true);
  const refreshingMTRef = useMainThreadRef<boolean>(props.refreshing ?? false);
  const gst = useMainThreadRef<{ startY: number; canPull: boolean; active: boolean }>({
    startY: 0,
    canPull: false,
    active: false,
  });

  // BG signal gating the list's `enable-scroll` while a pull is in progress so
  // the recycler doesn't also consume the drag (mirrors <Draggable> ↔
  // <ScrollView> coordination).
  const pulling = signal(false);

  const pan = Gesture.Pan()
    .minDistance(0)
    // Load-bearing no-op: iOS only fires onStart/onEnd when an onBegin is
    // registered (see <Draggable>).
    .onBegin(() => {
      'main thread';
    })
    .onStart((e: { params?: { pageY?: number } }) => {
      'main thread';
      if (!refreshEnabled) return;
      const p = e && e.params;
      gst.current.startY = (p && p.pageY) || 0;
      gst.current.canPull = atTopRef.current && !refreshingMTRef.current;
      gst.current.active = false;
    })
    .onUpdate((e: { params?: { pageY?: number } }) => {
      'main thread';
      if (!refreshEnabled || !gst.current.canPull) return;
      const p = e && e.params;
      const dy = ((p && p.pageY) || 0) - gst.current.startY;
      const __flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
        (() => void) | undefined;
      if (dy <= 0) {
        pull.current.value = 0;
        if (__flush) __flush();
        return;
      }
      // Rubber-band resistance; cap a little past the threshold.
      const resisted = dy * 0.5;
      const max = pullThreshold * 1.5;
      pull.current.value = resisted > max ? max : resisted;
      if (__flush) __flush();
      if (!gst.current.active) {
        gst.current.active = true;
        runOnBackground(() => { pulling.value = true; })();
      }
    })
    .onEnd(() => {
      'main thread';
      if (!refreshEnabled || !gst.current.canPull) return;
      gst.current.active = false;
      const crossed = pull.current.value >= pullThreshold && !refreshingMTRef.current;
      const target = crossed ? pullThreshold : 0;
      // Inline ease-out tween (no imported helper — function imports don't
      // survive worklet `_c` capture; same constraint <Draggable> works around).
      const from = pull.current.value;
      const start = Date.now();
      const dur = 240;
      const raf = (globalThis as Record<string, unknown>)['requestAnimationFrame'] as
        ((cb: () => void) => void) | undefined;
      const flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
        (() => void) | undefined;
      const tick = (): void => {
        const t = Math.min((Date.now() - start) / dur, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        pull.current.value = from + (target - from) * eased;
        if (flush) flush();
        if (t < 1 && raf) raf(tick);
      };
      if (raf) raf(tick);
      else { pull.current.value = target; if (flush) flush(); }
      if (crossed) {
        refreshingMTRef.current = true;
        runOnBackground(() => { pulling.value = false; emit('refresh'); })();
      } else {
        runOnBackground(() => { pulling.value = false; })();
      }
    });

  // Register the animated-style binding + gesture detector only when opted in.
  // Setup runs once, so a conditional call simply means "don't emit the
  // REGISTER_AV_STYLE_BINDING / SET_GESTURE_DETECTOR ops at all" for plain feeds.
  if (refreshEnabled) {
    useAnimatedStyle(contentRef, pull, 'translateY');
    useGestureDetector(contentRef, pan);
  }

  // Mirror the controlled `refreshing` prop to MT: close the indicator (tween
  // pull→0) when a refresh completes, and open it for a programmatic refresh
  // that wasn't started by a pull.
  const syncRefreshing = runOnMainThread((r: boolean) => {
    'main thread';
    const was = refreshingMTRef.current;
    refreshingMTRef.current = r;
    const target = !r ? 0 : (pull.current.value < 1 ? pullThreshold : pull.current.value);
    if (r === was || target === pull.current.value) return;
    const from = pull.current.value;
    const start = Date.now();
    const dur = 240;
    const raf = (globalThis as Record<string, unknown>)['requestAnimationFrame'] as
      ((cb: () => void) => void) | undefined;
    const flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
      (() => void) | undefined;
    const tick = (): void => {
      const t = Math.min((Date.now() - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      pull.current.value = from + (target - from) * eased;
      if (flush) flush();
      if (t < 1 && raf) raf(tick);
    };
    if (raf) raf(tick);
    else { pull.current.value = target; if (flush) flush(); }
  });
  effect(() => {
    const r = props.refreshing ?? false;
    // void: runOnMainThread returns a Promise; we don't await the MT tween.
    if (refreshEnabled) void syncRefreshing(r);
  });

  // ── Chat / bottom-anchored mode ───────────────────────────────────────────
  // Natural order (oldest→newest), first-painted at the bottom, optionally
  // sticking to the bottom as new items arrive (else surfacing an unread
  // affordance). Vertical-only; opting in = passing `inverted`.
  const chatEnabled = (props.inverted ?? false) && !(props.horizontal ?? false);
  const stickToBottom = props.stickToBottom ?? true;

  // Our own ref to the <list> for the auto-scroll worklets; reuses the
  // consumer's `mtRef` when they passed one (same element, one binding).
  const ownListRef = useMainThreadRef<MainThread.Element | null>(null);
  const listRef = props.mtRef ?? ownListRef;

  // BG state: `ready` gates the opacity reveal until the first scroll-to-bottom
  // lands; `atBottom`/`unreadCount` drive stick-to-bottom + the affordance.
  const ready = signal(!chatEnabled);
  const atBottom = signal(true);
  const unreadCount = signal(0);

  // Safety net for the opacity reveal. The primary path flips `ready` from the
  // first `layoutcomplete` (which also drives the initial scroll-to-bottom).
  // Under a mount-time layout race that event can fail to land — e.g. the
  // wrapper settles collapsed and the inner list never lays out cells — which
  // would leave the ENTIRE chat stuck at `opacity: 0` forever (the thread is
  // invisible even though the data is there). Guarantee the reveal within a
  // bounded window so that can't happen; the `layoutcomplete` path still wins
  // in the common case (it fires within a frame or two, well under this delay).
  if (chatEnabled) {
    setTimeout(() => { if (!ready.value) ready.value = true; }, 400);
  }

  // ── Windowing ──────────────────────────────────────────────────────────────
  // Template-native cells (#645): renderItem returns a consumer-compiled
  // <list-item> template and List passes it through unwrapped. Template rows
  // are cheap staged records on the wire (the MT builds cells on demand and
  // recycles them), so windowing — which exists to bound eager per-element
  // materialization — is unnecessary and is disabled outright.
  const templateCells = props.templateCells === true;
  // __DEV__ is an app-build define (lynx-plugin source.define) substituted at
  // bundle time even inside this dist; typeof-guarded for non-plugin bundlers.
  if (typeof __DEV__ !== 'undefined' && __DEV__ && templateCells && props.windowSize !== undefined) {
    console.warn(
      '[sigx-list] templateCells makes windowing unnecessary — windowSize is ignored '
        + '(template rows are staged records; cells build on demand and recycle)',
    );
  }

  // Render only a bounded sliding slice of `items` (opt-in via `windowSize`) so
  // a thousands-long history doesn't materialize thousands of <list-item>s — the
  // runtime renders every *rendered* cell eagerly (only native views recycle).
  // The math lives in windowing.ts; here we hold the range as signals and move
  // it from the scroll-edge handlers. Registered before the chat effects below
  // so the window is initialised before the first scroll-to-bottom reads it.
  const windowingEnabled = props.windowSize !== undefined && !templateCells;
  const winCfg = resolveWindowConfig(props.windowSize, props.pageSize, props.maxWindow);
  // Initialise the window SYNCHRONOUSLY at setup. Effects flush on a microtask
  // *after* the first render, so a deferred init would let the first frame
  // materialize every item before windowing engaged — exactly the mount spike
  // windowing exists to prevent. The effect below only handles the
  // empty-at-mount case (items arrive later) and subsequent count changes.
  const win0 = windowingEnabled && props.items.length > 0
    ? initialWindow(props.items.length, winCfg, chatEnabled)
    : { start: 0, end: 0 };
  const winStart = signal(win0.start);
  const winEnd = signal(win0.end);
  let winInit = windowingEnabled && props.items.length > 0;
  let winPrevLen = props.items.length;

  const setWindow = (w: ListWindow): void => {
    if (w.start !== winStart.value) winStart.value = w.start;
    if (w.end !== winEnd.value) winEnd.value = w.end;
  };

  // Best-effort prepend anchoring (DEVICE-PENDING): after revealing an older
  // page above the viewport, scroll back to the item that was on top so the view
  // doesn't jump. Relies on the native <list> scroll UI-method, still unverified
  // on device (see methods.ts) — so it's wrapped best-effort; the at-top-only
  // reveal works without it.
  const anchorRestoreMT = runOnMainThread((cellIndex: number, method: string) => {
    'main thread';
    const el = listRef.current;
    if (!el || cellIndex <= 0) return;
    const p = el.invoke(method, { position: cellIndex, alignTo: 'top', offset: 0, smooth: false });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  });

  // Scroll the <list> back to its first cell on MT (dataset swap). Position 0
  // is content-independent, so unlike the chat scroll-to-bottom it needs no
  // `layoutcomplete` deferral — there is no `position >= data count` risk.
  const scrollToTopMT = runOnMainThread((method: string) => {
    'main thread';
    const el = listRef.current;
    if (!el) return;
    const p = el.invoke(method, { position: 0, alignTo: 'top', offset: 0, smooth: false });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  });

  // Dataset swap (`itemsKey` changed): treat `items` as a brand-new list —
  // re-anchor the window to its initial position and reset scroll to the start
  // (the bottom in chat mode). Registered BEFORE the count effect below and
  // updating `winPrevLen` itself, so the same flush's count change is consumed
  // here and the count effect no-ops instead of clamping the fresh window. The
  // early return keeps the effect subscribed to `itemsKey` only until a swap
  // actually happens. The chat/load-more `let`s referenced here are declared
  // later in setup — fine, effects first flush after setup completes.
  let prevItemsKey = props.itemsKey;
  effect(() => {
    const k = props.itemsKey;
    if (k === prevItemsKey) return;
    prevItemsKey = k;
    const len = props.items.length;
    if (windowingEnabled) {
      setWindow(windowAfterItemsChange(
        { start: winStart.value, end: winEnd.value },
        { len, prevLen: winPrevLen, swapped: true, chat: chatEnabled, anchoredAtEnd: false },
        winCfg,
      ));
      winInit = len > 0;  // empty swap → re-init via the count effect when items arrive
      winPrevLen = len;
    }
    endReachedFired = false;
    if (chatEnabled) {
      // The new dataset first-paints pinned to its newest, unread state clean.
      // chatPrev* are synced so the append effect below doesn't misread the
      // swap as "count grew → N new messages".
      atBottom.value = true;
      unreadCount.value = 0;
      chatPrevCount = len;
      chatPrevLastKey = lastKeyOf(props.items);
      wantBottom = true;          // consumed by onChatLayoutComplete
      wantBottomSmooth = false;
    } else {
      void scrollToTopMT(SCROLL_METHOD);
    }
  });

  // Initialise the window once items exist, then keep it valid as the count
  // changes: an append while anchored at the bottom slides to the newest;
  // anything else just clamps so the indices stay in range.
  effect(() => {
    if (!windowingEnabled) return;
    const len = props.items.length;
    if (!winInit) {
      if (len > 0) {
        setWindow(initialWindow(len, winCfg, chatEnabled));
        winInit = true;
        winPrevLen = len;
      }
      return;
    }
    if (len !== winPrevLen) {
      setWindow(windowAfterItemsChange(
        { start: winStart.value, end: winEnd.value },
        {
          len,
          prevLen: winPrevLen,
          swapped: false,
          chat: chatEnabled,
          // Short-circuit: non-chat lists never read (so never track) atBottom.
          anchoredAtEnd: chatEnabled && stickToBottom && atBottom.value,
        },
        winCfg,
      ));
      winPrevLen = len;
    }
  });

  // Item cells currently rendered (the window slice, or all items when
  // windowing is off) — drives the chat scroll-to-bottom target index.
  const renderedItemCount = (): number =>
    windowingEnabled && winInit ? Math.max(0, winEnd.value - winStart.value) : props.items.length;

  // Total rendered cells = header + rendered items + trailing(footer/loading).
  // The last cell index is the scroll-to-bottom target.
  const totalCells = (): number =>
    (slots.header ? 1 : 0) + renderedItemCount() + (props.loadingMore || slots.footer ? 1 : 0);

  // Scroll the <list> to its last cell on MT. method/lastIndex/smooth are passed
  // as args — worklet `_c` capture doesn't carry imported function refs, and the
  // module constant is passed explicitly to stay on the safe side.
  const scrollToBottomMT = runOnMainThread((lastIndex: number, smooth: boolean, method: string) => {
    'main thread';
    const el = listRef.current;
    if (!el || lastIndex < 0) return;
    const p = el.invoke(method, { position: lastIndex, alignTo: 'bottom', offset: 0, smooth });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  });

  // Scroll-to-bottom is driven by the native list's `layoutcomplete` event, NOT
  // the moment items change. When a message is appended, the new <list-item> and
  // its `update-list-info` reach native asynchronously — calling scrollToPosition
  // in the same tick targets an index native doesn't have yet and the recycler
  // throws `position >= data count`. `layoutcomplete` fires *after* native has
  // laid out the current cells, so the target index is one it actually has. We
  // set `wantBottom` (on first paint and on stick-to-bottom appends) and consume
  // it in the handler; `firstScrollDone` gates the one-time opacity reveal.
  let wantBottom = chatEnabled;   // chat starts wanting to be pinned to the bottom
  let wantBottomSmooth = false;   // first jump is instant; later follows animate
  let firstScrollDone = false;
  const onChatLayoutComplete = (): void => {
    if (!wantBottom) return;
    wantBottom = false;
    void scrollToBottomMT(totalCells() - 1, wantBottomSmooth, SCROLL_METHOD);
    wantBottomSmooth = true;
    if (!firstScrollDone) {
      firstScrollDone = true;
      ready.value = true;          // reveal now that the first jump has landed
    }
  };

  // Stick-to-bottom / unread: distinguish an APPEND (a new message at the end)
  // from a PREPEND (older history paged in at the front via `onStartReached`).
  // Only an append should stick-to-bottom / bump unread; a prepend is just
  // history filling in above the viewport and must do neither — otherwise
  // loading older messages would wrongly show "N new" and yank the view. We
  // detect it by whether the LAST item changed (needs a real `keyExtractor`;
  // with the default index key, prepends shift indices and read as appends).
  const keyAt = (arr: readonly unknown[], i: number): string => {
    const k = props.keyExtractor as ((it: unknown, idx: number) => string) | undefined;
    return k ? k(arr[i], i) : String(i);
  };
  const lastKeyOf = (arr: readonly unknown[]): string | undefined =>
    arr.length === 0 ? undefined : keyAt(arr, arr.length - 1);
  let chatPrevCount = props.items.length;
  let chatPrevLastKey = chatEnabled ? lastKeyOf(props.items) : undefined;
  effect(() => {
    // Inert for non-chat lists — return before reading anything reactive so the
    // effect never re-runs (and never calls keyExtractor) when chat is off.
    if (!chatEnabled) return;
    const items = props.items;
    const count = items.length;
    const lastKey = lastKeyOf(items);
    if (count > chatPrevCount && lastKey !== chatPrevLastKey) {
      // A new item at the end → a real append. Count only the genuinely-new
      // trailing items (locate the previous last item and take what's after it),
      // so a simultaneous prepend + append doesn't count prepended history as new.
      let appended = count - chatPrevCount;
      if (chatPrevLastKey !== undefined) {
        for (let i = count - 1; i >= 0; i--) {
          if (keyAt(items, i) === chatPrevLastKey) { appended = count - 1 - i; break; }
        }
      }
      if (appended > 0) {
        if (stickToBottom && atBottom.value) wantBottom = true;
        else unreadCount.value += appended;
      }
    }
    chatPrevCount = count;
    chatPrevLastKey = lastKey;
  });

  // Tap the unread affordance → scroll to bottom + clear. Every cell is already
  // laid out here (no pending layout), so scroll directly.
  const onUnreadTap = (): void => {
    void scrollToBottomMT(totalCells() - 1, true, SCROLL_METHOD);
    atBottom.value = true;
    unreadCount.value = 0;
  };

  // ── Edge-event de-dup (BG; persists across renders since setup runs once) ──
  // Native re-fires `scrolltoupper`/`scrolltolower` CONTINUOUSLY while the list
  // sits at an edge (~240/s, far above frame rate), and a list whose container
  // size is momentarily invalid reports BOTH edges at once. Acting on every
  // dispatch then ping-pongs the window (expandNewer trims the head → the top
  // edge re-fires → expandOlder trims the tail → repeat), which spins hundreds
  // of re-renders and floods the engine's dispatch limiter (error 204, #606).
  // So each edge acts ONCE per arrival and only re-arms when a real scroll
  // moves away from it — the flags are never reset by the opposite edge, which
  // is what allowed the loop to sustain itself.
  let startReachedFired = false;
  let endReachedFired = false;
  let lastTop = 0;
  let prevCount = props.items.length;

  return () => {
    const horizontal = props.horizontal ?? false;
    // The native `<list>` re-fires `scrolltoupper` CONTINUOUSLY while it sits
    // at its top edge — measured ~1,674 dispatches on one list with no
    // scrolling at all and only 2 renders (~240/s, far above frame rate).
    // Every one is a native→JS `__SendPageEvent`, so registering the handler
    // unconditionally floods the engine's dispatch limiter (error 204,
    // "called too frequently") within a few list mounts, and hands consumers
    // hundreds of bogus `startReached` calls. Register it only when it can do
    // real work: chat mode (load-older is its documented use), a window that
    // actually has older items to reveal, or a consumer explicitly listening.
    // See #606.
    const items = props.items;
    const count = items.length;

    // New items arrived → re-arm onEndReached for the next edge-hit.
    if (count !== prevCount) {
      endReachedFired = false;
      prevCount = count;
    }

    // Pin the list to the measured main-axis size. Until the wrapper's first
    // layout pass lands, fall back to the consumer's `initialMainAxisSize`
    // hint (when they already know the box) so the mount frame lays out at
    // full size — else a 1px placeholder.
    const measured = horizontal ? layout.value?.width : layout.value?.height;
    const hinted = props.initialMainAxisSize;
    const mainAxisPx = measured && measured > 0
      ? `${measured}px`
      : hinted && hinted > 0 ? `${hinted}px` : '1px';
    const listStyle: Record<string, string | number> = horizontal
      ? { width: mainAxisPx, height: '100%' }
      : { height: mainAxisPx, width: '100%' };
    // Chat mode: stay invisible until the first scroll-to-bottom lands so the
    // initial frame doesn't flash at the top. Only when there's something to
    // scroll to — an empty chat has no first-scroll target, so `ready` would
    // never flip and it would render invisible forever.
    if (chatEnabled && !ready.value && count > 0) listStyle.opacity = 0;

    const wantUpperEdge = chatEnabled
      || (windowingEnabled && winInit && winStart.value > 0)
      || (props as { onStartReached?: unknown }).onStartReached !== undefined;

    const keyOf = props.keyExtractor;
    const typeOf = props.itemType;
    const estimated = props.estimatedItemSize;

    // Windowing: render only the bounded slice. Local map indices are mapped
    // back to the real item index so keys / renderItem(item, index) stay correct.
    const windowed = windowingEnabled && winInit;
    const sliceStart = windowed ? winStart.value : 0;
    const visibleItems = windowed ? items.slice(sliceStart, winEnd.value) : items;

    // Empty state replaces the list body (the wrapper still has a child, so it
    // keeps measuring and the list can mount once items arrive).
    const showEmpty = count === 0 && !!slots.empty;

    // Trailing cell: a loading row while `loadingMore`, else the footer slot.
    const trailing = props.loadingMore ? (
      <list-item item-key={LOADING_KEY} item-type="__footer" full-span key={LOADING_KEY}>
        {slots.footer
          ? slots.footer()
          : (
            <view style={{ padding: '12px', alignItems: 'center' }}>
              <text style={{ opacity: 0.6 }}>Loading…</text>
            </view>
          )}
      </list-item>
    ) : slots.footer ? (
      <list-item item-key={FOOTER_KEY} item-type="__footer" full-span key={FOOTER_KEY}>
        {slots.footer()}
      </list-item>
    ) : null;

    const listEl = (
      <list
        style={listStyle}
        scroll-orientation={horizontal ? 'horizontal' : 'vertical'}
        list-type={props.listType ?? 'single'}
        span-count={props.numColumns ?? 1}
        main-thread:ref={chatEnabled || windowingEnabled || props.itemsKey !== undefined
          ? listRef
          : props.mtRef}
        // Spread optional attrs only when set — an `undefined` prop is
        // serialized as a native `null` attribute write (no skip in
        // patchProp), which would clobber the native default.
        {...(props.itemSnap !== undefined ? { 'item-snap': props.itemSnap } : {})}
        {...(props.sticky ? { sticky: true } : {})}
        {...(props.sticky && props.stickyOffset !== undefined
          ? { 'sticky-offset': props.stickyOffset }
          : {})}
        {...(props.onEndReachedThreshold !== undefined
          ? { 'lower-threshold-item-count': props.onEndReachedThreshold }
          : {})}
        {...(props.onStartReachedThreshold !== undefined
          ? { 'upper-threshold-item-count': props.onStartReachedThreshold }
          : {})}
        scroll-event-throttle={props.scrollEventThrottle ?? DEFAULT_SCROLL_THROTTLE}
        {...(refreshEnabled ? { 'enable-scroll': !pulling.value } : {})}
        {...(chatEnabled ? { bindlayoutcomplete: onChatLayoutComplete } : {})}
        {...(refreshEnabled
          ? {
            'main-thread-bindscroll': (e: ScrollDetail) => {
              'main thread';
              atTopRef.current = ((e && e.detail && e.detail.scrollTop) || 0) <= 0;
            },
          }
          : {})}
        bindscrolltolower={() => {
          if (endReachedFired) return;   // continuous re-fire while at the edge
          endReachedFired = true;
          emit('endReached');
          // Chat: reaching the bottom clears the unread affordance.
          if (chatEnabled) {
            atBottom.value = true;
            unreadCount.value = 0;
          }
          // Windowing: at the bottom edge, reveal a newer page if the window
          // doesn't already reach the end (scrolled-down feed, or a chat that
          // paged up and scrolled back).
          if (windowingEnabled && winInit && winEnd.value < count) {
            setWindow(expandNewer({ start: winStart.value, end: winEnd.value }, count, winCfg));
          }
        }}
        {...(wantUpperEdge ? { bindscrolltoupper: () => {
          if (startReachedFired) return;  // continuous re-fire while at the edge
          startReachedFired = true;
          // Windowing: at the top edge, reveal an older page already in `items`.
          // bindscrolltoupper only fires at the top, so this is the at-top-only
          // prepend path (expanding above a top-pinned viewport is the expected
          // "load older" reveal). anchorRestoreMT is the best-effort zero-jump
          // polish (device-pending). Still emit startReached so a consumer can
          // lazily page more history into `items`.
          if (windowingEnabled && winInit && winStart.value > 0) {
            const prevStart = winStart.value;
            setWindow(expandOlder({ start: prevStart, end: winEnd.value }, winCfg));
            const anchorCell = (slots.header ? 1 : 0) + (prevStart - winStart.value);
            void anchorRestoreMT(anchorCell, SCROLL_METHOD);
          }
          emit('startReached');
        } } : {})}
        bindscroll={(e: ScrollDetail) => {
          const d = e?.detail;
          if (!d) return;
          const top = (horizontal ? d.scrollLeft : d.scrollTop) ?? 0;
          // Genuine movement away from an edge re-arms that edge (and only
          // that one). Chat: moving up means new messages surface the unread
          // affordance instead of auto-scrolling.
          if (top < lastTop - 4) {
            endReachedFired = false;
            if (chatEnabled) atBottom.value = false;
          } else if (top > lastTop + 4) {
            startReachedFired = false;
          }
          lastTop = top;
          emit('scroll', { offset: top });
        }}
      >
        {slots.header && (
          <list-item item-key={HEADER_KEY} item-type="__header" full-span key={HEADER_KEY}>
            {slots.header()}
          </list-item>
        )}
        {visibleItems.map((item, localI) => {
          const i = sliceStart + localI;
          const key = keyOf ? keyOf(item, i) : String(i);
          // Template-native rows (#645): the consumer's <list-item> template
          // flows through unwrapped — wrapping would make it slot content
          // (unpoolable, early-materialized). We own the vnode between
          // renderItem() and the reconciler, so keying it in place is safe;
          // an explicit consumer key wins.
          if (templateCells) {
            const cell = props.renderItem(item, i) as
              | { key?: unknown }
              | null
              | undefined;
            if (cell && typeof cell === 'object' && cell.key == null) {
              cell.key = key;
            }
            return cell;
          }
          return (
            <list-item
              key={key}
              item-key={key}
              item-type={typeOf ? typeOf(item, i) : 'item'}
              {...(estimated !== undefined
                ? { 'estimated-main-axis-size-px': estimated }
                : {})}
            >
              {props.renderItem(item, i)}
            </list-item>
          );
        })}
        {trailing}
      </list>
    );

    let body: unknown;
    if (showEmpty) {
      body = slots.empty?.();
    } else if (chatEnabled) {
      // Chat: the list fills the wrapper; the unread affordance floats at the
      // bottom whenever there are unseen messages. `unreadCount` only grows when
      // we didn't auto-scroll to them (scrolled up, or stickToBottom off) and is
      // cleared on reaching the bottom — so `> 0` alone is the right condition
      // (gating on `!atBottom` hid the affordance for stickToBottom:false).
      const showUnread = unreadCount.value > 0;
      body = (
        <view style={{ height: '100%', position: 'relative' }}>
          {listEl}
          {showUnread && (
            <view
              bindtap={onUnreadTap}
              style={{
                position: 'absolute',
                bottom: '12px',
                left: 0,
                right: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {slots.newMessages
                ? slots.newMessages({ count: unreadCount.value })
                : (
                  <view
                    style={{
                      paddingTop: '6px',
                      paddingBottom: '6px',
                      paddingLeft: '14px',
                      paddingRight: '14px',
                      borderRadius: '16px',
                      background: '#2563eb',
                    }}
                  >
                    <text style={{ color: '#ffffff', fontSize: '13px' }}>
                      {`${unreadCount.value} new ↓`}
                    </text>
                  </view>
                )}
            </view>
          )}
        </view>
      );
    } else if (refreshEnabled) {
      // Content wrapper is translated down by `pull`; the indicator sits one
      // threshold above it (hidden) and is revealed as the pull grows.
      body = (
        <view main-thread:ref={contentRef} style={{ height: '100%', position: 'relative' }}>
          <view
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${-pullThreshold}px`,
              height: `${pullThreshold}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {slots.refresh
              ? slots.refresh()
              : <text style={{ opacity: 0.6 }}>Refreshing…</text>}
          </view>
          {listEl}
        </view>
      );
    } else {
      body = listEl;
    }

    return (
      <view
        class={props.class}
        style={props.style}
        bindlayoutchange={onLayoutChange}
      >
        {body}
      </view>
    );
  };
});

// `component()` transforms the prop markers (`Define.Slot`/`Define.Event`) into
// the real JSX surface (`slots`, `onEndReached`, …). Re-type only `items` /
// `renderItem` (and the other T-referencing props) generically over the item
// type `T` so callers get inference while keeping the transformed slots/events
// intact — the plain `<T>(props: ListProps<T>)` cast used by `Swiper` would
// drop both.
type ListJsxProps = Parameters<typeof ListImpl>[0];

/** {@inheritDoc ListImpl} */
export const List = ListImpl as unknown as <T>(
  props: Omit<ListJsxProps, 'items' | 'renderItem' | 'keyExtractor' | 'itemType'> & {
    items: readonly T[];
    renderItem: (item: T, index: number) => unknown;
    keyExtractor?: (item: T, index: number) => string;
    itemType?: (item: T, index: number) => string;
  },
) => unknown;
