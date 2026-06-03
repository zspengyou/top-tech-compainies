// Small shared helpers used by the data-provider modules (yahoo.ts, sec.ts,
// snapshot.ts). Kept dependency-free so any provider module can import them.

// Coerce an unknown (string|number|null) into a finite number, else null.
export function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

// Split an array into fixed-size chunks (used for Yahoo's batched quote calls).
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

// Run `fn` over items with bounded concurrency. Errors from `fn` propagate.
export async function mapPool<I>(items: I[], limit: number, fn: (item: I) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Take `count` items from `arr` starting at `start`, wrapping around. Returns the
// items plus the next cursor, so callers rotate through the universe over runs.
export function pickRolling<T>(arr: T[], start: number, count: number): { items: T[]; next: number } {
  const n = arr.length;
  if (n === 0) return { items: [], next: 0 };
  const items: T[] = [];
  let i = ((start % n) + n) % n;
  for (let k = 0; k < Math.min(count, n); k++) {
    items.push(arr[i]);
    i = (i + 1) % n;
  }
  return { items, next: i };
}

export const today = (): string => new Date().toISOString().slice(0, 10);

export function shiftDate(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
