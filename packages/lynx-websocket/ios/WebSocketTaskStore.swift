import Foundation

/// Process-wide registry of live `URLSessionWebSocketTask` instances keyed
/// by the JS-supplied numeric id. Sockets outlive any single LynxView (a
/// page reload should not drop in-flight sockets that the JS bundle is
/// re-attaching to), and the underlying `URLSession` is held here so its
/// delegate callbacks have a stable target.
final class WebSocketTaskStore: NSObject, URLSessionWebSocketDelegate {

    static let shared = WebSocketTaskStore()

    private let queue = DispatchQueue(label: "com.sigx.websocket.store")
    private var tasks: [Int: URLSessionWebSocketTask] = [:]
    /// Reverse lookup so delegate methods (which receive the task, not the
    /// id) can find the id.
    private var idsByTask: [ObjectIdentifier: Int] = [:]

    /// One shared session — URLSession multiplexes WS tasks just fine, and
    /// keeping a single delegate target reduces book-keeping.
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        // No timeout for established sockets — close frames drive teardown.
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 0
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    func create(id: Int, request: URLRequest) {
        queue.sync {
            // If JS re-uses an id (it shouldn't — ids are monotonic), tear
            // down the prior task first so we don't leak.
            if let old = tasks[id] {
                old.cancel()
                idsByTask.removeValue(forKey: ObjectIdentifier(old))
            }
            let task = session.webSocketTask(with: request)
            tasks[id] = task
            idsByTask[ObjectIdentifier(task)] = id
            task.resume()
            pump(id: id, task: task)
        }
    }

    func task(forId id: Int) -> URLSessionWebSocketTask? {
        queue.sync { tasks[id] }
    }

    func close(id: Int, code: Int, reason: String) {
        queue.sync {
            guard let task = tasks[id] else { return }
            let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
            let reasonData = reason.data(using: .utf8)
            task.cancel(with: closeCode, reason: reasonData)
            // Cleanup happens in `urlSession(_:webSocketTask:didCloseWith:)`.
        }
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocolStr: String?) {
        guard let id = queue.sync(execute: { idsByTask[ObjectIdentifier(webSocketTask)] }) else { return }
        WebSocketEventBus.shared.publish(
            open: protocolStr ?? "",
            extensions: "",
            id: id
        )
    }

    func urlSession(_ session: URLSession,
                    webSocketTask: URLSessionWebSocketTask,
                    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
                    reason: Data?) {
        let id: Int? = queue.sync {
            let key = ObjectIdentifier(webSocketTask)
            let v = idsByTask[key]
            idsByTask.removeValue(forKey: key)
            if let v = v { tasks.removeValue(forKey: v) }
            return v
        }
        guard let id = id else { return }
        let reasonStr = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        WebSocketEventBus.shared.publish(
            close: closeCode.rawValue,
            reason: reasonStr,
            wasClean: closeCode != .abnormalClosure,
            id: id
        )
    }

    // URLSessionWebSocketTask uses `receive(completionHandler:)` for reads —
    // we have to pump it ourselves and re-arm after each message. The first
    // call is kicked off in `create(id:request:)`.
    private func pump(id: Int, task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            switch result {
            case .failure(let error):
                // Either the socket closed cleanly (didCloseWith fires
                // separately) or it failed mid-stream — surface the latter
                // as an error event. Cleanup is driven by didCloseWith.
                let nsErr = error as NSError
                if nsErr.code != NSURLErrorCancelled {
                    WebSocketEventBus.shared.publish(error: error.localizedDescription, id: id)
                    // didCloseWith may not fire for transport errors — synthesize.
                    WebSocketEventBus.shared.publish(close: 1006, reason: error.localizedDescription, wasClean: false, id: id)
                    self?.queue.sync {
                        if let task = self?.tasks.removeValue(forKey: id) {
                            self?.idsByTask.removeValue(forKey: ObjectIdentifier(task))
                        }
                    }
                }
                return
            case .success(let message):
                switch message {
                case .string(let s):
                    WebSocketEventBus.shared.publish(messageText: s, id: id)
                case .data(let d):
                    WebSocketEventBus.shared.publish(messageBinary: d.base64EncodedString(), id: id)
                @unknown default:
                    break
                }
                // Re-arm.
                self?.pump(id: id, task: task)
            }
        }
    }
}
