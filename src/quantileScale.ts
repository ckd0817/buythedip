export const keyPercentiles = [10, 25, 50, 75, 90, 95, 99];

/** A segmented scale whose labelled stops share the value-grid centres. */
export function quantileScalePosition(value: number): number {
  const points = [
    { percentile: 0, position: 0 },
    ...keyPercentiles.map((percentile, index) => ({ percentile, position: (index + .5) / keyPercentiles.length * 100 })),
    { percentile: 100, position: 100 },
  ];
  const percentile = Math.min(100, Math.max(0, value));
  const right = points.findIndex(point => point.percentile >= percentile);
  if (right <= 0) return 0;
  const a = points[right - 1], b = points[right];
  return a.position + (b.position - a.position) * (percentile - a.percentile) / (b.percentile - a.percentile);
}
