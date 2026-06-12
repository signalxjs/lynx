package com.sigx.updates

import android.content.Context

/**
 * Startup bundle resolver — the host's `GeneratedBundleResolver` delegates
 * here (declared as `android.bundleResolverClass` in signalx-module.json).
 *
 * Runs synchronously in MainActivity.onCreate BEFORE any LynxView is built,
 * and mutates rollback state (the launch-attempt counter), so it must be
 * called exactly once per process launch — which the generated host
 * guarantees.
 */
object UpdatesBundleResolver {

    fun resolveStartupBundlePath(context: Context): String? =
        UpdateStore.resolveStartupBundlePath(context)
}
