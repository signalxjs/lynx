package com.sigx.core

import android.content.Context
import android.content.res.Configuration

/**
 * App-level policy for how the OS font-size setting maps onto the Lynx
 * engine's font scale. Stamped from `signalx.config.ts` (`fontScale: {…}`)
 * by the managed `MainActivity.onCreate` before any LynxView is built.
 */
data class SigxFontScalePolicy(
    /** Follow the OS setting. `false` pins the effective scale to 1.0. */
    val follow: Boolean = true,
    /** Lower clamp on the applied scale. */
    val min: Float = 0.5f,
    /** Upper clamp on the applied scale. */
    val max: Float = 2.0f,
)

/**
 * Derives the effective Lynx `fontScale` from the system
 * [Configuration.fontScale] with the app policy applied. Read by the host's
 * LynxViewBuilder seeds and by [FontScalePublisher].
 */
object SigxFontScale {
    @JvmStatic
    var policy = SigxFontScalePolicy()

    /** Raw OS scale (1.0 at the default setting), unclamped. */
    @JvmStatic
    fun osScale(context: Context): Float = context.resources.configuration.fontScale

    /** OS scale with the app policy applied — what the engine receives. */
    @JvmStatic
    fun effectiveScale(context: Context): Float =
        effective(context.resources.configuration)

    internal fun effective(config: Configuration): Float =
        if (!policy.follow) 1.0f else config.fontScale.coerceIn(policy.min, policy.max)
}
