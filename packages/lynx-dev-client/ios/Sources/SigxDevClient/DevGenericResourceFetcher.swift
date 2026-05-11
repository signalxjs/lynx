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
