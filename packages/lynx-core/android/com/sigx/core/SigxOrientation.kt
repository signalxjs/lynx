package com.sigx.core

import android.app.Activity
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager

/**
 * Runtime orientation lock (#856).
 *
 * The Activity's manifest `android:screenOrientation` — written from
 * `signalx.config.ts`'s `orientation` — is the ceiling: the OS will not rotate
 * outside the declared set no matter what is requested here. [lock] therefore
 * reports a failure with an actionable message rather than silently doing
 * nothing, which is what a bare `setRequestedOrientation` would look like.
 *
 * [unlock] restores the MANIFEST value, not `UNSPECIFIED` — otherwise a
 * portrait-only app would silently become rotatable after one lock/unlock
 * round trip.
 */
object SigxOrientation {

    /**
     * The Activity's declared orientation, read once from the manifest before
     * the first runtime override lands (afterwards `activity.requestedOrientation`
     * reports the override, not the declaration).
     */
    private var manifestOrientation: Int? = null

    /**
     * Result of a lock/unlock request. `null` = success; a message means
     * failure and is surfaced to JS as `{ error }`, which the bridge wrapper
     * rethrows (CONVENTIONS.md C4).
     */
    private fun ok(): String? = null
    private fun fail(message: String): String = message

    /** Map a JS `OrientationLock` value to an `ActivityInfo.SCREEN_ORIENTATION_*`. */
    private fun toActivityInfo(value: String): Int? = when (value) {
        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        "portrait-upside-down" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
        // Either landscape — the device may still flip between them, matching
        // iOS's `.landscape` mask.
        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        "landscape-left" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        "landscape-right" -> ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE
        "all" -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
        "default" -> null // handled by unlock()
        else -> null
    }

    private fun readManifestOrientation(activity: Activity): Int {
        manifestOrientation?.let { return it }
        val declared = try {
            activity.packageManager
                .getActivityInfo(activity.componentName, PackageManager.GET_META_DATA)
                .screenOrientation
        } catch (_: Throwable) {
            ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
        manifestOrientation = declared
        return declared
    }

    /**
     * Whether [requested] can be satisfied given the manifest declaration.
     * Only the axis locks constrain: `unspecified` / `fullSensor` / `user`
     * allow anything, a portrait lock forbids landscape and vice versa.
     */
    private fun allowedByManifest(declared: Int, requested: Int): Boolean {
        val declaredPortrait = declared == ActivityInfo.SCREEN_ORIENTATION_PORTRAIT ||
            declared == ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT ||
            declared == ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
        val declaredLandscape = declared == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE ||
            declared == ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE ||
            declared == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        if (!declaredPortrait && !declaredLandscape) return true

        val requestedPortrait = requested == ActivityInfo.SCREEN_ORIENTATION_PORTRAIT ||
            requested == ActivityInfo.SCREEN_ORIENTATION_REVERSE_PORTRAIT
        val requestedLandscape = requested == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE ||
            requested == ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE ||
            requested == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        // `all` (fullSensor) can't be honored under an axis lock either.
        if (requested == ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR) return false
        return if (declaredPortrait) requestedPortrait else requestedLandscape
    }

    /** `null` on success, an error message otherwise. */
    fun lock(value: String): String? {
        val activity = SigxActivityHolder.current()
            ?: return fail("No foreground Activity — orientation can't be locked right now.")
        val requested = toActivityInfo(value)
            ?: return fail("Unknown orientation '$value'.")

        val declared = readManifestOrientation(activity)
        if (!allowedByManifest(declared, requested)) {
            return fail(
                "The app is built with a fixed orientation, so lock('$value') can't take " +
                    "effect. Set `orientation: 'default'` (or 'all') in signalx.config.ts " +
                    "and re-run `sigx prebuild`.",
            )
        }

        activity.runOnUiThread { activity.requestedOrientation = requested }
        return ok()
    }

    /** `null` on success, an error message otherwise. */
    fun unlock(): String? {
        val activity = SigxActivityHolder.current()
            ?: return fail("No foreground Activity — orientation can't be unlocked right now.")
        val declared = readManifestOrientation(activity)
        activity.runOnUiThread { activity.requestedOrientation = declared }
        return ok()
    }
}
