import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Map as MapView, MapMarker } from '@sigx/lynx-maps';
import { Card, Center, Col, Heading, Text } from '@sigx/lynx-daisyui';
import { trips } from '../store/trips.js';

interface GeotaggedRow {
    tripName: string;
    note: string;
    lat: number;
    lng: number;
    createdAt: number;
}

/**
 * Flatten every trip's geotagged entries into a single list, sorted newest
 * first. Uses `.flatMap` + `.filter` rather than `for…of` because the @sigx
 * reactivity proxy's `Symbol.iterator` behaviour is inconsistent — array
 * methods reliably track reads.
 */
function getGeotaggedEntries(): GeotaggedRow[] {
    return trips
        .flatMap((trip) =>
            trip.entries
                .filter((e): e is typeof e & { coords: NonNullable<typeof e.coords> } => e.coords != null)
                .map((e) => ({
                    tripName: trip.name,
                    note: e.note,
                    lat: e.coords.lat,
                    lng: e.coords.lng,
                    createdAt: e.createdAt,
                })),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Compute a region centred on the entries' bounding box, with ~30% padding
 * so edge markers aren't clipped. Quick-and-dirty alternative to
 * `MKMapView.showAnnotations` / `LatLngBounds.builder()` which need an
 * imperative method (deferred to v2).
 */
function regionFor(rows: GeotaggedRow[]) {
    if (rows.length === 0) {
        // Default to roughly central Europe; the empty-state overlay
        // covers the map so the user never actually sees this.
        return { latitude: 50, longitude: 10, latitudeDelta: 60, longitudeDelta: 80 };
    }
    const lats = rows.map((r) => r.lat);
    const lngs = rows.map((r) => r.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
        latitude: (minLat + maxLat) / 2,
        longitude: (minLng + maxLng) / 2,
        latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.3),
        longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.3),
    };
}

export const Map = component(() => {
    const selectedId = signal<string | null>(null);

    return () => {
        // Touch the proxy here so the screen re-renders when new
        // geotagged entries are added.
        const rows = getGeotaggedEntries();

        if (rows.length === 0) {
            return (
                <Center flex={1} class="bg-base-100 p-6">
                    <Screen headerShown={false} />
                    <Col gap={8} align="center">
                        <Heading level={2}>Map</Heading>
                        <Text class="opacity-60">No geotagged entries yet</Text>
                        <Text class="opacity-60 text-sm">
                            Add an entry to a trip — its GPS coords show up here.
                        </Text>
                    </Col>
                </Center>
            );
        }

        const region = regionFor(rows);
        const selected = rows.find((r) => `${r.createdAt}` === selectedId.value);

        return (
            <view class="flex-fill bg-base-100">
                <Screen headerShown={false} />
                <MapView
                    region={region}
                    showsUserLocation
                    class="flex-1"
                    onMarkerPress={(e) => {
                        selectedId.value = e.detail.id;
                    }}
                    onPress={() => {
                        selectedId.value = null;
                    }}
                >
                    {rows.map((r) => (
                        <MapMarker
                            id={`${r.createdAt}`}
                            coordinate={{ latitude: r.lat, longitude: r.lng }}
                            title={r.tripName}
                            description={r.note}
                        />
                    ))}
                </MapView>
                {selected && (
                    <view class="absolute bottom-4 left-4 right-4">
                        <Card bordered>
                            <Card.Body>
                                <Text weight="semibold">{selected.tripName}</Text>
                                <Text>{selected.note}</Text>
                                <Text class="opacity-60 text-sm">
                                    {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                                </Text>
                            </Card.Body>
                        </Card>
                    </view>
                )}
            </view>
        );
    };
});
