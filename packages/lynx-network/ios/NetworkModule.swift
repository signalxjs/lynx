import Foundation
import Network
import Lynx

/// Network connectivity status module.
/// JS usage: NativeModules.Network.getState(callback)
class NetworkModule: NSObject, LynxModule {

    @objc static var name: String { "Network" }

    @objc static var methodLookup: [String: String] {
        [
            "getState": NSStringFromSelector(#selector(getState(_:))),
        ]
    }

    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "com.sigx.lynxgo.network-monitor")
    private var currentPath: NWPath?

    required override init() {
        super.init()
        startMonitor()
    }

    required init(param: Any) {
        super.init()
        startMonitor()
    }

    private func startMonitor() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.currentPath = path
        }
        monitor.start(queue: monitorQueue)
    }

    deinit {
        monitor.cancel()
    }

    @objc func getState(_ callback: LynxCallbackBlock?) {
        let path = currentPath ?? monitor.currentPath

        let isConnected = path.status == .satisfied
        let isExpensive = path.isExpensive

        let type: String
        if path.usesInterfaceType(.wifi) {
            type = "wifi"
        } else if path.usesInterfaceType(.cellular) {
            type = "cellular"
        } else if path.usesInterfaceType(.wiredEthernet) {
            type = "ethernet"
        } else if path.status == .satisfied {
            type = "unknown"
        } else {
            type = "none"
        }

        let result: [String: Any] = [
            "isConnected": isConnected,
            "type": type,
            "isInternetReachable": isConnected,
            "isExpensive": isExpensive,
        ]
        callback?(result)
    }
}
