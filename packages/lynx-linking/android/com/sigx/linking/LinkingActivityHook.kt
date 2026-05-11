package com.sigx.linking

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Activity-lifecycle hook for `@sigx/lynx-linking`.
 *
 * Discovered by the auto-linker via `sigx-module.json`'s
 * `android.activityHook` field; the generated `GeneratedActivityHooks` (in
 * the app's package) calls these methods at the matching points in
 * `MainActivity`. Each method is a Kotlin `static`-equivalent (object
 * member) so the dispatcher doesn't need to instantiate anything.
 *
 * What this hook does:
 *   - **onCreate** — forwards the launch intent into [LinkingState] so a
 *     cold-start deep link populates `lynx.__globalProps.initialURL` before
 *     first paint.
 *   - **onNewIntent** — forwards warm-start deep links the same way.
 *   - **onBackPressed** — defers to [BackHandlerState]. If any JS subscriber
 *     is registered (a LynxView is mounted with the bundle wired up),
 *     returns `true` to indicate the press was consumed; JS decides whether
 *     to pop a navigator or call `LinkingModule.exitApp()`.
 */
object LinkingActivityHook {

    @JvmStatic
    fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        LinkingState.handleNewIntent(activity.intent)
    }

    @JvmStatic
    fun onNewIntent(activity: Activity, intent: Intent) {
        LinkingState.handleNewIntent(intent)
    }

    @JvmStatic
    fun onBackPressed(activity: Activity): Boolean {
        return BackHandlerState.dispatch()
    }
}
