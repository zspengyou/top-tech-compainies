import type { Company, PricePoint, Snapshot } from "@/lib/types";
import { getSnapshot } from "@/lib/store";

// Financial Modeling Prep provider, tuned for the FREE tier (250 requests/day).
//
// Strategy to stay under budget:
//  - One screener call seeds the universe (name, marketCap, sector, industry,
//    country, price, dividend).
//  - Quotes are fetched in BATCHES, not per symbol (P/E + 1-day change).
//  - 5d/30d change comes from a rolling price history stored in the snapshot;
//    today's price is already in hand, so steady-state cost is ~0 calls.
//  - Fundamentals (revenue, earnings, employees, forward P/E) change rarely, so
//    we REUSE them from the previous snapshot and only re-fetch a bounded,
//    rotating subset (plus brand-new symbols) each run.
//
// A typical run costs ~screener(1) + quotes(~6) + bounded backfills, well under
// the daily cap.

const BASE = process.env.FMP_BASE ?? "https://financialmodelingprep.com/stable";

// Pull a buffer above TOP_N (200) so each category still has >=200 rows after
// dropping companies missing that metric.
const UNIVERSE_SIZE = 240;

// Batch size for /batch-quote (symbols per request).
const QUOTE_CHUNK = 50;
// Concurrency for the per-symbol backfills.
const POOL = 6;
// Rolling history is kept this many days (covers the 30-day lookback + slack).
const HISTORY_DAYS = 45;

export type RefreshOptions = {
  // Max symbols whose fundamentals (income/profile/estimates) are re-fetched
  // this run. Reuse covers the rest. Use Infinity for a full local backfill.
  maxFundamentalSymbols?: number;
  // Max symbols to seed/repair price history via the historical endpoint.
  maxHistoryBackfill?: number;
  // Forward P/E needs analyst estimates (premium on free tier). Off by default.
  fetchEstimates?: boolean;
};

const DEFAULTS: Required<RefreshOptions> = {
  maxFundamentalSymbols: 50,
  maxHistoryBackfill: 50,
  fetchEstimates: process.env.FMP_FETCH_ESTIMATES === "true",
};

function apiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set");
  return key;
}

async function fmpGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("apikey", apiKey());

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`FMP ${path} -> ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function mapPool<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Take `count` items from `arr` starting at `start`, wrapping around. Returns the
// items plus the next cursor, so callers rotate through the universe over runs.
function pickRolling<T>(arr: T[], start: number, count: number): { items: T[]; next: number } {
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

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function logoUrl(symbol: string): string {
  return `https://images.financialmodelingprep.com/symbol/${symbol}.png`;
}

const today = () => new Date().toISOString().slice(0, 10);
function shiftDate(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// --- Endpoint shapes (only the fields we use) ----------------------------------

type ScreenerRow = {
  symbol: string;
  companyName?: string;
  marketCap?: number;
  sector?: string;
  industry?: string;
  country?: string;
  price?: number;
  lastAnnualDividend?: number;
};

type QuoteRow = {
  symbol: string;
  price?: number;
  marketCap?: number;
  pe?: number;
  changePercentage?: number; // stable
  changesPercentage?: number; // legacy
};

type HistoryPoint = { date: string; close?: number; price?: number };
type IncomeRow = { revenue?: number; netIncome?: number };
type ProfileRow = { fullTimeEmployees?: number | string; lastDiv?: number };
type EstimateRow = { date: string; epsAvg?: number; estimatedEpsAvg?: number };

// What we reuse from the previous snapshot per symbol.
type Fundamentals = {
  revenue: number | null;
  earnings: number | null;
  employees: number | null;
  forwardPe: number | null;
};

// --- Price-history helpers (the rolling 5d/30d source) -------------------------

function appendPrice(series: PricePoint[], date: string, price: number): PricePoint[] {
  const merged = series.filter((pt) => pt.d !== date);
  merged.push({ d: date, p: price });
  merged.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)); // newest-first
  return merged.slice(0, HISTORY_DAYS);
}

