import Foundation
import CryptoKit

/// Streaming bundle downloader: bytes go straight to `tmp/<id>.partial`
/// with an incremental SHA-256, then atomically move into `updates/<id>/`
/// once the hash matches. Single-flight — concurrent calls beyond the first
/// fail fast.
final class UpdateDownloader: NSObject, URLSessionDataDelegate {

    private static let inFlightLock = NSLock()
    private static var inFlight = false

    private let partialURL: URL
    private var output: FileHandle?
    private var hasher = SHA256()
    private var receivedBytes: Int64 = 0
    private var totalBytes: Int64?
    private var lastProgressAt = Date.distantPast
    private var result: String? = "Download did not complete"
    private let done = DispatchSemaphore(value: 0)

    private init(partialURL: URL) {
        self.partialURL = partialURL
    }

    /// Synchronous (call off the main thread). Returns nil on success or an
    /// error message (prefixed with E_* codes the module maps to the bridge).
    static func download(
        url: String,
        expectedSha256: String,
        updateId: String,
        headers: [String: String],
        manifestJson: String,
    ) -> String? {
        let store = UpdateStore.shared

        // Already on disk and intact → success without a byte transferred.
        if FileManager.default.fileExists(atPath: store.bundleFile(updateId).path),
           store.verifySha256(updateId) {
            return nil
        }

        inFlightLock.lock()
        if inFlight {
            inFlightLock.unlock()
            return "E_DOWNLOAD_IN_PROGRESS: another download is running"
        }
        inFlight = true
        inFlightLock.unlock()
        defer {
            inFlightLock.lock()
            inFlight = false
            inFlightLock.unlock()
        }

        guard let requestURL = URL(string: url) else {
            return "Download failed: invalid URL \(url)"
        }

        let fm = FileManager.default
        try? fm.createDirectory(at: store.tmpDir, withIntermediateDirectories: true)
        let partial = store.tmpDir.appendingPathComponent("\(updateId).partial")
        fm.createFile(atPath: partial.path, contents: nil)

        let downloader = UpdateDownloader(partialURL: partial)
        guard let handle = try? FileHandle(forWritingTo: partial) else {
            return "Download failed: cannot open staging file"
        }
        downloader.output = handle

        var request = URLRequest(url: requestURL, timeoutInterval: 30)
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        let session = URLSession(configuration: .ephemeral, delegate: downloader, delegateQueue: nil)
        session.dataTask(with: request).resume()
        downloader.done.wait()
        session.finishTasksAndInvalidate()

        if let failure = downloader.result {
            try? fm.removeItem(at: partial)
            return failure
        }

        let actual = downloader.hasher.finalize().map { String(format: "%02x", $0) }.joined()
        guard actual == expectedSha256.lowercased() else {
            try? fm.removeItem(at: partial)
            return "E_HASH_MISMATCH: expected \(expectedSha256), got \(actual)"
        }

        // Promote: metadata first, bundle move last.
        let dir = store.updateDir(updateId)
        try? fm.removeItem(at: dir)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            var meta = (try? JSONSerialization.jsonObject(with: Data(manifestJson.utf8))) as? [String: Any] ?? [:]
            meta["sha256"] = expectedSha256.lowercased()
            meta["sizeBytes"] = downloader.receivedBytes
            meta["sourceUrl"] = url
            meta["downloadedAt"] = Int(Date().timeIntervalSince1970 * 1000)
            let metaData = try JSONSerialization.data(withJSONObject: meta)
            try metaData.write(to: store.updateJsonFile(updateId), options: .atomic)
            try fm.moveItem(at: partial, to: store.bundleFile(updateId))
        } catch {
            try? fm.removeItem(at: partial)
            return "Download failed: \(error.localizedDescription)"
        }
        return nil
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(
        _ session: URLSession, dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void,
    ) {
        if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            result = "Download failed: HTTP \(http.statusCode)"
            completionHandler(.cancel)
            return
        }
        totalBytes = response.expectedContentLength >= 0 ? response.expectedContentLength : nil
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        output?.write(data)
        hasher.update(data: data)
        receivedBytes += Int64(data.count)
        let now = Date()
        if now.timeIntervalSince(lastProgressAt) >= 0.15 {
            lastProgressAt = now
            UpdatesEventBus.shared.emitProgress(receivedBytes: receivedBytes, totalBytes: totalBytes)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        try? output?.close()
        if let error {
            // A cancel from didReceive(response:) already set a specific message.
            if result == "Download did not complete" || result == nil {
                result = "Download failed: \(error.localizedDescription)"
            }
        } else {
            result = nil
            UpdatesEventBus.shared.emitProgress(
                receivedBytes: receivedBytes, totalBytes: totalBytes ?? receivedBytes)
        }
        done.signal()
    }
}
