import Foundation
import Lynx

/// Handles generic resource fetching (JS chunks, CSS, JSON) for LynxView.
/// Required for HMR hot-update JSON/JS fetches during development.
class DevGenericResourceFetcher: NSObject, LynxGenericResourceFetcher {

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        return URLSession(configuration: config)
    }()

    func fetchResource(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping LynxGenericResourceCompletionBlock
    ) -> (() -> Void)! {
        guard let url = URL(string: request.url ?? "") else {
            callback(nil, NSError(domain: "com.sigx.devclient", code: 400,
                                  userInfo: [NSLocalizedDescriptionKey: "Invalid URL: \(request.url ?? "")"]))
            return {}
        }

        let task = session.dataTask(with: url) { data, response, error in
            if let error = error {
                callback(nil, error)
                return
            }
            // The css-extract HMR runtime iterates EVERY chunk's
            // `.css.hot-update.json` on each update and only acts `if
            // (ret.content)`. Chunks with no CSS change this round (e.g. a
            // JS-only async chunk) have no such file → 404. Passing the 404
            // body through makes `requireModuleAsync` fail → the runtime throws
            // "Failed to load CSS update file …". Return an empty module `{}`
            // (no `content`) so it no-ops cleanly instead. Chunks that DID
            // change still 200 with real content, so CSS HMR is unaffected.
            // Only a 404 means "no CSS change for this chunk" — pass other
            // failures (500/503/…) through so real dev-server problems surface.
            let status = (response as? HTTPURLResponse)?.statusCode ?? 200
            if status == 404, (request.url ?? "").contains(".css.hot-update.json") {
                callback("{}".data(using: .utf8), nil)
                return
            }
            callback(data, nil)
        }
        task.resume()

        // Return cancellation block
        return { task.cancel() }
    }

    func fetchResourcePath(
        _ request: LynxResourceRequest,
        onComplete callback: @escaping LynxGenericResourcePathCompletionBlock
    ) -> (() -> Void)! {
        // Not used for dev server fetching — return error
        callback(nil, NSError(domain: "com.sigx.devclient", code: 501,
                              userInfo: [NSLocalizedDescriptionKey: "fetchResourcePath not implemented"]))
        return {}
    }
}
