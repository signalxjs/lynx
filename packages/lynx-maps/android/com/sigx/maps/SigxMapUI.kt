package com.sigx.maps

import android.content.Context
import android.os.Bundle
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.Marker
import com.google.android.gms.maps.model.MarkerOptions
import com.lynx.tasm.behavior.LynxContext
import com.lynx.tasm.behavior.LynxProp
import com.lynx.tasm.behavior.ui.LynxBaseUI
import com.lynx.tasm.behavior.ui.LynxUI
import com.lynx.tasm.event.LynxDetailEvent
import org.json.JSONObject

/**
 * Native UI for the `<sigx-map>` JSX element on Android.
 *
 * Prop / event surface (v1):
 *   - `region`               → JSON-stringified `MapRegion`
 *   - `shows-user-location`  → enable user-location dot (requires permission)
 *   - `map-type`             → `"standard" | "satellite" | "hybrid"`
 *   - `bindregionchange`     → CameraIdleListener
 *   - `bindpress`            → OnMapClickListener
 *   - `bindmarkerpress`      → OnMarkerClickListener
 *
 * Imperative methods (animateToRegion / fitToCoordinates) are tracked as a
 * v2 follow-up — same UIMethodInvoker blocker as WebView.
 *
 * @remarks
 * Google MapView requires Activity lifecycle forwarding (onCreate /
 * onResume / onPause / onDestroy). The v1 implementation calls onCreate +
 * onResume in [createView] so the map is interactive immediately, and
 * onPause + onDestroy in [onDetach] / [destroy]. For an app that
 * backgrounds while a map is visible, this is best-effort — most user-
 * visible maps work, but tile prefetching pauses on backgrounding only
 * after the next prebuild wires a proper `activityHook`. Doc'd in README.
 */
class SigxMapUI(context: LynxContext) : LynxUI<MapView>(context) {

    private var googleMap: GoogleMap? = null
    private var pendingRegion: JSONObject? = null
    private var pendingShowUserLocation: Boolean = false
    private var pendingMapType: String? = null
    /** Marker children waiting for GoogleMap to be ready. */
    private val pendingMarkers = mutableListOf<SigxMapMarkerUI>()
    /** All currently-attached markers, by their LynxUI sign. */
    internal val attachedMarkers = mutableMapOf<Int, SigxMapMarkerUI>()

    override fun createView(context: Context): MapView {
        val map = MapView(context)
        // Bundle=null is the Google-recommended invocation when the host
        // doesn't save/restore MapView state per-instance.
        map.onCreate(null)
        map.onStart()
        map.onResume()
        map.getMapAsync { gmap ->
            googleMap = gmap
            applyPendingState()
            wireListeners(gmap)
            // Attach any markers that arrived before the map was ready.
            for (m in pendingMarkers) attachMarker(m)
            pendingMarkers.clear()
        }
        return map
    }

    override fun onDetach() {
        super.onDetach()
        // Best-effort lifecycle pairing — see class-level remarks.
        runCatching { mView.onPause() }
        runCatching { mView.onStop() }
    }

    // ── Child plumbing ───────────────────────────────────────────────────

    override fun insertChild(child: LynxBaseUI?, index: Int) {
        if (child is SigxMapMarkerUI) {
            attachMarker(child)
            return
        }
        super.insertChild(child, index)
    }

    override fun removeChild(child: LynxBaseUI?) {
        if (child is SigxMapMarkerUI) {
            detachMarker(child)
            return
        }
        super.removeChild(child)
    }

    internal fun attachMarker(marker: SigxMapMarkerUI) {
        marker.owningMap = this
        attachedMarkers[marker.sign] = marker
        val gmap = googleMap
        if (gmap == null) {
            pendingMarkers.add(marker)
            return
        }
        val opts = MarkerOptions()
            .position(LatLng(marker.coordinateLat, marker.coordinateLng))
            .title(marker.markerTitle)
            .snippet(marker.markerDescription)
        val pin = gmap.addMarker(opts)
        if (pin != null) {
            pin.tag = marker.sign
            marker.attachedMarker = pin
        }
    }

    internal fun detachMarker(marker: SigxMapMarkerUI) {
        attachedMarkers.remove(marker.sign)
        pendingMarkers.remove(marker)
        marker.attachedMarker?.remove()
        marker.attachedMarker = null
        marker.owningMap = null
    }

    /** Re-sync an already-attached marker's coords/title after a prop change. */
    internal fun markerDidUpdate(marker: SigxMapMarkerUI) {
        val pin = marker.attachedMarker ?: return
        pin.position = LatLng(marker.coordinateLat, marker.coordinateLng)
        pin.title = marker.markerTitle
        pin.snippet = marker.markerDescription
    }

    // ── State application ────────────────────────────────────────────────

