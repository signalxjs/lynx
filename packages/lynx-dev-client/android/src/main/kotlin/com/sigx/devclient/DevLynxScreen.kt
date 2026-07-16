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
import com.lynx.tasm.LynxError
import org.json.JSONObject
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder
import com.lynx.tasm.LynxViewClient
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
     * Called once before `LynxViewBuilder.build()`. Use to attach native UI
     * behaviors (e.g. `GeneratedBehaviors.attachAll(builder)`) so behaviors
     * contributed by `@sigx/lynx-*` packages reach the dev-path LynxView
     * the same way they reach the production path.
     */
    onLynxViewBuilder: ((LynxViewBuilder) -> Unit)? = null,
    /**
     * Called once per LynxView after construction. Use to attach lifecycle
     * publishers (e.g. `GeneratedLifecyclePublishers.attachAll(lynxView)`).
     * Called BEFORE renderTemplateUrl so per-view initial state (safe-area
     * insets, etc.) lands before the first MT paint.
     */
    onLynxViewCreated: ((LynxView) -> Unit)? = null,
) {
    var loading by remember { mutableStateOf(true) }
    // Accumulated errors (build/reload exceptions + Lynx runtime errors), paged
    // by the overlay. Latest-appended; `errorIndex` is the shown one.
    val errors = remember { mutableStateListOf<String>() }
    var errorIndex by remember { mutableStateOf(0) }
    var currentUrl by remember { mutableStateOf(url) }
    val pushError: (String) -> Unit = { msg ->
        errors.add(msg); errorIndex = errors.lastIndex
        // Mirror every overlay error to the `sigx dev` terminal (Logs tab), so
        // device exceptions aren't trapped on the red screen. Reads the live
        // `currentUrl` so the endpoint tracks the bundle actually rendering.
        DevServerReporter.report(currentUrl, msg)
    }
    var showDevMenu by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val devSettings = remember { DevSettings(context) }

    var lynxViewRef by remember { mutableStateOf<LynxView?>(null) }
    var perfHudEnabled by remember { mutableStateOf(devSettings.perfHudEnabled) }
    var logBoxEnabled by remember { mutableStateOf(devSettings.logBoxEnabled) }
    var inspectorEnabled by remember { mutableStateOf(false) }
    // Dev-server connection state, toggled by the JS streamer via
    // SigxDevClient.setConnectionState → the handler registered below.
    var connected by remember { mutableStateOf(true) }

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
            errors.clear(); errorIndex = 0
            try {
                view.reloadAndInit()
                view.renderTemplateUrl(currentUrl, TemplateData.empty())
            } catch (e: Exception) {
                pushError(formatThrowable(e, "Reload failed"))
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

    // Connection-state bridge — the JS streamer reports its log WS up/down via
    // DevClientModule.setConnectionState, dispatched here to toggle the banner.
    DisposableEffect(Unit) {
        val unregister = SigxDevClient.setConnectionHandler { isConnected -> connected = isConnected }
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
                    // Built-in Lynx behaviors carry `<list>` / `<list-item>` /
                    // `<list-container>` (and view/text/image/scroll-view).
                    // Register them explicitly so `<list>` resolves in the dev
                    // runtime (issue #120) instead of relying on implicit setup.
                    viewBuilder.addBehaviors(com.lynx.tasm.behavior.BuiltInBehavior().create())
                    viewBuilder.addBehaviors(XElementBehaviors().create())
                    onLynxViewBuilder?.invoke(viewBuilder)
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

                    // Capture Lynx RUNTIME errors (JS exceptions, prop-setter
                    // throws, …) — the Android analog of iOS's didReceiveError.
                    // Without this the overlay would only see build/reload
                    // exceptions, not errors that fire after first paint.
                    lynxView.addLynxViewClient(object : LynxViewClient() {
                        override fun onReceivedError(error: LynxError) {
                            val msg = formatLynxError(error.toString())
                            // Drop dev-server / HMR artifacts (e.g. "Failed to
                            // load CSS update file …hot-update.json").
                            if (isDevNoise(msg)) return
                            pushError(msg)
                        }
                    })

                    lynxView.renderTemplateUrl(currentUrl, TemplateData.empty())
                    lynxViewRef = lynxView
                    loading = false
                    lynxView
                } catch (e: Exception) {
                    pushError(formatThrowable(e, "Failed to create LynxView"))
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

        // Error overlay (paged when multiple errors accumulate)
        ErrorOverlay(
            errors = errors,
            index = errorIndex,
            onPrev = { if (errorIndex > 0) errorIndex-- },
            onNext = { if (errorIndex < errors.lastIndex) errorIndex++ },
            onDismiss = {
                if (errors.size <= 1) {
                    errors.clear(); errorIndex = 0
                } else {
                    errors.removeAt(errorIndex.coerceIn(0, errors.lastIndex))
                    if (errorIndex > errors.lastIndex) errorIndex = errors.lastIndex
                }
            },
            onReload = performReload,
        )

        // Connection-state banner (top) — sits above everything so it's visible
        // even while the error overlay is showing.
        ConnectionBanner(
            connected = connected,
            modifier = Modifier.align(Alignment.TopCenter),
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
                    errors.clear(); errorIndex = 0
                    try {
                        view.renderTemplateUrl(newUrl, TemplateData.empty())
                    } catch (e: Exception) {
                        pushError(formatThrowable(e, "Failed to load URL"))
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

/** Reason up top, stack behind `DETAIL_MARKER` (collapsible in the overlay). */
private fun formatThrowable(t: Throwable, fallback: String): String {
    val reason = t.message?.takeIf { it.isNotBlank() } ?: fallback
    return "$reason\n$DETAIL_MARKER\n${t.stackTraceToString()}"
}

/** Dev-server / HMR artifacts that aren't real app errors. Checks only the
 *  HEADLINE (before DETAIL_MARKER) so a stack frame mentioning "hot-update"
 *  can't suppress a real error. */
private fun isDevNoise(s: String): Boolean {
    val head = s.substringBefore(DETAIL_MARKER).lowercase()
    return head.contains("hot-update") || head.contains("failed to load css update file")
}

/**
 * Lynx routes JS/internal errors as a JSON blob (`{…"error":"{…rawError:
 * {message,stack}…}"…}`). Dig out the human message + stack so the overlay
 * shows those instead of the raw JSON; returns the input unchanged otherwise.
 */
private fun formatLynxError(raw: String): String {
    if (!raw.trimStart().startsWith("{")) return raw
    return try {
        var node = JSONObject(raw)
        node.optString("error").takeIf { it.isNotBlank() }?.let { inner ->
            try { node = JSONObject(inner) } catch (_: Exception) { /* not nested JSON */ }
        }
        val rawErr = node.optJSONObject("rawError")
        val reason = rawErr?.optString("message")?.takeIf { it.isNotBlank() }
            ?: node.optString("message").takeIf { it.isNotBlank() }
            ?: raw
        val stack = rawErr?.optString("stack")?.takeIf { it.isNotBlank() }
            ?: node.optString("stack").takeIf { it.isNotBlank() }
        if (stack != null) "$reason\n$DETAIL_MARKER\n$stack" else reason
    } catch (_: Exception) {
        raw
    }
}
