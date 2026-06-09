package com.sigx.devclient

import android.app.Application
import android.content.Context
import androidx.compose.runtime.Composable
import com.lynx.jsbridge.LynxModule
import com.lynx.tasm.LynxView
import com.lynx.tasm.LynxViewBuilder

/**
 * Release-build stubs for the sigx-lynx dev client.
 *
 * `sigx prebuild` copies the real dev-client sources (`src/main/kotlin`, the
 * manifest's `sourceDir`) into the app's **debug** source set and this file
 * (the manifest's `releaseStubsDir`) into the **release** source set. The app
 * template (`MainActivity.kt`, `App.kt`) and the generated module registry
 * reference `com.sigx.devclient.*` unconditionally — runtime-gated by
 * `BuildConfig.DEBUG` — so release builds need these symbols on the compile
 * classpath, but none of the dev client's debug-only dependencies (devtool,
 * CameraX, ML Kit barcode scanning, extended Material icons) and none of its
 * code.
 *
 * Every member here must mirror the signature of its `src/main/kotlin`
 * counterpart that the templates reference. If a template starts referencing
 * a new dev-client symbol, add a matching no-op stub here — otherwise
 * `:app:compileReleaseKotlin` fails with "Unresolved reference" (issue #172).
 */

/** No-op mirror of the real [SigxDevClient] facade. */
object SigxDevClient {
    fun registerServices() {}
    fun enableDevMode() {}
    fun init(app: Application) {}
    fun setReloadHandler(handler: () -> Unit): () -> Unit = {}
    fun triggerRemoteReload() {}
    fun setConnectionHandler(handler: (Boolean) -> Unit): () -> Unit = {}
    fun setConnectionState(connected: Boolean) {}
    fun configureForDev(builder: LynxViewBuilder, context: Context) {}
}

/** Mirror of the real [DevSettings]; release builds never persist dev URLs. */
class DevSettings(context: Context) {
    var lastConnectedUrl: String = ""
}

/**
 * Mirror of the real [DevClientModule] so the generated module registry's
 * `DevClientModule::class.java` reference compiles in release. Exposes no
 * `@LynxMethod`s — JS sees a module with no callable surface.
 */
class DevClientModule(context: Context) : LynxModule(context)

/** Never rendered in release (`BuildConfig.DEBUG` guards the call site). */
@Composable
fun DevLynxScreen(
    url: String,
    onBack: (() -> Unit)? = null,
    nativeModules: List<String> = emptyList(),
    onLynxViewBuilder: ((LynxViewBuilder) -> Unit)? = null,
    onLynxViewCreated: ((LynxView) -> Unit)? = null,
) {}

/** Never rendered in release (`BuildConfig.DEBUG` guards the call site). */
@Composable
fun DevHomeScreen(onSelectUrl: (String) -> Unit) {}
