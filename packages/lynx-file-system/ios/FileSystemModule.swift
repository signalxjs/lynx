import Foundation
import Lynx

/// File system access module.
/// JS usage: NativeModules.FileSystem.readFile("data.json", callback)
class FileSystemModule: NSObject, LynxModule {

    @objc static var name: String { "FileSystem" }

    @objc static var methodLookup: [String: String] {
        [
            "readFile": NSStringFromSelector(#selector(readFile(_:callback:))),
            "readFileBase64": NSStringFromSelector(#selector(readFileBase64(_:callback:))),
            "writeFile": NSStringFromSelector(#selector(writeFile(_:content:callback:))),
            "deleteFile": NSStringFromSelector(#selector(deleteFile(_:callback:))),
            "getInfo": NSStringFromSelector(#selector(getInfo(_:callback:))),
            "getDocumentDirectory": NSStringFromSelector(#selector(getDocumentDirectory)),
            "getCacheDirectory": NSStringFromSelector(#selector(getCacheDirectory)),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    private let fileManager = FileManager.default

    @objc func readFile(_ path: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        guard fileManager.fileExists(atPath: resolvedPath) else {
            callback?(["error": "File not found: \(path)"])
            return
        }
        do {
            let content = try String(contentsOfFile: resolvedPath, encoding: .utf8)
            callback?(content)
        } catch {
            callback?(["error": error.localizedDescription])
        }
    }

    /// Read a file as raw bytes, returned base64-encoded. Accepts the same
    /// paths as `readFile` plus `file://` URIs (what pickers hand back).
    @objc func readFileBase64(_ path: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        guard fileManager.fileExists(atPath: resolvedPath) else {
            callback?(["error": "File not found: \(path)"])
            return
        }
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: resolvedPath))
            callback?(data.base64EncodedString())
        } catch {
            callback?(["error": error.localizedDescription])
        }
    }

    @objc func writeFile(_ path: String?, content: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        let directory = (resolvedPath as NSString).deletingLastPathComponent
        try? fileManager.createDirectory(atPath: directory, withIntermediateDirectories: true)
        do {
            try (content ?? "").write(toFile: resolvedPath, atomically: true, encoding: .utf8)
            callback?(true)
        } catch {
            callback?(["error": error.localizedDescription])
        }
    }

    @objc func deleteFile(_ path: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        // Rejected here as well as on Android, so the contract doesn't fork by
        // platform. iOS has no ContentResolver, so a `content://` string is
        // simply a bogus relative path — it would resolve under Documents,
        // miss, and report the "already gone" no-op: a cross-platform app
        // would see an error on one platform and silence on the other.
        if path.hasPrefix("content://") {
            callback?(["error": "Cannot delete a content:// URI — the app doesn't own that file: \(path)"])
            return
        }
        let resolvedPath = resolveFile(path)
        // Deleting something that isn't there is the documented no-op, and what
        // Android's `File.delete()` does — the JS side now throws on `{ error }`,
        // so `removeItem`'s "no such file" must not reach it.
        //
        // Decided by ATTEMPTING the delete and reading the failure, not by an
        // existence pre-check: `fileExists(atPath:)` **traverses symlinks**, so
        // a dangling link reads as absent and would be skipped — left on disk,
        // where the unguarded `removeItem` used to remove the link itself. The
        // same blindness hides a permission-denied path as a silent success.
        do {
            try fileManager.removeItem(atPath: resolvedPath)
            callback?(true)
        } catch let error as NSError {
            // ENOENT, however it is reported: nothing to delete is not a
            // failure, and this also covers losing the race with another
            // deleter. Anything else is real and must reach the caller.
            let isMissing = (error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError)
                || (error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT))
            if isMissing {
                callback?(true)
            } else {
                callback?(["error": error.localizedDescription])
            }
        }
    }

    @objc func getInfo(_ path: String?, callback: LynxCallbackBlock?) {
        guard let path = path else {
            callback?(["error": "Path is required"])
            return
        }
        let resolvedPath = resolveFile(path)
        let exists = fileManager.fileExists(atPath: resolvedPath)
        // Every key of `FileInfo` is non-optional in TS, so a missing file
        // still gets the zero values Android sends — a partial dictionary
        // would reach callers as `undefined` on a field typed `number`.
        var result: [String: Any] = [
            "uri": resolvedPath,
            "exists": exists,
            "size": 0,
            "isDirectory": false,
            "modifiedAt": 0,
        ]
        if exists {
            do {
                let attrs = try fileManager.attributesOfItem(atPath: resolvedPath)
                result["size"] = (attrs[.size] as? UInt64) ?? 0
                result["isDirectory"] = (attrs[.type] as? FileAttributeType) == .typeDirectory
                // Epoch **milliseconds**, matching Android's `lastModified()`
                // and what the README declares. `timeIntervalSince1970` is
                // seconds, so a raw hand-off made the same file look 1970-ish
                // on iOS and current on Android.
                if let modified = attrs[.modificationDate] as? Date {
                    result["modifiedAt"] = (modified.timeIntervalSince1970 * 1000).rounded()
                }
            } catch {
                // A file that exists but can't be stat'd (a protected-data
                // class file while the device is locked, a permission-denied
                // path) used to fall through as a `FileInfo` reporting
                // `size: 0` — a real failure disguised as an empty file.
                callback?(["error": error.localizedDescription])
                return
            }
        }
        callback?(result)
    }

    @objc func getDocumentDirectory() -> String {
        NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first ?? ""
    }

    @objc func getCacheDirectory() -> String {
        NSSearchPathForDirectoriesInDomains(.cachesDirectory, .userDomainMask, true).first ?? ""
    }

    private func resolveFile(_ path: String) -> String {
        // Accept `file://` URIs (pickers return these) alongside plain paths.
        if path.hasPrefix("file://") {
            if let url = URL(string: path) { return url.path }
            // URL(string:) rejects unescaped characters (e.g. spaces in a
            // JS-prefixed bare path) — strip the scheme manually instead of
            // falling through to relative-path resolution.
            let stripped = String(path.dropFirst("file://".count))
            return stripped.removingPercentEncoding ?? stripped
        }
        if (path as NSString).isAbsolutePath { return path }
        let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first ?? ""
        return (docsDir as NSString).appendingPathComponent(path)
    }
}
