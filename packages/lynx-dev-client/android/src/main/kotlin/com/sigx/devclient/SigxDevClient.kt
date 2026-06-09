package com.sigx.devclient

import android.app.Application
import android.content.Context
import android.os.Handler
import android.os.Looper
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
            Log.i(TAG, "Set debug preset values")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register devtool service: ${e.message}", e)
            return
        }

        // Critical for Lynx 3.7: tell LynxDevtoolEnv to load
        // liblynxdevtool_qjs_bridge.so when the native devtool initialises.
        // Without this the QJS bridge is never loaded,
        // CreateRuntimeManagerDelegate returns null, and the device never
        // appears in Lynx DevTools. Guarded in its own block so that if Lynx
        // renames/removes this method in a future version, the rest of the
        // registration above is still reported as a success.
        try {
            val devToolServiceClass = Class.forName("com.lynx.service.devtool.LynxDevToolService")
            val instance = devToolServiceClass.getMethod("getINSTANCE").invoke(null)
            devToolServiceClass.getMethod("setLoadQJSBridge", Boolean::class.java)
                .invoke(instance, true)
            Log.i(TAG, "Enabled LoadQJSBridge on LynxDevToolService")
        } catch (e: NoSuchMethodException) {
            Log.w(TAG, "LynxDevToolService.setLoadQJSBridge not found — DevTools JS inspector may not attach on this Lynx version")
        } catch (e: Exception) {
            Log.w(TAG, "Failed to enable LoadQJSBridge: ${e.message}")
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

    // ── Remote reload bridge ───────────────────────────────────────────────
    // Lets a remote command (CLI `r` → log WS → DevClientModule.reload()) ask
    // the active dev screen to reload its LynxView. `DevLynxScreen` registers
    // its reload lambda here on enter and clears it on dispose. The module
    // only stores one listener at a time — the last screen to register wins,
    // which matches the actual UX (there's only one LynxView visible).

    @Volatile
    private var reloadHandler: (() -> Unit)? = null
    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    /**
     * Register a reload handler. Returns an unregister lambda the caller MUST
     * invoke when its LynxView goes away — without it, we'd hold a stale
     * reference to a torn-down Compose scope.
     */
    fun setReloadHandler(handler: () -> Unit): () -> Unit {
        reloadHandler = handler
        return {
            // Only clear if we still own the slot. If a newer screen has
            // already replaced us, leave it alone.
            if (reloadHandler === handler) reloadHandler = null
        }
    }

    /**
     * Invoke the registered reload handler on the main thread. Called by
     * `DevClientModule.reload()` after a remote reload arrives over the
     * dev-client log WebSocket. No-op if nothing is registered.
     *
     * Re-reads `reloadHandler` *inside* the posted runnable so a screen
     * that unregisters between the bridge call and main-thread execution
     * doesn't get its lambda invoked against a torn-down Compose scope.
     */
    fun triggerRemoteReload() {
        mainHandler.post {
            val handler = reloadHandler ?: return@post
            try {
                handler()
            } catch (e: Exception) {
                Log.w(TAG, "Remote reload handler threw: ${e.message}", e)
            }
        }
    }

    // ── Connection-state bridge ────────────────────────────────────────────
    // The JS streamer calls `DevClientModule.setConnectionState(connected)`
    // when its log WebSocket drops/reconnects. `DevLynxScreen` registers a
    // handler that toggles the "disconnected" banner. We remember the last
    // value so a screen registering after a drop still reflects reality.

    @Volatile
    private var connectionHandler: ((Boolean) -> Unit)? = null
    @Volatile
    private var lastConnected: Boolean = true

    /**
     * Register a connection-state handler. Immediately invoked with the
     * last-known state. Returns an unregister lambda the caller MUST invoke
     * when its screen goes away.
     */
    fun setConnectionHandler(handler: (Boolean) -> Unit): () -> Unit {
        connectionHandler = handler
        val current = lastConnected
        mainHandler.post {
            if (connectionHandler === handler) {
                try {
                    handler(current)
                } catch (e: Exception) {
                    Log.w(TAG, "Connection-state handler threw: ${e.message}", e)
                }
            }
        }
        return {
            if (connectionHandler === handler) connectionHandler = null
        }
    }

    /** Push a new connection state to the active screen on the main thread. */
    fun setConnectionState(connected: Boolean) {
        lastConnected = connected
        mainHandler.post {
            val handler = connectionHandler ?: return@post
            try {
                handler(connected)
            } catch (e: Exception) {
                Log.w(TAG, "Connection-state handler threw: ${e.message}", e)
            }
        }
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
