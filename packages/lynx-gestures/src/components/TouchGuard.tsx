import { component, type Define } from '@sigx/lynx';
import '../jsx-augment.js';

/**
 * Overlay container that CONSUMES the platform touch stream, backed by the
 * native `<sigx-touch-guard>` element.
 *
 * **The problem it fixes (#787, Android):** a Lynx `catchtap` overlay blocks
 * Lynx-level handlers beneath it, but the raw platform touch still reaches
 * native views — an EditText under an overlay dim grabs focus and pops the
 * keyboard. `flatten={false}` / `catchtouchstart` / `block-native-event` /
 * `ignore-focus` are all insufficient; only a native view claiming the touch
 * target stops the fall-through. On iOS and web overlays don't leak, so the
 * element is an inert container there — the same JSX works everywhere.
 *
 * ```tsx
 * <TouchGuard
 *   style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
 *   onTap={() => dismiss()}
 * >
 *   <DimContent />
 * </TouchGuard>
 * ```
 *
 * Requires `sigx prebuild` (the element is native). Components that render
 * their own overlay root (e.g. `@sigx/lynx-sheet`'s backdrop via `guardTag`)
 * can use the raw tag directly — `TOUCH_GUARD_TAG`.
 */
export type TouchGuardProps =
  /** Consume the platform touch stream. Default `true`. */
  & Define.Prop<'enabled', boolean, false>
  & Define.Prop<'class', string, false>
  & Define.Prop<'style', Record<string, string | number>, false>
  & Define.Slot<'default'>
  /** Tap on the guard (consumed — it never passes through). */
  & Define.Event<'tap', void>;

export const TouchGuard = component<TouchGuardProps>(({ props, slots, emit }) => {
  return () => (
    <sigx-touch-guard
      guard-enabled={props.enabled ?? true}
      class={props.class}
      style={props.style}
      // catch (not bind): a guard covers content, so its own tap must not
      // bubble into whatever Lynx handlers sit beneath it either.
      catchtap={() => emit('tap')}
    >
      {slots.default?.()}
    </sigx-touch-guard>
  );
});
