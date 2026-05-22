package com.sigx.devclient

import android.view.ViewGroup
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.TemplateData
import com.lynx.xelement.XElementBehaviors

/**
 * Full-featured dev screen that wraps a LynxView with the complete sigx dev experience:
 * - HMR via dev-client resource fetchers
 * - Shake-to-open dev menu
 * - Performance HUD overlay
 * - Error overlay (red screen)
 * - Dev settings persistence
 *
 * Use this as a drop-in replacement for manual LynxView setup in dev mode.
 */
@Composable
fun DevLynxScreen(
    url: String,
    onBack: (() -> Unit)? = null,
    /** Optional list of native module names to show in dev menu. */
    nativeModules: List<String> = emptyList(),
    /**
     * Called once per LynxView after construction. Use to attach lifecycle
     * publishers (e.g. `GeneratedLifecyclePublishers.attachAll(lynxView)`).
     * Called BEFORE renderTemplateUrl so per-view initial state (safe-area
     * insets, etc.) lands before the first MT paint.
     */
    onLynxViewCreated: ((LynxView) -> Unit)? = null,
) {
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showDevMenu by remember { mutableStateOf(false) }
    var currentUrl by remember { mutableStateOf(url) }
    val context = LocalContext.current
    val devSettings = remember { DevSettings(context) }

    var lynxViewRef by remember { mutableStateOf<LynxView?>(null) }
    var perfHudEnabled by remember { mutableStateOf(devSettings.perfHudEnabled) }
    var logBoxEnabled by remember { mutableStateOf(devSettings.logBoxEnabled) }
    var inspectorEnabled by remember { mutableStateOf(false) }

    // Persist last connected URL
    LaunchedEffect(currentUrl) {
        devSettings.lastConnectedUrl = currentUrl
    }

    // Shake detector
    DisposableEffect(Unit) {
        val shakeDetector = ShakeDetector(context) {
            showDevMenu = true
        }
        shakeDetector.start()
        onDispose { shakeDetector.stop() }
    }

    // Reusable reload action shared by the dev-menu button, the error overlay
    // retry button, and the remote-reload handler registered with
    // `SigxDevClient`. Reads `lynxViewRef` / `currentUrl` via Compose
    // property-delegates so each invocation observes the live values.
    val performReload: () -> Unit = {
        lynxViewRef?.let { view ->
            loading = true
            error = null
            try {
                view.reloadAndInit()
                view.renderTemplateUrl(currentUrl, TemplateData.empty())
            } catch (e: Exception) {
                error = e.message ?: "Reload failed"
            }
            loading = false
        }
    }

    // Remote reload bridge — CLI `r` key (or anything else that POSTs to
    // `/__sigx/reload` on the plugin's log WS server) hits
    // `DevClientModule.reload()` over the JS bridge, which dispatches here
    // via `SigxDevClient.triggerRemoteReload()`. We re-register on every
    // composition via `rememberUpdatedState` so the captured lambda always
    // sees the freshest state holders without churning the registration.
    val latestReload by rememberUpdatedState(performReload)
    DisposableEffect(Unit) {
        val unregister = SigxDevClient.setReloadHandler { latestReload() }
        onDispose { unregister() }
    }

    // Wire the system back gesture/button to onBack. Without this, system
    // back falls through to the activity's default behavior (typically
    // finish()), which kills the app instead of returning to a sandbox
    // host's DevHomeScreen. When onBack is null (caller wants no back
    // affordance) we leave the default behavior alone.
    if (onBack != null) {
        BackHandler { onBack() }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                try {
                    val viewBuilder = LynxViewBuilder()
                    viewBuilder.addBehaviors(XElementBehaviors().create())
                    SigxDevClient.configureForDev(viewBuilder, ctx)

                    val lynxView = viewBuilder.build(ctx)
                    lynxView.layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )

                    // Lifecycle publishers (safe-area, future device
                    // observers) attach BEFORE renderTemplate so each
                    // publisher's initial updateGlobalProps lands before
                    // the first MT paint.
                    onLynxViewCreated?.invoke(lynxView)

                    lynxView.renderTemplateUrl(currentUrl, TemplateData.empty())
                    lynxViewRef = lynxView
                    loading = false
                    lynxView
                } catch (e: Exception) {
                    error = e.message ?: "Failed to create LynxView"
                    loading = false
                    android.view.View(ctx)
                }
            }
        )

        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.align(Alignment.Center)
            )
        }

        // Performance HUD overlay
        PerfHud(
            visible = perfHudEnabled,
            lynxView = lynxViewRef,
            modifier = Modifier.align(Alignment.TopEnd)
        )

        // Error overlay
        ErrorOverlay(
            error = error,
            onDismiss = { error = null },
            onReload = performReload,
        )
    }

    // Dev Menu
    DevMenu(
        visible = showDevMenu,
        onDismiss = { showDevMenu = false },
        actions = DevMenuActions(
            onReload = performReload,
            onChangeUrl = { newUrl ->
                currentUrl = newUrl
                lynxViewRef?.let { view ->
                    loading = true
                    error = null
                    try {
                        view.renderTemplateUrl(newUrl, TemplateData.empty())
                    } catch (e: Exception) {
                        error = e.message ?: "Failed to load URL"
                    }
                    loading = false
                }
            },
            onGoHome = onBack,
            onTogglePerfHud = {
                perfHudEnabled = !perfHudEnabled
                devSettings.perfHudEnabled = perfHudEnabled
            },
            onToggleLogBox = {
                logBoxEnabled = !logBoxEnabled
                devSettings.logBoxEnabled = logBoxEnabled
                try {
                    val cls = Class.forName("com.lynx.service.devtool.LynxDevToolService")
                    val instance = cls.getMethod("getINSTANCE").invoke(null)
                    cls.getMethod("setLogBoxPresetValue", Boolean::class.java)
                        .invoke(instance, logBoxEnabled)
                } catch (_: Exception) {}
            },
            onToggleInspector = {
                inspectorEnabled = !inspectorEnabled
                if (inspectorEnabled) {
                    lynxViewRef?.let { view ->
                        try {
                            val cls = Class.forName("com.lynx.service.devtool.LynxDevToolService")
                            val instance = cls.getMethod("getINSTANCE").invoke(null)
                            cls.getMethod("createInspectorOwner", com.lynx.tasm.LynxView::class.java, Boolean::class.java)
                                .invoke(instance, view, true)
                        } catch (_: Exception) {}
                    }
                }
            },
            currentUrl = currentUrl,
            perfHudEnabled = perfHudEnabled,
            logBoxEnabled = logBoxEnabled,
            inspectorEnabled = inspectorEnabled,
            nativeModules = nativeModules
        )
    )
}
