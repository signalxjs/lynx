import Foundation
import CoreLocation
import Lynx

/// Location services module using CLLocationManager.
/// JS usage: NativeModules.Location.getCurrentPosition(options, callback)
class LocationModule: NSObject, LynxModule, CLLocationManagerDelegate {

    @objc static var name: String { "Location" }

    @objc static var methodLookup: [String: String] {
        [
            "getCurrentPosition": NSStringFromSelector(#selector(getCurrentPosition(_:callback:))),
            "requestPermission": NSStringFromSelector(#selector(requestPermission(_:))),
            "getPermissionStatus": NSStringFromSelector(#selector(getPermissionStatus(_:))),
        ]
    }

    private lazy var locationManager: CLLocationManager = {
        let manager = CLLocationManager()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        return manager
    }()

    private var pendingCallback: LynxCallbackBlock?

    required override init() { super.init() }
    required init(param: Any) { super.init() }

    @objc func getCurrentPosition(_ options: [String: Any]?, callback: LynxCallbackBlock?) {
        let status = locationManager.authorizationStatus

        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            callback?(["error": "Location permission not granted"])
            return
        }

        if let location = locationManager.location {
            callback?(locationDict(from: location))
            return
        }

        pendingCallback = callback
        locationManager.requestLocation()
    }

    @objc func requestPermission(_ callback: LynxCallbackBlock?) {
        let status = locationManager.authorizationStatus
        if status == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
            callback?(["status": "requesting"])
        } else {
            callback?(["status": permissionString(for: status)])
        }
    }

    @objc func getPermissionStatus(_ callback: LynxCallbackBlock?) {
        let status = locationManager.authorizationStatus
        callback?(["status": permissionString(for: status)])
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, let callback = pendingCallback else { return }
        pendingCallback = nil
        callback(locationDict(from: location))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard let callback = pendingCallback else { return }
        pendingCallback = nil
        callback(["error": error.localizedDescription])
    }

    private func locationDict(from location: CLLocation) -> [String: Any] {
        [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "altitude": location.altitude,
            "accuracy": location.horizontalAccuracy,
            "speed": location.speed,
            "heading": location.course,
            "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
        ]
    }

    private func permissionString(for status: CLAuthorizationStatus) -> String {
        switch status {
        case .notDetermined:       return "undetermined"
        case .restricted:          return "restricted"
        case .denied:              return "denied"
        case .authorizedAlways:    return "granted"
        case .authorizedWhenInUse: return "granted"
        @unknown default:          return "unknown"
        }
    }
}
