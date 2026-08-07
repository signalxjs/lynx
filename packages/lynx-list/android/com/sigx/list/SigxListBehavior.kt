package com.sigx.list

import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * Registers the `sigx-list` platform tag with Lynx's UI registry.
 *
 * The JS `<List>` opts into it per element via `custom-list-name="sigx-list"`
 * (only when its `bottomInset` prop is set) — the engine's
 * `ListElement::ResolvePlatformNodeTag` resolves the platform node tag to
 * this name verbatim, so every other `<list>` keeps the built-in behavior
 * untouched.
 *
 * Constructor flags mirror the built-in list behavior (`Behavior("list",
 * false, true)`): not flattenable, async-creatable. The async-create path
 * goes through `createUIWithParams`, which the built-in uses too — override
 * both so either path constructs a [SigxListUI].
 *
 * Discovered by the autolinker via `signalx-module.json`'s `android.behaviors`.
 */
class SigxListBehavior : Behavior("sigx-list", false, true) {
    override fun createUI(context: LynxContext): LynxUI<*> {
        return SigxListUI(context)
    }

    override fun createUIWithParams(context: LynxContext, param: Any?): LynxUI<*> {
        return SigxListUI(context, param)
    }
}
