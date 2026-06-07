import Foundation

/// Process-wide registry of live `URLSessionTask`s keyed by the
/// JS-supplied numeric id, plus the multipart body composer.
///
/// Buffered implementation (#249): response bytes accumulate per-task and
/// flush as a single `chunk` event on completion. The streaming milestone
/// (#250) will emit a `chunk` per `didReceive data:` when the request's
/// `streaming` flag is set — a purely additive change here.
final class HttpTaskStore: NSObject, URLSessionDataDelegate {

    static let shared = HttpTaskStore()

    private let queue = DispatchQueue(label: "com.sigx.http.store")
    private var tasks: [Int: URLSessionTask] = [:]
    private var idsByTask: [ObjectIdentifier: Int] = [:]
    /// Accumulated response bodies (buffered mode).
    private var buffers: [Int: Data] = [:]
    /// Temp multipart body files, deleted on completion.
    private var bodyFiles: [Int: URL] = [:]

    /// One shared session; a single delegate target keeps book-keeping flat.
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        // No resource timeout — large uploads/downloads drive their own pace.
        cfg.timeoutIntervalForResource = 0
        return URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
    }()

    // MARK: - JS entry points (via HttpModule)

    func start(id: Int, spec: [String: Any]) {
        guard let urlString = spec["url"] as? String, let url = URL(string: urlString) else {
            HttpEventBus.shared.publish(error: "Invalid URL", id: id)
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = (spec["method"] as? String) ?? "GET"
        if let headers = spec["headers"] as? [String: Any] {
            for (k, v) in headers {
                request.setValue("\(v)", forHTTPHeaderField: k)
            }
        }

        let body = spec["body"] as? [String: Any]
        let bodyType = (body?["type"] as? String) ?? "none"

        var bodyFile: URL? = nil
        switch bodyType {
        case "text":
            request.httpBody = ((body?["text"] as? String) ?? "").data(using: .utf8)
        case "base64":
            guard let data = Data(base64Encoded: (body?["data"] as? String) ?? "") else {
                HttpEventBus.shared.publish(error: "Invalid base64 body", id: id)
                return
            }
            request.httpBody = data
        case "multipart":
            // Compose the multipart body into a temp file and upload from
            // it — file bytes stream from disk, never through the JS bridge
            // and never fully into memory.
            do {
                bodyFile = try MultipartBuilder.compose(
                    boundary: (body?["boundary"] as? String) ?? "----SigxFormBoundary",
                    parts: (body?["parts"] as? [[String: Any]]) ?? []
                )
            } catch {
                HttpEventBus.shared.publish(error: "multipart compose failed: \(error.localizedDescription)", id: id)
                return
            }
        default:
            break
        }

        queue.sync {
            if let old = tasks[id] {
                old.cancel()
                idsByTask.removeValue(forKey: ObjectIdentifier(old))
            }
            let task: URLSessionTask
            if let bodyFile = bodyFile {
                task = session.uploadTask(with: request, fromFile: bodyFile)
                bodyFiles[id] = bodyFile
            } else {
                task = session.dataTask(with: request)
            }
            tasks[id] = task
            idsByTask[ObjectIdentifier(task)] = id
            buffers[id] = Data()
            task.resume()
        }
    }

    func abort(id: Int) {
        queue.sync {
            guard let task = tasks[id] else { return }
            // Cancellation is surfaced (and swallowed) in didCompleteWithError.
            task.cancel()
        }
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(_ session: URLSession,
                    dataTask: URLSessionDataTask,
                    didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let id = queue.sync(execute: { idsByTask[ObjectIdentifier(dataTask)] }),
           let http = response as? HTTPURLResponse {
            var headers: [String: String] = [:]
            for (k, v) in http.allHeaderFields {
                headers["\(k)".lowercased()] = "\(v)"
            }
            HttpEventBus.shared.publish(
                response: http.statusCode,
                statusText: HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                headers: headers,
                id: id
            )
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        queue.sync {
            guard let id = idsByTask[ObjectIdentifier(dataTask)] else { return }
            // Buffered mode: accumulate; flushed as one chunk on completion.
            buffers[id]?.append(data)
        }
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64,
                    totalBytesExpectedToSend: Int64) {
        guard let id = queue.sync(execute: { idsByTask[ObjectIdentifier(task)] }) else { return }
        HttpEventBus.shared.publish(progress: totalBytesSent, total: totalBytesExpectedToSend, id: id)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let cleanup: (id: Int, buffer: Data, bodyFile: URL?)? = queue.sync {
            let key = ObjectIdentifier(task)
            guard let id = idsByTask[key] else { return nil }
            idsByTask.removeValue(forKey: key)
            tasks.removeValue(forKey: id)
            let buffer = buffers.removeValue(forKey: id) ?? Data()
            let bodyFile = bodyFiles.removeValue(forKey: id)
            return (id, buffer, bodyFile)
        }
        guard let (id, buffer, bodyFile) = cleanup else { return }
        if let bodyFile = bodyFile {
            try? FileManager.default.removeItem(at: bodyFile)
        }

        if let error = error {
            // Aborts are initiated (and surfaced) JS-side — swallow them.
            if (error as NSError).code != NSURLErrorCancelled {
                HttpEventBus.shared.publish(error: error.localizedDescription, id: id)
            }
            return
        }

        if !buffer.isEmpty {
            HttpEventBus.shared.publish(chunk: buffer.base64EncodedString(), id: id)
        }
        HttpEventBus.shared.publish(done: id)
    }
}

/// Composes `multipart/form-data` bodies into a temp file.
enum MultipartBuilder {

    enum BuildError: Error {
        case unreadableFile(String)
    }

    /// Write `--boundary` part sections for each descriptor and the final
    /// terminator. File parts are streamed from their `file://` URI in
    /// 64 KB slices so large attachments never sit in memory whole.
    static func compose(boundary: String, parts: [[String: Any]]) throws -> URL {
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("sigx-http-body-\(UUID().uuidString)")
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        let handle = try FileHandle(forWritingTo: tmp)
        defer { try? handle.close() }

        func write(_ s: String) {
            if let d = s.data(using: .utf8) { handle.write(d) }
        }

        for part in parts {
            let kind = (part["kind"] as? String) ?? "field"
            // Defense in depth: JS sanitizes these too, but native callers
            // could hit the bridge directly — never let CR/LF (or quotes in
            // disposition params) reach a header line.
            let name = dispositionSafe((part["name"] as? String) ?? "")
            write("--\(boundary)\r\n")
            if kind == "file" {
                let filename = dispositionSafe((part["filename"] as? String) ?? "file")
                var contentType = headerSafe((part["contentType"] as? String) ?? "")
                if contentType.isEmpty { contentType = "application/octet-stream" }
                let uriString = (part["uri"] as? String) ?? ""
                write("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
                write("Content-Type: \(contentType)\r\n\r\n")
                try appendFile(at: uriString, to: handle)
                write("\r\n")
            } else {
                let value = (part["value"] as? String) ?? ""
                write("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
                write(value)
                write("\r\n")
            }
        }
        write("--\(boundary)--\r\n")
        return tmp
    }

    /// Strip CR/LF so a value can't terminate its header line early.
    private static func headerSafe(_ s: String) -> String {
        s.replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }

    /// Header-safe plus quote-stripping for quoted disposition params.
    private static func dispositionSafe(_ s: String) -> String {
        headerSafe(s).replacingOccurrences(of: "\"", with: "_")
    }

    private static func appendFile(at uriString: String, to handle: FileHandle) throws {
        let url: URL
        if uriString.hasPrefix("file://"), let parsed = URL(string: uriString) {
            url = parsed
        } else {
            url = URL(fileURLWithPath: uriString)
        }
        guard let input = try? FileHandle(forReadingFrom: url) else {
            throw BuildError.unreadableFile(uriString)
        }
        defer { try? input.close() }
        while true {
            let slice = input.readData(ofLength: 64 * 1024)
            if slice.isEmpty { break }
            handle.write(slice)
        }
    }
}
