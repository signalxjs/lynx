import AuthenticationServices
import Foundation
import Lynx
import UIKit

/// System web-auth session module — `ASWebAuthenticationSession`.
///
/// JS usage: `NativeModules.WebAuth.openAuthSession({ … }, callback)`.
///
/// The OS presents a secure browser sheet over the app, shares the system
/// browser's cookies, and — when the provider redirects to the app's
/// `callbackScheme://…` — intercepts the redirect itself, dismisses the sheet,
/// and hands the callback URL back through the completion handler. No
/// AppDelegate hook and no `Linking` involvement is needed on iOS.
class WebAuthModule: NSObject, LynxModule {

    @objc static var name: String { "WebAuth" }

    @objc static var methodLookup: [String: String] {
        [
            "openAuthSession": NSStringFromSelector(#selector(openAuthSession(_:callback:))),
            "cancelAuthSession": NSStringFromSelector(#selector(cancelAuthSession(_:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    /// In-flight sessions, keyed by the JS-supplied `sessionId`. Retained here
    /// so `ASWebAuthenticationSession` (and its presentation anchor) outlive
    /// the call, and so `cancelAuthSession` can reach a running session.
    private static let lock = NSLock()
    private static var sessions: [String: WebAuthSessionHolder] = [:]

    @objc func openAuthSession(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        guard let options = options,
            let sessionId = options["sessionId"] as? String,
            let authorizeUrl = options["authorizeUrl"] as? String,
            let callbackScheme = options["callbackScheme"] as? String
        else {
            callback?(["error": "Missing required parameter(s): sessionId, authorizeUrl, callbackScheme"])
            return
        }
        guard let url = URL(string: authorizeUrl),
            let urlScheme = url.scheme?.lowercased(),
            urlScheme == "http" || urlScheme == "https"
        else {
            callback?(["error": "authorizeUrl must be an http(s) URL"])
            return
        }
        let ephemeral = (options["ephemeral"] as? Bool) ?? false

        // ASWebAuthenticationSession must be created and started on the main
        // thread; the bridge may invoke us off it.
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) {
                callbackURL, error in
                DispatchQueue.main.async {
                    if let callbackURL = callbackURL {
                        Self.finish(sessionId, ["url": callbackURL.absoluteString])
                    } else if let error = error as NSError?, !Self.isCancel(error) {
                        Self.finish(sessionId, ["error": error.localizedDescription])
                    } else {
                        Self.finish(sessionId, ["canceled": true])
                    }
                }
            }

            let holder = WebAuthSessionHolder(session: session, callback: callback)
            if #available(iOS 13.0, *) {
                let anchor = WebAuthAnchorProvider()
                session.presentationContextProvider = anchor
                session.prefersEphemeralWebBrowserSession = ephemeral
                holder.anchor = anchor
            }

            Self.store(holder, for: sessionId)
            if !session.start() {
                Self.finish(sessionId, ["error": "Failed to start the web-auth session"])
            }
        }
    }

    /// Abort the in-flight session identified by `sessionId` (driven by the JS
    /// `AbortSignal`). Resolves the pending promise as `{ canceled: true }`.
    @objc func cancelAuthSession(_ options: [String: Any]?) {
        guard let sessionId = options?["sessionId"] as? String else { return }
        DispatchQueue.main.async {
            // Dismiss the sheet, then settle. `finish` is idempotent, so it's
            // safe whether or not `cancel()` also invokes the completion
            // handler (the behavior differs across iOS versions).
            Self.peekSession(sessionId)?.cancel()
            Self.finish(sessionId, ["canceled": true])
        }
    }

    // MARK: - Session registry (idempotent settle)

    private static func store(_ holder: WebAuthSessionHolder, for sessionId: String) {
        lock.lock()
        sessions[sessionId] = holder
        lock.unlock()
    }

    private static func peekSession(_ sessionId: String) -> ASWebAuthenticationSession? {
        lock.lock()
        defer { lock.unlock() }
        return sessions[sessionId]?.session
    }

    /// Resolve a session's JS callback exactly once and drop it from the registry.
    private static func finish(_ sessionId: String, _ payload: [String: Any]) {
        lock.lock()
        guard let holder = sessions[sessionId], !holder.finished else {
            lock.unlock()
            return
        }
        holder.finished = true
        sessions.removeValue(forKey: sessionId)
        lock.unlock()
        holder.callback?(payload)
    }

    private static func isCancel(_ error: NSError) -> Bool {
        return error.domain == ASWebAuthenticationSessionErrorDomain
            && error.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
    }
}

/// Retains a running session, its presentation anchor, and the JS callback,
/// plus a one-shot `finished` guard so the promise settles exactly once.
private final class WebAuthSessionHolder {
    let session: ASWebAuthenticationSession
    let callback: LynxCallbackBlock?
    var anchor: AnyObject?
    var finished = false

    init(session: ASWebAuthenticationSession, callback: LynxCallbackBlock?) {
        self.session = session
        self.callback = callback
    }
}

@available(iOS 13.0, *)
private final class WebAuthAnchorProvider: NSObject,
    ASWebAuthenticationPresentationContextProviding
{
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            if let key = windowScene.windows.first(where: { $0.isKeyWindow }) { return key }
            if let first = windowScene.windows.first { return first }
        }
        return ASPresentationAnchor()
    }
}
