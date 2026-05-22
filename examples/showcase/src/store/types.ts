export interface Coords {
    lat: number;
    lng: number;
}

export interface Entry {
    id: string;
    note: string;
    createdAt: number;
    /** Ordered list of photo URIs for this entry. */
    photoUris?: string[];
    /** GPS fix captured at save time via `@sigx/lynx-location`. Best-effort
     *  — entries can save without coords if permission is denied / timeout. */
    coords?: Coords;
}

export interface Trip {
    id: string;
    name: string;
    entries: Entry[];
    createdAt: number;
}
