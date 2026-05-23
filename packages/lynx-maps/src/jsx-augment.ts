/**
 * JSX intrinsic type augmentation for `<sigx-map>` and `<sigx-map-marker>`.
 *
 * Importing this module registers both tags on `JSX.IntrinsicElements` with
 * the prop + event surface implemented by `SigxMapUI` / `SigxMapMarkerUI`
 * (iOS) and the same-named Kotlin classes (Android). Pulled in automatically
 * by `@sigx/lynx-maps`'s entry point so consumers do not need to import it
 * directly.
 *
 * Element availability requires `sigx prebuild` to have run after adding
 * this package as a dependency — the autolinker emits the `LynxConfig`
 * registration (iOS) and `Behavior` attachment (Android) that bind the tags
 * to the native UI classes.
 */
import type { LynxCommonAttributes, LynxEventHandler } from '@sigx/lynx-runtime';

/**
 * A rectangular region of the map. `latitudeDelta` / `longitudeDelta` define
 * the span (in degrees) visible above/below and left/right of `latitude` /
 * `longitude`. Matches the react-native-maps `Region` shape so docs and
 * coordinate utilities translate cleanly.
 */
export interface MapRegion {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
}

export interface MapCoordinate {
    latitude: number;
    longitude: number;
}

export type MapType = 'standard' | 'satellite' | 'hybrid';

export interface MapRegionChangeEventDetail {
    region: MapRegion;
    [k: string]: unknown;
}
export interface MapRegionChangeEvent {
    type: 'regionchange';
    detail: MapRegionChangeEventDetail;
}

export interface MapPressEventDetail {
    coordinate: MapCoordinate;
    [k: string]: unknown;
}
export interface MapPressEvent {
    type: 'press';
    detail: MapPressEventDetail;
}

export interface MapMarkerPressEventDetail {
    /** Marker's `marker-id` prop, or empty string if none was set. */
    id: string;
    coordinate: MapCoordinate;
    [k: string]: unknown;
}
export interface MapMarkerPressEvent {
    type: 'markerpress';
    detail: MapMarkerPressEventDetail;
}

export interface SigxMapAttributes extends LynxCommonAttributes {
    /**
     * Visible region. The map snaps to this on every prop change, so
     * authors who only want to set an *initial* region should pass it once
     * and avoid re-passing it on every render (use local state).
     *
     * Serialised as a JSON string on the wire — the native side parses it
     * back into a region struct. Lynx props don't support object types
     * directly today, so JSON-on-the-wire is the standard sigx-lynx idiom.
     */
    region?: string;
    /** Show the user's current location dot. Requires location permission. */
    'shows-user-location'?: boolean;
    /** Base map style. */
    'map-type'?: MapType;
    /** Visible region changed (either programmatic or user pan/zoom). */
    bindregionchange?: LynxEventHandler<MapRegionChangeEvent>;
    /** User tapped the map (not on a marker). */
    bindpress?: LynxEventHandler<MapPressEvent>;
    /** User tapped a marker. */
    bindmarkerpress?: LynxEventHandler<MapMarkerPressEvent>;
    children?: unknown;
}

export interface SigxMapMarkerAttributes extends LynxCommonAttributes {
    /**
     * Marker location. JSON-stringified `{ "latitude": …, "longitude": … }`
     * for the same reason as `region` on `<sigx-map>` — Lynx props don't
     * support nested objects directly.
     */
    coordinate?: string;
    /** Callout title shown on tap. */
    title?: string;
    /** Callout subtitle shown below the title. */
    description?: string;
    /**
     * Stable identifier surfaced as `event.detail.id` in `bindmarkerpress`.
     * Useful when many markers share the same coordinate (e.g. clustered
     * entries) and the press handler needs to disambiguate.
     */
    'marker-id'?: string;
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'sigx-map': SigxMapAttributes;
            'sigx-map-marker': SigxMapMarkerAttributes;
        }
    }
}

export {};
