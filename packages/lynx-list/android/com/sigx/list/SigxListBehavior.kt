package com.sigx.list

import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * Registers [SigxListUI] as the app's `list-container` UI — **replacing** the
 * engine's own registration rather than adding a tag beside it.
 *
 * ## Why this is not a custom tag (#930)
 *
 * The obvious design, and the one shipped in #846, is a custom tag: register
 * `sigx-list` and have `<List>` opt in per element with
 * `custom-list-name="sigx-list"`. On Android that does not work, because the
 * **resolved platform tag name is also what selects the C++ list
 * implementation**. The engine ships two: the legacy list (`UIList`, a
 * RecyclerView) and the decoupled list container
 * (`decoupled_list_container_impl.cc` ↔ [UIListContainer]), and `<list>`
 * resolves to the latter. Any *other* tag name — including ours — routes to
 * the legacy C++ driver. Device-verified three ways: with `sigx-list` the
 * legacy `UIList`/`ListScroller` logs appear and the modern ones do not; with
 * `custom-list-name="list-container"` it is the reverse; and pairing the
 * `sigx-list` tag with a [UIListContainer] subclass renders an empty list,
 * because the legacy C++ driver never feeds items to a container view.
 *
 * So a custom tag cannot carry the modern list, and #846's `sigx-list`
 * silently downgraded every `bottomInset` list to the legacy implementation —
 * whose instant bottom-aligned `scrollToPosition` is padding- and
 * cell-height-blind, which is the first-paint miss #930 was filed for.
 *
 * Registering under the engine's own name keeps the modern implementation and
 * removes the per-element opt-in entirely: there is one list on Android again,
 * and `bottomInset` is a method on it rather than a different list. The
 * registry takes the last writer, and the generated registry is attached after
 * `BuiltInBehavior` (see the app's `MainActivity`), so this wins. Constructor
 * flags mirror the built-in `list-container` behavior verbatim
 * (`Behavior("list-container", false, true)` — not flattenable,
 * async-creatable); the async path goes through `createUIWithParams`, so both
 * are overridden.
 *
 * [SigxListUI] is a strict extension — one added UI method plus a
 * bottom-aligned scroll bias that is inert while the inset is 0 — so lists that
 * never set `bottomInset` behave exactly as before.
 *
 * iOS needs none of this: there `custom-list-name="sigx-list"` maps onto
 * `LynxUICollection`, which **is** the class `<list>` already uses, so the tag
 * adds an inset without changing implementations.
 *
 * Discovered by the autolinker via `signalx-module.json`'s `android.behaviors`.
 */
class SigxListBehavior : Behavior("list-container", false, true) {
    override fun createUI(context: LynxContext): LynxUI<*> {
        return SigxListUI(context)
    }

    override fun createUIWithParams(context: LynxContext, param: Any?): LynxUI<*> {
        return SigxListUI(context, param)
    }
}
