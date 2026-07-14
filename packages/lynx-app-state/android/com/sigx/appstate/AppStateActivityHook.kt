package com.sigx.appstate

import android.app.Activity

/**
 * Activity hook (declared in signalx-module.json, wired by the autolinker)
 * that feeds foreground/background transitions into [AppStateBus]:
 * onResume → `"active"`, onPause → `"background"`.
 *
 * The bus dedups consecutive duplicates, so the first onResume of a launch
 * (state already `"active"`) emits nothing. No androidx.lifecycle dependency
 * needed — the host's single-activity model makes resume/pause equivalent to
 * process foreground/background for Lynx apps.
 */
object AppStateActivityHook {

    fun onResume(activity: Activity) {
        AppStateBus.emit(AppStateBus.STATE_ACTIVE)
    }

    fun onPause(activity: Activity) {
        AppStateBus.emit(AppStateBus.STATE_BACKGROUND)
    }
}
