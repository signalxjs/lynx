package com.sigx.maps

import com.lynx.tasm.behavior.Behavior
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.ui.LynxUI

/**
 * Registers the `<sigx-map-marker>` JSX tag with Lynx's UI registry. The
 * actual marker is added to the parent `SigxMapUI`'s GoogleMap on attach;
 * the LynxUI's own view is a zero-size hidden placeholder that never gets
 * laid out, because the parent map intercepts `insertChild` and skips the
 * default add-to-view-hierarchy path.
 */
class SigxMapMarkerBehavior : Behavior("sigx-map-marker") {
    override fun createUI(context: LynxContext): LynxUI<*> {
        return SigxMapMarkerUI(context)
    }
}
