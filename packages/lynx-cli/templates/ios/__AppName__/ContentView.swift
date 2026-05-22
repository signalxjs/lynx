import SwiftUI
import UIKit
import Lynx

/// Lightweight controller exposed to the dev menu. Stashes the underlying
/// `LynxView` reference and the currently-loaded URL so the SwiftUI body can
/// trigger reload / change-URL / copy-URL without rebuilding the view tree.
final class DevLynxController: ObservableObject {
    weak var lynxView: LynxView?
    @Published var currentUrl: String = ""

    func reload() {
        guard !currentUrl.isEmpty else { return }
        lynxView?.loadTemplate(fromURL: currentUrl)
    }

    func loadUrl(_ url: String) {
        currentUrl = url
        #if DEBUG
        SigxDevClient.lastConnectedUrl = url
        #endif
        lynxView?.loadTemplate(fromURL: url)
    }

    func copyUrlToPasteboard() {
        UIPasteboard.general.string = currentUrl
    }
}

struct ContentView: View {
    let devUrl: String?

    @StateObject private var devController = DevLynxController()
    @State private var showDevMenu = false
    /// Set by `DevHomeScreen` once the user picks a URL. Treated as if it had
    /// been passed in via `--sigx_dev_url` from then on.
    @State private var resolvedDevUrl: String?

    private var effectiveDevUrl: String? { devUrl ?? resolvedDevUrl }

    /// True iff a non-empty `main.lynx.bundle` is baked into the app's main
    /// bundle. Prebuild seeds an EMPTY placeholder so the Xcode Copy Bundle
    /// Resources phase doesn't fail before `run:ios --release` writes the
    /// real bundle — so size > 0 is the actual "is there content" signal.
    /// When this is false AND no dev URL is set, render `DevHomeScreen` so
    /// the app doesn't white-screen — the path Go-style sandbox apps take on
    /// cold launch.
    private var hasBakedBundle: Bool {
        guard let path = Bundle.main.path(forResource: "main.lynx", ofType: "bundle"),
              let attrs = try? FileManager.default.attributesOfItem(atPath: path),
              let size = attrs[.size] as? UInt64 else {
            return false
        }
        return size > 0
    }

    var body: some View {
        if effectiveDevUrl == nil && !hasBakedBundle {
            #if DEBUG
            DevHomeScreen { url in
                resolvedDevUrl = url
            }
            #else
            // Release build with no bundle is a misconfiguration — surface it.
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.largeTitle)
                Text("No bundle found")
                    .font(.headline)
                Text("This release build has no main.lynx.bundle.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding()
            #endif
        } else {
            LynxContainerView(devUrl: effectiveDevUrl, devController: devController)
                .edgesIgnoringSafeArea(.all)
            #if DEBUG
                .onShake {
                    if effectiveDevUrl != nil { showDevMenu = true }
                }
                // Hardware-keyboard reload — pressing `R` (or `⌘R`) in the
                // iOS Simulator window triggers an in-place reload. Bubbles
                // up via the dev-client's global UIWindow `pressesEnded:`
                // swizzle, so a focused text input still gets the `R` key.
                .onDevReloadKey {
                    if effectiveDevUrl != nil { devController.reload() }
                }
                // Remote-reload bridge — CLI `r` key (or anything else that
                // POSTs to `/__sigx/reload` on the plugin's log WS server)
                // hits `DevClientModule.reload()` over the JS bridge, which
                // posts this notification on the main queue. We just forward
                // it to the dev controller so the LynxView reloads in-place.
                .onReceive(NotificationCenter.default.publisher(for: SigxDevClient.reloadNotification)) { _ in
                    if effectiveDevUrl != nil { devController.reload() }
                }
                .sheet(isPresented: $showDevMenu) {
                    DevMenuView(
                        isPresented: $showDevMenu,
                        actions: DevMenuActions(
                            onReload: { devController.reload() },
                            onChangeUrl: { devController.loadUrl($0) },
                            onCopyUrl: { devController.copyUrlToPasteboard() },
                            // Sandbox apps (no baked bundle) get a "Back to
                            // Home" affordance in the dev menu — disconnects
                            // and returns to DevHomeScreen.
                            onDisconnect: hasBakedBundle ? nil : { resolvedDevUrl = nil },
                            currentUrl: devController.currentUrl
                        )
                    )
                }
            #endif
        }
    }
}

/// UIViewRepresentable wrapper for LynxView.
struct LynxContainerView: UIViewRepresentable {
    let devUrl: String?
    let devController: DevLynxController

    /// Coordinator owns lifecycle publishers (safe-area, future device
    /// observers) so they share the LynxView's lifetime and get released
    /// when SwiftUI tears down the representable. The list is populated by
    /// the auto-generated `GeneratedLifecyclePublishers.attachAll(to:)` —
    /// adding a new publisher is a one-package change.
    final class Coordinator {
        var lifecyclePublishers: [Any] = []
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UIView {
        let screenSize = UIScreen.main.bounds.size
        let isDevMode = devUrl != nil

        let lynxView = LynxView { builder in
            builder.config = LynxSetupService.shared.config
            builder.screenSize = screenSize
            builder.fontScale = 1.0

            #if DEBUG
            if isDevMode {
                SigxDevClient.configureForDev(builder: builder)
            }
            #endif
        }

        lynxView.preferredLayoutWidth = screenSize.width
        lynxView.preferredLayoutHeight = screenSize.height
        lynxView.layoutWidthMode = .exact
        lynxView.layoutHeightMode = .exact

        // Attach lifecycle publishers BEFORE loadTemplate so each publisher's
        // initial updateGlobalProps lands before MT's renderPage runs —
        // gives e.g. SafeArea inset-aware first paint.
        context.coordinator.lifecyclePublishers = GeneratedLifecyclePublishers.attachAll(to: lynxView)

        if let devUrl = devUrl {
            // Dev mode: load from dev server URL (supports HMR).
            lynxView.loadTemplate(fromURL: devUrl)
            devController.lynxView = lynxView
            #if DEBUG
            // Persist so a warm restart (icon tap, no launch args) can reconnect.
            SigxDevClient.lastConnectedUrl = devUrl
            #endif
            // Defer @Published mutation so we don't write state during view update.
            DispatchQueue.main.async { [weak devController] in
                devController?.currentUrl = devUrl
            }
        } else {
            // Production mode: read bundled bytes and hand them to Lynx
            // directly. `loadTemplate(fromURL:)` expects an HTTP(S) URL and
            // fails silently (white screen) when given a filesystem path.
            if let bundlePath = Bundle.main.path(forResource: "main.lynx", ofType: "bundle"),
               let bundleData = try? Data(contentsOf: URL(fileURLWithPath: bundlePath)) {
                lynxView.loadTemplate(bundleData, withURL: bundlePath)
            }
        }

        return lynxView
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}
