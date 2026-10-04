// Days for launch metrics are UTC calendar days, written "2026-10-13".
const DAY_MS = 24 * 60 * 60 * 1000;

export const METRIC_KEYS = [
  "members",
  "generators",
  "batches",
  "designs",
  "publishedWorks",
  "remixes",
  "families",
  "creditsUsed",
  "modelPhotos",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
export type MetricCounts = Record<MetricKey, number>;

// The most days the metrics page shows or one recount covers.
export const MAX_METRIC_DAYS = 90;

export function zeroCounts(): MetricCounts {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as MetricCounts;
}

export function addCounts(a: MetricCounts, b: Partial<MetricCounts>): MetricCounts {
  const sum = { ...a };
  for (const key of METRIC_KEYS) sum[key] += b[key] ?? 0;
  return sum;
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && utcDay(Date.parse(`${value}T00:00:00Z`)) === value;
}

// [start, end) in milliseconds.
export function dayRange(day: string): { start: number; end: number } {
  const start = Date.parse(`${day}T00:00:00Z`);
  return { start, end: start + DAY_MS };
}

// The last `count` days ending with the day of `now`, oldest first.
export function recentDays(now: number, count: number): Array<string> {
  const today = dayRange(utcDay(now)).start;
  const days: Array<string> = [];
  for (let back = count - 1; back >= 0; back--) days.push(utcDay(today - back * DAY_MS));
  return days;
}
