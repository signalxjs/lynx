import Foundation

/// Forwards on-device runtime errors (the ones that populate the red-screen
/// `DevErrorOverlay`) to the `sigx dev` log server, so they also show up —
/// copyable — in the terminal's Logs tab.
///
/// The native `didRecieveError` lifecycle callback catches a *superset* of the
/// JS-side `lynx.onError` hook (main-thread-script, template, render and
/// native-module errors never reach the BG-thread hook), so this is the channel
/// that closes the "only on the red screen" gap.
///
/// Transport: a fire-and-forget `URLSession` POST. All failures are ignored —
/// dev tooling must never crash or block the host app. The log server runs on
/// the dev-server port **+ 1** (the same convention the plugin uses to bake
/// `__SIGX_DEV_LOG_URL__`), so the endpoint is derived from the bundle URL the
/// LynxView is currently rendering.
enum DevServerReporter {

    private static let endpointPath = "/__sigx/device-error"
    private static let timeout: TimeInterval = 1.5

    /// POST `message` to the dev server derived from `bundleUrl`. No-ops when the
    /// URL isn't a usable `http(s)` dev URL. Returns immediately.
    static func report(bundleUrl: String?, message: String) {
        guard let endpoint = deviceErrorEndpoint(from: bundleUrl) else { return }
        let payload: [String: Any] = [
            "message": message,
            "platform": "ios",
            "ts": Int(Date().timeIntervalSince1970 * 1000),
        ]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        // Fire-and-forget — we don't inspect the response.
        URLSession.shared.dataTask(with: request).resume()
    }

    /// Build `http://<host>:<port+1>/__sigx/device-error` from a bundle URL like
    /// `http://192.168.1.5:3000/main.lynx.bundle?...`. Returns nil when the URL
    /// has no usable `http(s)` host/port.
    private static func deviceErrorEndpoint(from bundleUrl: String?) -> URL? {
        guard let bundleUrl, !bundleUrl.isEmpty,
              var components = URLComponents(string: bundleUrl),
              let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              components.host != nil,
              let port = components.port
        else { return nil }
        components.port = port + 1
        components.path = endpointPath
        components.query = nil
        components.fragment = nil
        return components.url
    }
}