// Percent change from the close on-or-before (latest - days) to the latest close.
function pctChange(series: PricePoint[], days: number): number | null {
  if (series.length === 0) return null;
  const latest = series[0];
  const cutoff = shiftDate(latest.d, -days);
  const past = series.find((pt) => pt.d <= cutoff);
  if (!past || !past.p) return null;
  return ((latest.p - past.p) / past.p) * 100;
}

// True once the series reaches back far enough to compute the N-day change.
function historyCovers(series: PricePoint[], days: number): boolean {
  if (series.length === 0) return false;
  const oldest = series[series.length - 1];
  return oldest.d <= shiftDate(series[0].d, -days);
}

// --- Fetchers ------------------------------------------------------------------

async function screenTechUniverse(): Promise<ScreenerRow[]> {
  const rows = await fmpGet<ScreenerRow[]>("/company-screener", {
    sector: "Technology",
    isActivelyTrading: "true",
    isEtf: "false",
    isFund: "false",
    marketCapMoreThan: 1_000_000_000,
    limit: UNIVERSE_SIZE,
  });
  return rows
    .filter((r) => r.symbol)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, UNIVERSE_SIZE);
}

// Batched quotes: one request per QUOTE_CHUNK symbols instead of one per symbol.
async function fetchQuotes(symbols: string[]): Promise<Map<string, QuoteRow>> {
  const map = new Map<string, QuoteRow>();
  for (const group of chunk(symbols, QUOTE_CHUNK)) {
    try {
      const rows = await fmpGet<QuoteRow[]>("/batch-quote", { symbols: group.join(",") });
      for (const r of rows ?? []) if (r.symbol) map.set(r.symbol, r);
    } catch {
      // Skip this chunk; affected symbols fall back to screener price.
    }
  }
  return map;
}

async function fetchHistorySeries(symbol: string): Promise<PricePoint[]> {
  try {
    const from = shiftDate(today(), -HISTORY_DAYS);
    const raw = await fmpGet<HistoryPoint[] | { historical?: HistoryPoint[] }>(
      "/historical-price-eod/light",
      { symbol, from, to: today() },
    );
    const history = Array.isArray(raw) ? raw : (raw.historical ?? []);
    return history
      .map((h) => ({ d: h.date, p: (h.close ?? h.price) as number }))
      .filter((pt) => pt.d && Number.isFinite(pt.p))
      .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  } catch {
    return [];
  }
}

