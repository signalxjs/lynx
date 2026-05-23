package com.sigx.maps

import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * Registers the `<sigx-map>` JSX tag with Lynx's UI registry.
 *
 * Discovered by the autolinker via `signalx-module.json`'s `android.behaviors`
 * field; the generated `GeneratedBehaviors.attachAll(builder)` calls
 * `builder.addBehavior(SigxMapBehavior())` for every `LynxViewBuilder`
 * in the app (production + dev-client path).
 */
class SigxMapBehavior : Behavior("sigx-map") {
    override fun createUI(context: LynxContext): LynxUI<*> {
        return SigxMapUI(context)
    }
}
