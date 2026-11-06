// Keep the raw statistical percentile in the snapshot; normalize its UI score here.
export function indexScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.min(99.9, Math.max(0, Math.round(value * 10) / 10));
}
