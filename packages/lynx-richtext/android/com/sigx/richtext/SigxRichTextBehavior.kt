package com.sigx.richtext

import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * Registers the `<sigx-richtext>` JSX tag with Lynx's UI registry.
 *
 * Discovered by the autolinker via `signalx-module.json`'s `android.behaviors`;
 * the generated `GeneratedBehaviors.attachAll(builder)` adds this behavior to
 * every `LynxViewBuilder` in the app.
 */
class SigxRichTextBehavior : Behavior("sigx-richtext") {
    override fun createUI(context: LynxContext): LynxUI<*> {
        return SigxRichTextUI(context)
    }
}
