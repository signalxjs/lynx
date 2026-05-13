import Foundation
import Lynx

/// Native WebSocket bridge — JS-callable side.
///
/// JS usage (via the `@sigx/lynx-websocket` shim, not directly):
///
///   NativeModules.WebSocket.create(id, url, protocols, cb)
///   NativeModules.WebSocket.send(id, payload, isBinary, cb)
///   NativeModules.WebSocket.close(id, code, reason, cb)
///
/// Async lifecycle events (`open`, `message`, `error`, `close`) are pushed
/// back via `WebSocketEventBus`, which a per-LynxView `WebSocketPublisher`
/// forwards to JS through `LynxView.sendGlobalEvent("__sigxWebSocketEvent",
/// [...])`.
///
/// Implemented with `URLSessionWebSocketTask` (iOS 13+). Each socket is
/// stored in `tasks` keyed by the JS-supplied numeric id; the same id is
/// echoed back in every event so the JS shim can demultiplex.
@objc class WebSocketModule: NSObject, LynxModule {

    @objc static var name: String { "WebSocket" }

    @objc static var methodLookup: [String: String] {
        [
            "create": NSStringFromSelector(#selector(create(_:url:protocols:callback:))),
            "send":   NSStringFromSelector(#selector(send(_:payload:isBinary:callback:))),
            "close":  NSStringFromSelector(#selector(close(_:code:reason:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    // MARK: - JS-callable methods

    @objc func create(_ id: NSNumber, url: String?, protocols: [Any]?, callback: LynxCallbackBlock?) {
        guard let urlString = url, let parsed = URL(string: urlString) else {
            WebSocketEventBus.shared.publish(error: "Invalid URL", id: id.intValue)
            WebSocketEventBus.shared.publish(close: 1006, reason: "Invalid URL", wasClean: false, id: id.intValue)
            callback?(NSNull())
            return
        }

        var request = URLRequest(url: parsed)
        if let protos = protocols as? [String], !protos.isEmpty {
            request.setValue(protos.joined(separator: ", "), forHTTPHeaderField: "Sec-WebSocket-Protocol")
        }

        WebSocketTaskStore.shared.create(id: id.intValue, request: request)
        callback?(NSNull())
    }

    @objc func send(_ id: NSNumber, payload: String?, isBinary: NSNumber?, callback: LynxCallbackBlock?) {
        let binary = (isBinary?.boolValue ?? false)
        guard let task = WebSocketTaskStore.shared.task(forId: id.intValue) else {
            callback?(["error": "WebSocket \(id) not found"])
            return
        }

        let message: URLSessionWebSocketTask.Message
        if binary {
            // Payload is base64-encoded on the JS side — decode to raw bytes.
            guard let data = Data(base64Encoded: payload ?? "") else {
                callback?(["error": "Invalid base64 payload"])
                return
            }
            message = .data(data)
        } else {
            message = .string(payload ?? "")
        }

        task.send(message) { error in
            if let error = error {
                WebSocketEventBus.shared.publish(error: error.localizedDescription, id: id.intValue)
            }
        }
        callback?(NSNull())
    }

    @objc func close(_ id: NSNumber, code: NSNumber?, reason: String?, callback: LynxCallbackBlock?) {
        WebSocketTaskStore.shared.close(
            id: id.intValue,
            code: code?.intValue ?? 1000,
            reason: reason ?? ""
        )
        callback?(NSNull())
    }
}
