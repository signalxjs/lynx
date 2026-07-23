package com.sigx.gestures

import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * Registers the `<sigx-touch-guard>` JSX tag with Lynx's UI registry.
 *
 * Discovered by the autolinker via `signalx-module.json`'s `android.behaviors`
 * field; the generated `GeneratedBehaviors.attachAll(builder)` calls
 * `builder.addBehavior(SigxTouchGuardBehavior())` for every `LynxViewBuilder`.
 */
class SigxTouchGuardBehavior : Behavior("sigx-touch-guard") {
    override fun createUI(context: LynxContext): LynxUI<*> {
        return SigxTouchGuardUI(context)
    }
}
