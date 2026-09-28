package {{packageName}}

import android.graphics.Typeface
import com.lynx.tasm.behavior.shadow.text.TypefaceCache

/**
 * Resolves the CSS generic font families on Android (#1260).
 *
 * Android Lynx walks a `font-family` list against its typeface cache, the
 * registered `TypefaceCache.LazyProvider`s and `@font-face` rules — it never
 * falls back to the platform's generic faces, so `monospace`, `serif` and
 * `sans-serif` all render in the default face. (iOS resolves them through
 * `UIFont`.) This provider maps each generic onto the matching system
 * typeface in the requested style, so `font-family: Menlo, monospace` gets a
 * mono face on both platforms.
 *
 * Installed from `GeneratedModuleRegistry.registerAll`, which every app calls
 * at startup. Managed file — `sigx prebuild` rewrites it; don't edit.
 */
object SigxGenericFonts {
    @Volatile
    private var installed = false

    private val provider = TypefaceCache.LazyProvider { family, style ->
        val base = when (family.trim().lowercase()) {
            "monospace", "ui-monospace" -> Typeface.MONOSPACE
            "serif", "ui-serif" -> Typeface.SERIF
            "sans-serif", "ui-sans-serif", "system-ui" -> Typeface.SANS_SERIF
            else -> null
        }
        base?.let { Typeface.create(it, style) }
    }

    fun install() {
        if (installed) return
        synchronized(this) {
            if (installed) return
            TypefaceCache.addLazyProvider(provider)
            installed = true
        }
    }
}
