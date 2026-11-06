
export function hasFullYears(first: string, last: string, years: number): boolean {
  const end = new Date(`${last}T00:00:00Z`);
  const year = end.getUTCFullYear() - years;
  const month = end.getUTCMonth();
  const day = Math.min(end.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return first <= new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function rangePresets(): number[] {
  return [12, 36, 60, 120];
}

export function rangeForMonths(dates: readonly string[], months: number | 'all'): [number, number] {
  const end = Math.max(0, dates.length - 1);
  if (!dates.length || months === 'all') return [0, end];
  const last = new Date(`${dates[end]}T00:00:00Z`);
  const target = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(last.getUTCDate(), lastDay));
  const cutoff = target.toISOString().slice(0, 10);
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid] < cutoff) lo = mid + 1;
    else hi = mid;
  }
  return [Math.min(lo, end), end];
}

export function rangeFromPercent(length: number, start: number, end: number): [number, number] {
  const last = Math.max(0, length - 1);
  const a = Math.round(Math.min(100, Math.max(0, start)) * last / 100);
  const b = Math.round(Math.min(100, Math.max(0, end)) * last / 100);
  return [Math.min(a, b), Math.max(a, b)];
}