    private fun applyPendingState() {
        val gmap = googleMap ?: return
        pendingRegion?.let { applyRegion(it) }
        pendingRegion = null
        gmap.isMyLocationEnabled = try {
            pendingShowUserLocation
        } catch (_: SecurityException) {
            // Caller forgot to request ACCESS_FINE_LOCATION at runtime.
            android.util.Log.w(
                "SigxMap",
                "shows-user-location=true but ACCESS_FINE_LOCATION not granted",
            )
            false
        }
        pendingMapType?.let { applyMapType(it) }
    }

    private fun applyRegion(obj: JSONObject) {
        val gmap = googleMap ?: return
        val lat = obj.optDouble("latitude", Double.NaN)
        val lon = obj.optDouble("longitude", Double.NaN)
        val latD = obj.optDouble("latitudeDelta", Double.NaN)
        val lonD = obj.optDouble("longitudeDelta", Double.NaN)
        if (lat.isNaN() || lon.isNaN()) return
        // Map latDelta/lonDelta to a Google-Maps zoom level. Google's zoom
        // is logarithmic — zoom n shows 360°/2^n degrees of longitude
        // horizontally. Solve for n from the user's lonDelta: invert and
        // log. Clamp to Google's [2, 21] zoom range.
        val zoom = if (lonD > 0.0) {
            val z = Math.log(360.0 / lonD) / Math.log(2.0)
            z.toFloat().coerceIn(2f, 21f)
        } else {
            12f
        }
        gmap.moveCamera(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder().target(LatLng(lat, lon)).zoom(zoom).build(),
            ),
        )
    }

    private fun applyMapType(value: String) {
        val gmap = googleMap ?: return
        gmap.mapType = when (value) {
            "satellite" -> GoogleMap.MAP_TYPE_SATELLITE
            "hybrid"    -> GoogleMap.MAP_TYPE_HYBRID
            else        -> GoogleMap.MAP_TYPE_NORMAL
        }
    }

    private fun wireListeners(gmap: GoogleMap) {
        gmap.setOnCameraIdleListener {
            val target = gmap.cameraPosition.target
            // Approximate the LynxRegion shape — Google reports zoom rather
            // than deltas, so back-compute span from the visible bounds.
            val bounds = gmap.projection.visibleRegion.latLngBounds
            val latD = bounds.northeast.latitude - bounds.southwest.latitude
            val lonD = bounds.northeast.longitude - bounds.southwest.longitude
            fireEvent(
                "regionchange",
                mapOf(
                    "region" to mapOf(
                        "latitude" to target.latitude,
                        "longitude" to target.longitude,
                        "latitudeDelta" to latD,
                        "longitudeDelta" to lonD,
                    ),
                ),
            )
        }
        gmap.setOnMapClickListener { latLng ->
            fireEvent(
                "press",
                mapOf(
                    "coordinate" to mapOf(
                        "latitude" to latLng.latitude,
                        "longitude" to latLng.longitude,
                    ),
                ),
            )
        }
        gmap.setOnMarkerClickListener { gMarker ->
            val sign = gMarker.tag as? Int ?: return@setOnMarkerClickListener false
            val marker = attachedMarkers[sign] ?: return@setOnMarkerClickListener false
            fireEvent(
                "markerpress",
                mapOf(
                    "id" to marker.markerId,
                    "coordinate" to mapOf(
                        "latitude" to marker.coordinateLat,
                        "longitude" to marker.coordinateLng,
                    ),
                ),
            )
            // Return false so Google's default behaviour (callout + camera
            // re-centre) still runs.
            false
        }
    }

    // ── Prop setters ─────────────────────────────────────────────────────

    @LynxProp(name = "region")
    fun setRegion(value: String?) {
        if (value.isNullOrEmpty()) return
        val obj = runCatching { JSONObject(value) }.getOrNull() ?: return
        if (googleMap == null) {
            pendingRegion = obj
        } else {
            applyRegion(obj)
        }
    }

    @LynxProp(name = "shows-user-location")
    fun setShowsUserLocation(value: Boolean) {
        pendingShowUserLocation = value
        val gmap = googleMap ?: return
        try {
            gmap.isMyLocationEnabled = value
        } catch (_: SecurityException) {
            android.util.Log.w(
                "SigxMap",
                "shows-user-location=true but ACCESS_FINE_LOCATION not granted",
            )
        }
    }

    @LynxProp(name = "map-type")
    fun setMapType(value: String?) {
        val v = value ?: "standard"
        pendingMapType = v
        applyMapType(v)
    }

    // ── Event firing ─────────────────────────────────────────────────────

    private fun fireEvent(name: String, params: Map<String, Any?>) {
        val event = LynxDetailEvent(sign, name)
        for ((k, v) in params) event.addDetail(k, v)
        lynxContext.eventEmitter.sendCustomEvent(event)
    }
}
