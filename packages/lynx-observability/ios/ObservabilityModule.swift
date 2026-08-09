import Foundation
import Lynx

/// Lynx engine memory-usage query (requires Lynx >= 4.0.1).
/// JS usage: NativeModules.Observability.queryMemoryUsage({ timeoutMs }, callback)
///
/// The reading is **process-global** — one query covers every LynxView in the
/// app — so this is a plain module rather than a per-view publisher, and there
/// is nothing to dispose.
///
/// Note this is the *query*, not the passive `memory` performance entry. The
/// entry stream is gated behind `enable_memory_monitor`; the query is not —
/// every `LynxTemplateRender` registers its fetcher unconditionally, so this
/// works with no engine setting.
class ObservabilityModule: NSObject, LynxModule {

    @objc static var name: String { "Observability" }

    @objc static var methodLookup: [String: String] {
        [
            "queryMemoryUsage": NSStringFromSelector(#selector(queryMemoryUsage(_:callback:))),
        ]
    }

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func queryMemoryUsage(_ params: [String: Any]?, callback: LynxCallbackBlock?) {
        // The engine documents `timeoutMs <= 0` as "use the default" (2000 ms),
        // so an absent value maps to 0 rather than to a number we'd have to
        // keep in sync with the engine.
        let timeoutMs = (params?["timeoutMs"] as? NSNumber)?.int64Value ?? 0

        // LynxCallbackBlock is single-shot, and invoking it twice takes the
        // whole bridge down rather than just this call. The engine should call
        // us exactly once, but "the timeout fires, then the slow instance
        // completes" is precisely the shape that would prove otherwise.
        let lock = NSLock()
        var settled = false
        let settle: ([String: Any]) -> Void = { payload in
            lock.lock()
            defer { lock.unlock() }
            if settled { return }
            settled = true
            callback?(payload)
        }

        // The callback fires on Lynx's *report* thread — not the main thread and
        // not the JS thread. Building the dictionary there and handing it
        // straight over is correct: LynxCallbackBlock does its own marshalling,
        // which is the same contract UpdatesModule relies on from its download
        // queue. Hopping to main would only add latency behind the UI.
        LynxMemoryUsageQuery.sharedInstance()
            .queryLynxGlobalMemoryUsageAsync({ result in
                settle(Self.serialize(result))
            }, timeoutMs: timeoutMs)
    }

    /// Every number goes over as a `Double`, deliberately.
    ///
    /// Byte counts are `int64` and Android's bridge has no `putLong`, so they
    /// cross as doubles there (exact below 2^53, i.e. ~9 PB). Sending the counts
    /// the same way costs nothing and means both platforms put identical wire
    /// types on every field, so one JS normalizer serves both.
    private static func serialize(_ r: LynxGlobalMemoryUsageResult) -> [String: Any] {
        [
            // Enum to string at the boundary: JS never sees a magic int, and a
            // future enum member degrades to "unknown" instead of to a number
            // that means something else.
            "collectionStatus": statusString(r.collectionStatus),
            "collectionStartMs": Double(r.collectionStartMs),
            "collectionDurationMs": Double(r.collectionDurationMs),
            "collectionTimeoutMs": Double(r.collectionTimeoutMs),
            "expectedInstanceCount": Double(r.expectedInstanceCount),
            "completedInstanceCount": Double(r.completedInstanceCount),
            "totalBytes": Double(r.totalBytes),
            "appBytes": Double(r.appBytes),
            "ratioToApp": r.ratioToApp,
            "elementBytes": Double(r.elementBytes),
            "elementNodeCount": Double(r.elementNodeCount),
            "viewBytes": Double(r.viewBytes),
            "mainThreadRuntimeBytes": Double(r.mainThreadRuntimeBytes),
            "backgroundThreadRuntimeBytes": Double(r.backgroundThreadRuntimeBytes),
            "instances": r.instances.map(serializeInstance),
        ]
    }

    private static func statusString(_ status: LynxMemoryCollectionStatus) -> String {
        switch status {
        case .completed: return "completed"
        case .timeout: return "timeout"
        @unknown default: return "unknown"
        }
    }

    private static func serializeInstance(_ i: LynxInstanceMemoryUsage) -> [String: Any] {
        [
            // -1 when the instance was never fully attached. Passed through raw
            // and normalized to null in JS, so both platforms agree on the wire.
            "instanceId": Double(i.instanceId),
            "pageId": i.pageId,
            "url": i.url,
            "totalBytes": Double(i.totalBytes),
            "elementBytes": Double(i.elementBytes),
            "elementNodeCount": Double(i.elementNodeCount),
            "viewBytes": Double(i.viewBytes),
            "mainThreadRuntimeBytes": Double(i.mainThreadRuntimeBytes),
            "backgroundThreadRuntimeBytes": Double(i.backgroundThreadRuntimeBytes),
            "btsRuntimeGroupId": i.btsRuntimeGroupId,
            // `viewDetail` is deliberately not serialized — see the README Gotchas.
        ]
    }
}
