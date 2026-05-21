package com.sigx.devclient

import android.app.Application
import android.content.Context
import android.util.Log
import com.lynx.tasm.LynxBooleanOption
import com.lynx.tasm.LynxEnv
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.service.LynxServiceCenter

/**
 * Facade API for sigx-lynx dev client.
 *
 * Templates call these methods in order:
 * 1. `SigxDevClient.registerServices()` -- before LynxEnv.init(), registers devtool service
 * 2. `SigxDevClient.enableDevMode()` -- after LynxEnv.init(), enables debug/devtool/logbox
 * 3. `SigxDevClient.configureForDev(builder, context)` -- in LynxView setup for dev mode
 */
object SigxDevClient {

    private const val TAG = "SigxDevClient"

    /**
     * Register LynxDevToolService with the service center.
     * Call BEFORE LynxEnv.inst().init() inside a BuildConfig.DEBUG check.
     */
    fun registerServices() {
        try {
            val devToolServiceClass = Class.forName("com.lynx.service.devtool.LynxDevToolService")

            // LynxDevToolService.INSTANCE is a Kotlin lazy companion property,
            // accessed via the static getINSTANCE() method (not a field).
            val getInstanceMethod = devToolServiceClass.getMethod("getINSTANCE")
            val instance = getInstanceMethod.invoke(null)
                ?: throw IllegalStateException("LynxDevToolService.getINSTANCE() returned null")

            // Register with LynxServiceCenter
            val center = LynxServiceCenter.inst()
            val registerMethod = center.javaClass.methods.firstOrNull {
                it.name == "registerService" &&
                it.parameterTypes.size == 1 &&
                it.parameterTypes[0].isAssignableFrom(instance.javaClass)
            } ?: center.javaClass.methods.first { it.name == "registerService" }

            registerMethod.invoke(center, instance)
            Log.i(TAG, "Registered LynxDevToolService")

            // Set preset values via the concrete class methods
            devToolServiceClass.getMethod("setLynxDebugPresetValue", Boolean::class.java)
                .invoke(instance, true)
            devToolServiceClass.getMethod("setLogBoxPresetValue", Boolean::class.java)
                .invoke(instance, true)
            // Critical: tell LynxDevtoolEnv to load liblynxdevtool_qjs_bridge.so
            // when the native devtool initialises. Without this the QJS bridge
            // is never loaded, and CreateRuntimeManagerDelegate returns null —
            // the inspector_runtime_observer logs "JS debugging is not
            // available" and the device never appears in Lynx DevTools.
            devToolServiceClass.getMethod("setLoadQJSBridge", Boolean::class.java)
                .invoke(instance, true)
            Log.i(TAG, "Set debug preset values + LoadQJSBridge")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register devtool service: ${e.message}", e)
        }
    }

    /**
     * Enable debug features on LynxEnv.
     * MUST be called AFTER LynxEnv.inst().init() -- calling before init() has
     * no effect because init() resets these flags.
     */
    fun enableDevMode() {
        LynxEnv.inst().enableLynxDebug(true)
        LynxEnv.inst().enableDevtool(true)
        LynxEnv.inst().enableLogBox(true)
        // Without these the Lynx DevTools desktop app can attach but the JS
        // inspector bridge never comes up — logcat shows
        // "CreateRuntimeManagerDelegate failed, JS debugging is not available"
        // and the device never appears in the DevTools device list.
        LynxEnv.inst().setEnableDevtoolDebug(true)
        LynxEnv.inst().setEnableJSDebug(true)
        Log.i(TAG, "Enabled devtool, debug, logbox, devtoolDebug, jsDebug on LynxEnv (after init)")
    }

    /**
     * Convenience method that calls registerServices() + enableDevMode().
     * Only use this if you've already called LynxEnv.inst().init().
     */
    fun init(app: Application) {
        registerServices()
        enableDevMode()
    }

    /**
     * Configure a LynxViewBuilder for dev mode (HTTP resource fetching + HMR).
     * Call when launching with a dev server URL.
     */
    fun configureForDev(builder: LynxViewBuilder, context: Context) {
        builder.setTemplateProvider(DevTemplateProvider(context))
        builder.setTemplateResourceFetcher(DevTemplateResourceFetcher(context))
        builder.setEnableGenericResourceFetcher(LynxBooleanOption.TRUE)
        builder.setGenericResourceFetcher(DevGenericResourceFetcher())
        // Per-view debuggable flag. Without this, the LynxDevtool init sees
        // debuggable:false even with LynxEnv devtool/jsDebug flags on, and
        // CreateRuntimeManagerDelegate returns null — the device never appears
        // in the Lynx DevTools desktop app's device list.
        builder.setDebuggable(true)
        Log.i(TAG, "Configured LynxViewBuilder for dev mode (template provider + resource fetchers + debuggable)")
    }
}