async function fetchFundamentals(symbol: string, price: number, fetchEstimates: boolean): Promise<Fundamentals> {
  const incomeP = fmpGet<IncomeRow[]>("/income-statement", { symbol, period: "annual", limit: 1 })
    .then((rows) => rows?.[0])
    .catch(() => undefined);
  const profileP = fmpGet<ProfileRow[]>("/profile", { symbol })
    .then((rows) => rows?.[0])
    .catch(() => undefined);
  const estimatesP = fetchEstimates
    ? fmpGet<EstimateRow[]>("/analyst-estimates", { symbol, period: "annual", limit: 8 })
        .then((rows) => rows)
        .catch(() => undefined)
    : Promise.resolve(undefined);

  const [income, profile, estimates] = await Promise.all([incomeP, profileP, estimatesP]);

  let forwardPe: number | null = null;
  if (estimates && estimates.length) {
    const now = Date.now();
    const future = estimates
      .filter((r) => r.date && new Date(r.date).getTime() >= now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const next = future[0] ?? estimates[estimates.length - 1];
    const eps = num(next?.epsAvg ?? next?.estimatedEpsAvg);
    if (eps != null && eps > 0) forwardPe = price / eps;
  }

  return {
    revenue: num(income?.revenue),
    earnings: num(income?.netIncome),
    employees: num(profile?.fullTimeEmployees),
    forwardPe,
  };
}

// --- Orchestration -------------------------------------------------------------

export async function buildSnapshot(options: RefreshOptions = {}): Promise<Snapshot> {
  const opts = { ...DEFAULTS, ...options };

  // Reuse everything we can from the last run.
  const prev = await getSnapshot();
  const prevBySymbol = new Map<string, Company>((prev?.companies ?? []).map((c) => [c.symbol, c]));
  const priceHistory: Record<string, PricePoint[]> = { ...(prev?.priceHistory ?? {}) };

  // Cheap, every run: universe + batched quotes.
  const universe = await screenTechUniverse();
  const symbols = universe.map((r) => r.symbol);
  const quotes = await fetchQuotes(symbols);

  // Decide which symbols re-fetch fundamentals this run: brand-new symbols first,
  // then a rotating slice of the rest (bounded by budget). The rest are reused.
  const missing = symbols.filter((s) => {
    const p = prevBySymbol.get(s);
    return !p || p.revenue == null || p.earnings == null;
  });
  const { items: rolled, next } = pickRolling(
    symbols,
    prev?.fundamentalsCursor ?? 0,
    opts.maxFundamentalSymbols,
  );
  const fundamentalTargets = new Set<string>(missing);
  for (const s of rolled) fundamentalTargets.add(s);
  const fundamentalList = [...fundamentalTargets].slice(0, opts.maxFundamentalSymbols);

  // Decide which symbols need price-history seeding/repair (bounded).
  const historyTargets = symbols
    .filter((s) => !historyCovers(priceHistory[s] ?? [], 30))
    .slice(0, opts.maxHistoryBackfill);

  // Resolve price now (needed for forward P/E + history append) for every symbol.
  const priceOf = (row: ScreenerRow) =>
    num(quotes.get(row.symbol)?.price) ?? num(row.price);

  // Backfill the bounded subsets concurrently.
  const fundamentalsBySymbol = new Map<string, Fundamentals>();
  await mapPool(fundamentalList, POOL, async (symbol) => {
    const row = universe.find((r) => r.symbol === symbol)!;
    const price = priceOf(row) ?? 0;
    fundamentalsBySymbol.set(symbol, await fetchFundamentals(symbol, price, opts.fetchEstimates));
  });
  await mapPool(historyTargets, POOL, async (symbol) => {
    const seeded = await fetchHistorySeries(symbol);
    if (seeded.length) priceHistory[symbol] = seeded;
  });

  const dateStr = today();
  const companies: Company[] = [];
  for (const row of universe) {
    const symbol = row.symbol;
    const quote = quotes.get(symbol);
    const prevC = prevBySymbol.get(symbol);

    const price = priceOf(row);
    const marketCap = num(quote?.marketCap) ?? num(row.marketCap);
    if (price == null || marketCap == null) continue; // required fields

    // Append today's price to the rolling history, then derive 5d/30d.
    const series = appendPrice(priceHistory[symbol] ?? [], dateStr, price);
    priceHistory[symbol] = series;

    // Fundamentals: freshly fetched this run, else reused from the last snapshot.
    const fresh = fundamentalsBySymbol.get(symbol);
    const revenue = fresh ? fresh.revenue : (prevC?.revenue ?? null);
    const earnings = fresh ? fresh.earnings : (prevC?.earnings ?? null);
    const employees = fresh ? fresh.employees : (prevC?.employees ?? null);
    const forwardPe = fresh ? fresh.forwardPe : (prevC?.forwardPe ?? null);

    // Dividend yield straight from the screener (no extra call).
    const lastDiv = num(row.lastAnnualDividend);
    const dividendYield = lastDiv != null ? (lastDiv / price) * 100 : (prevC?.dividendYield ?? null);

    companies.push({
      symbol,
      name: row.companyName ?? prevC?.name ?? symbol,
      logoUrl: logoUrl(symbol),
      country: row.country ?? prevC?.country ?? "",
      industry: row.industry ?? prevC?.industry ?? "",
      sector: row.sector ?? prevC?.sector ?? "",
      price,
      marketCap,
      peRatio: num(quote?.pe) ?? (prevC?.peRatio ?? null),
      revenue,
      earnings,
      change1d: num(quote?.changePercentage ?? quote?.changesPercentage),
      change5d: pctChange(series, 5),
      change30d: pctChange(series, 30),
      forwardPe,
      dividendYield,
      employees,
    });
  }

  // Drop history for symbols that left the universe, to keep the store small.
  const live = new Set(symbols);
  for (const key of Object.keys(priceHistory)) if (!live.has(key)) delete priceHistory[key];

  return {
    companies,
    generatedAt: new Date().toISOString(),
    baseCurrency: "USD",
    priceHistory,
    fundamentalsCursor: next,
  };
}
