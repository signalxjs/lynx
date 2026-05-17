import { signal, toRaw, watch } from '@sigx/lynx';
import { Storage } from '@sigx/lynx-storage';
import type { Coords, Entry, Trip } from './types.js';

const STORAGE_KEY = 'showcase:trips/v1';

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const seed: Trip[] = [
    {
        id: 'lisbon-2026',
        name: 'Lisbon, May 2026',
        createdAt: Date.now() - 86_400_000 * 3,
        entries: [
            {
                id: 'e1',
                note: 'Arrived at the Alfama',
                createdAt: Date.now() - 86_400_000 * 2,
                coords: { lat: 38.7129, lng: -9.1290 },
            },
        ],
    },
    {
        id: 'kyoto-2025',
        name: 'Kyoto, autumn 2025',
        createdAt: Date.now() - 86_400_000 * 30,
        entries: [],
    },
];

export const trips = signal<Trip[]>(seed);

// `hydrated` gates the persist watcher — without it, the watch callback
// would write the seed back over a (possibly empty) snapshot before we've
// had a chance to read it. Set in `.finally` so a Storage rejection
// (module missing, native error) still unlocks persistence on subsequent
// edits — failing to read shouldn't permanently disable writes.
let hydrated = false;
Storage.getItem(STORAGE_KEY)
    .then((raw) => {
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw) as Trip[];
            if (Array.isArray(parsed)) trips.$set(parsed);
        } catch {
            // Corrupted snapshot — keep the seed, log nothing (dev noise).
        }
    })
    .finally(() => {
        hydrated = true;
    });

// Persist on every change. `deep: true` makes the watcher re-fire on
// nested mutations (e.g. `trip.entries.push(entry)`), not just on
// `trips.$set(...)`. JSON-serializing `toRaw(trips)` unwraps the
// reactive proxy so we don't ship `Proxy` plumbing into storage.
watch(
    () => trips,
    () => {
        if (!hydrated) return;
        try {
            Storage.setItem(STORAGE_KEY, JSON.stringify(toRaw(trips)));
        } catch {
            // Best-effort persistence — never throw out of a reactive
            // callback. Worst case: this app launch's edits don't survive.
        }
    },
    { deep: true },
);

export function getTrip(id: string): Trip | undefined {
    return trips.find((t) => t.id === id);
}

export function addTrip(name: string): Trip {
    const trip: Trip = { id: newId(), name, entries: [], createdAt: Date.now() };
    trips.unshift(trip);
    return trip;
}

export function addEntry(
    tripId: string,
    note: string,
    options?: { photoUri?: string; coords?: Coords },
): Entry | null {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return null;
    const entry: Entry = {
        id: newId(),
        note,
        createdAt: Date.now(),
        photoUri: options?.photoUri,
        coords: options?.coords,
    };
    trip.entries.push(entry);
    return entry;
}

export function deleteEntry(tripId: string, entryId: string): void {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const idx = trip.entries.findIndex((e) => e.id === entryId);
    if (idx >= 0) trip.entries.splice(idx, 1);
}

export function getEntry(tripId: string, entryId: string): Entry | undefined {
    return trips.find((t) => t.id === tripId)?.entries.find((e) => e.id === entryId);
}

export function updateEntry(
    tripId: string,
    entryId: string,
    patch: { note?: string; photoUri?: string | null; coords?: Coords | null },
): void {
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) return;
    const entry = trip.entries.find((e) => e.id === entryId);
    if (!entry) return;
    if (patch.note !== undefined) entry.note = patch.note;
    if (patch.photoUri !== undefined) {
        entry.photoUri = patch.photoUri ?? undefined;
    }
    if (patch.coords !== undefined) {
        entry.coords = patch.coords ?? undefined;
    }
}

/** Wipe all persisted state. Settings → "Clear all data" calls this. */
export function clearAllTrips(): void {
    trips.$set([]);
    // No `await` — Storage.removeItem is sync (fire-and-forget).
    Storage.removeItem(STORAGE_KEY);
}
