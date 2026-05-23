package com.sigx.maps

import android.content.Context
import android.view.View
import com.google.android.gms.maps.model.Marker
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.LynxUI
import org.json.JSONObject

/**
 * Native UI for the `<sigx-map-marker>` JSX element on Android.
 *
 * A marker doesn't render its own real view — Google Maps tracks pins
 * separately via [com.google.android.gms.maps.GoogleMap.addMarker]. We
 * still need a `LynxUI<View>` because Lynx's UI tree expects every child
 * to be a UI. The native view is a zero-size hidden `View` that never
 * gets laid out because the parent `SigxMapUI` intercepts `insertChild`
 * for markers and skips the default add-to-view-hierarchy path.
 */
class SigxMapMarkerUI(context: LynxContext) : LynxUI<View>(context) {

    internal var owningMap: SigxMapUI? = null
    internal var attachedMarker: Marker? = null

    internal var coordinateLat: Double = 0.0
    internal var coordinateLng: Double = 0.0
    internal var markerTitle: String? = null
    internal var markerDescription: String? = null
    internal var markerId: String = ""

    override fun createView(context: Context): View {
        val v = View(context)
        v.visibility = View.GONE
        return v
    }

    // ── Prop setters ─────────────────────────────────────────────────────

    @LynxProp(name = "coordinate")
    fun setCoordinate(value: String?) {
        if (value.isNullOrEmpty()) return
        val obj = runCatching { JSONObject(value) }.getOrNull() ?: return
        coordinateLat = obj.optDouble("latitude", coordinateLat)
        coordinateLng = obj.optDouble("longitude", coordinateLng)
        owningMap?.markerDidUpdate(this)
    }

    @LynxProp(name = "title")
    fun setTitle(value: String?) {
        markerTitle = value
        owningMap?.markerDidUpdate(this)
    }

    @LynxProp(name = "description")
    fun setDescription(value: String?) {
        markerDescription = value
        owningMap?.markerDidUpdate(this)
    }

    @LynxProp(name = "marker-id")
    fun setMarkerId(value: String?) {
        markerId = value ?: ""
    }
}
