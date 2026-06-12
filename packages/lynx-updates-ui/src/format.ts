/**
 * Small presentation helpers shared by the update components. @internal
 */

import type { DownloadProgress } from '@sigx/lynx-updates';

/**
 * Download progress as 0–100, or null when the server sent no
 * Content-Length (indeterminate).
 */
export function downloadPercent(progress: DownloadProgress | null): number | null {
    if (!progress || progress.totalBytes == null || progress.totalBytes <= 0) return null;
    const pct = (progress.receivedBytes / progress.totalBytes) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
}

/** Human-readable byte count, for indeterminate downloads. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
