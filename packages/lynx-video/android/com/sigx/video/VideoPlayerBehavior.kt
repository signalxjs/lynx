package com.sigx.video

import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * Registers the `<video-player>` JSX tag with Lynx's UI registry.
 *
 * Discovered by the autolinker via `signalx-module.json`'s `android.behaviors`
 * field; the generated `GeneratedBehaviors.attachAll(builder)` calls
 * `builder.addBehavior(VideoPlayerBehavior())` for every `LynxViewBuilder`
 * in the app (production + dev-client path).
 */
class VideoPlayerBehavior : Behavior("video-player") {
    override fun createUI(context: LynxContext): LynxUI<*> {
        return VideoPlayerUI(context)
    }
}
