/**
 * Unit tests for the Map JS surface. Native side (MKMapView / Google Maps)
 * is exercised on-device — this only covers the type augmentation and the
 * thin Lynx component wrappers.
 */
import { describe, expect, it } from 'vitest';
import '../src/jsx-augment.js';
import type {
    SigxMapAttributes,
    SigxMapMarkerAttributes,
    MapRegionChangeEvent,
    MapPressEvent,
    MapMarkerPressEvent,
} from '../src/jsx-augment.js';

describe('jsx-augment', () => {
    it('SigxMapAttributes accepts the documented prop shape', () => {
        const attrs: SigxMapAttributes = {
            region: JSON.stringify({
                latitude: 59.3293,
                longitude: 18.0686,
                latitudeDelta: 0.1,
                longitudeDelta: 0.1,
            }),
            'shows-user-location': true,
            'map-type': 'hybrid',
            bindregionchange: (e) => { void e.detail.region.latitude; },
            bindpress: (e) => { void e.detail.coordinate.latitude; },
            bindmarkerpress: (e) => { void e.detail.id; },
        };
        expect(attrs['shows-user-location']).toBe(true);
        expect(attrs['map-type']).toBe('hybrid');
    });

    it('SigxMapMarkerAttributes accepts the documented prop shape', () => {
        const attrs: SigxMapMarkerAttributes = {
            coordinate: JSON.stringify({ latitude: 0, longitude: 0 }),
            title: 'Hi',
            description: 'There',
            'marker-id': 'm1',
        };
        expect(attrs.title).toBe('Hi');
        expect(attrs['marker-id']).toBe('m1');
    });

    it('event detail shapes match the native wire format', () => {
        const rc: MapRegionChangeEvent = {
            type: 'regionchange',
            detail: {
                region: {
                    latitude: 1,
                    longitude: 2,
                    latitudeDelta: 0.1,
                    longitudeDelta: 0.1,
                },
            },
        };
        const press: MapPressEvent = {
            type: 'press',
            detail: { coordinate: { latitude: 1, longitude: 2 } },
        };
        const mp: MapMarkerPressEvent = {
            type: 'markerpress',
            detail: { id: 'x', coordinate: { latitude: 1, longitude: 2 } },
        };
        expect(rc.detail.region.latitudeDelta).toBe(0.1);
        expect(press.detail.coordinate.longitude).toBe(2);
        expect(mp.detail.id).toBe('x');
    });

    it('declares <sigx-map> and <sigx-map-marker> on the global JSX namespace', () => {
        // Use the augmented tags inside JSX. The point of this test is the
        // typecheck — if the global `JSX.IntrinsicElements` augmentation
        // isn't present, `tsgo` (and CI's tsc) fail to compile this file.
        const node = (
            <sigx-map
                region={JSON.stringify({
                    latitude: 0,
                    longitude: 0,
                    latitudeDelta: 1,
                    longitudeDelta: 1,
                })}
                shows-user-location={true}
                map-type="standard"
                bindregionchange={(e) => void e.detail.region}
                bindpress={(e) => void e.detail.coordinate}
                bindmarkerpress={(e) => void e.detail.id}
            >
                <sigx-map-marker
                    coordinate={JSON.stringify({ latitude: 0, longitude: 0 })}
                    title="t"
                    description="d"
                    marker-id="m"
                />
            </sigx-map>
        );
        expect(node).toBeDefined();
    });
});
