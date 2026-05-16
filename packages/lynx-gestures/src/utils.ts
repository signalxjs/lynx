// Geometry helpers used by the multi-touch JS-only fallback hooks
// (`usePinch`, `useRotation`). The arena-driven gesture surface
// (`Gesture.*` + `useGestureDetector`) computes its own deltas natively;
// this file is only relevant while the platform's pinch/rotation handlers
// are unfinished.

export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function midpoint(x1: number, y1: number, x2: number, y2: number): [number, number] {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

/** Signed angle in radians from p1 to p2, range (-π, π]. */
export function angle(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/** Shortest signed angular delta between two radians, range (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}
