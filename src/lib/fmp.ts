import type { Company, PricePoint, Snapshot } from "@/lib/types";
import { getSnapshot } from "@/lib/store";
import { TECH_UNIVERSE } from "@/config/universe";

// Financial Modeling Prep provider, tuned for the current FREE tier.
//
// The free tier has NO batch or screener endpoints (they return HTTP 402) — every
// call is single-symbol — and a ~250 request/day cap. Strategy:
//
//  - Universe is a STATIC curated list (src/config/universe.ts); no screener call.
//  - Each run prices every symbol with one `quote` call -> price, 1-day change,
//    market cap, name. This is the bulk of the budget (~200 calls).
//  - 5d/30d change comes from a rolling price history stored in the snapshot; the
//    quote already gives today's price, so steady-state cost is ~0. New/uncovered
//    symbols are seeded from `historical-price-eod/light` (1 call, full series).
//  - P/E (TTM), revenue, earnings, employees, country/industry/sector, dividend
//    come from `income-statement` + `profile`. These change quarterly/rarely, so we
//    REUSE them from the previous snapshot and only re-fetch a bounded, rotating
//    subset (plus brand-new symbols) each run. EPS is stored and P/E is recomputed
//    from the fresh price every run, so P/E stays current without a daily call.
//  - A daily-budget guard stops issuing calls before the cap, so a run never errors
//    out mid-way; whatever wasn't refreshed this run is reused and picked up next run.

const BASE = process.env.FMP_BASE ?? "https://financialmodelingprep.com/stable";

// Concurrency for single-symbol fetches.
const POOL = 6;
// Rolling history is kept this many days (covers the 30-day lookback + slack).
const HISTORY_DAYS = 45;
// Hard ceiling on FMP calls per run. The free tier is ~250/day; we leave a little
// slack. Quotes are issued first (fresh prices are the priority); the remainder of
// the budget feeds the rotating fundamentals + history backfill.
const DAILY_BUDGET = Number(process.env.FMP_DAILY_BUDGET ?? 245);
// Optional cap on how many universe symbols to process (0 = all). Useful for a
// quick, cheap first look: FMP_UNIVERSE_LIMIT=25 prices only the first 25 symbols.
const UNIVERSE_LIMIT = Number(process.env.FMP_UNIVERSE_LIMIT ?? 0);

export type RefreshOptions = {
  // Max symbols whose income statement (revenue/earnings/EPS) is re-fetched this
  // run. Reuse covers the rest. Use Infinity for a full local backfill.
  maxFundamentalSymbols?: number;
  // Max symbols whose profile (country/industry/sector/employees/dividend) is
  // fetched. These are nearly static, so this is mostly brand-new symbols.
  maxProfileSymbols?: number;
  // Max symbols to seed/repair price history via the historical endpoint.
  maxHistoryBackfill?: number;
  // Forward P/E needs analyst estimates (premium). Off by default.
  fetchEstimates?: boolean;
};

const DEFAULTS: Required<RefreshOptions> = {
  maxFundamentalSymbols: 15,
  maxProfileSymbols: 15,
  maxHistoryBackfill: 15,
  fetchEstimates: process.env.FMP_FETCH_ESTIMATES === "true",
};

function apiKey(): string {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error("FMP_API_KEY is not set");
  return key;
}

// Thrown when the per-run budget is exhausted; callers treat it as "stop this phase
// and reuse prior data" rather than a hard failure.
class BudgetExceeded extends Error {}
let callsThisRun = 0;

async function fmpGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  if (callsThisRun >= DAILY_BUDGET) {
    throw new BudgetExceeded(`FMP daily budget (${DAILY_BUDGET}) reached`);
  }
  callsThisRun++;

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

// Run `fn` over items with bounded concurrency. Stops early (leaving remaining
// items untouched) once the budget is exhausted.
async function mapPool<I>(items: I[], limit: number, fn: (item: I) => Promise<void>): Promise<void> {
  let cursor = 0;
  let stopped = false;
  async function worker() {
    while (cursor < items.length && !stopped) {
      const i = cursor++;
      try {
        await fn(items[i]);
      } catch (err) {
        if (err instanceof BudgetExceeded) {
          stopped = true;
          return;
        }
        throw err;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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

type QuoteRow = {
  symbol: string;
  name?: string;
  price?: number;
  marketCap?: number;
  changePercentage?: number;
};

type HistoryPoint = { date: string; close?: number; price?: number };
type IncomeRow = { revenue?: number; netIncome?: number; eps?: number; epsDiluted?: number };
type ProfileRow = {
  companyName?: string;
  country?: string;
  industry?: string;
  sector?: string;
  fullTimeEmployees?: number | string;
  lastDividend?: number;
};
type EstimateRow = { date: string; epsAvg?: number; estimatedEpsAvg?: number };

// Slowly-changing data reused from the previous snapshot per symbol.
type Fundamentals = {
  revenue: number | null;
  earnings: number | null;
  ttmEps: number | null; // for computing P/E from the fresh price
  forwardPe: number | null;
};
type ProfileInfo = {
  name: string | null;
  country: string | null;
  industry: string | null;
  sector: string | null;
  employees: number | null;
  dividendPerShare: number | null; // annualized
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

// --- Fetchers (all single-symbol on the free tier) -----------------------------

async function fetchQuote(symbol: string): Promise<QuoteRow | undefined> {
  try {
    const rows = await fmpGet<QuoteRow[]>("/quote", { symbol });
    return rows?.[0];
  } catch (err) {
    if (err instanceof BudgetExceeded) throw err;
    // Free tier 402s on symbols outside its whitelist — drop them, don't crash.
    return undefined;
  }
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
      .map((h) => ({ d: h.date, p: (h.price ?? h.close) as number }))
      .filter((pt) => pt.d && Number.isFinite(pt.p))
      .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  } catch (err) {
    if (err instanceof BudgetExceeded) throw err;
    return [];
  }
}

async function fetchIncome(symbol: string, fetchEstimates: boolean, price: number): Promise<Fundamentals | undefined> {
  const income = await fmpGet<IncomeRow[]>("/income-statement", { symbol, period: "annual", limit: 1 })
    .then((rows) => rows?.[0])
    .catch((err) => {
      if (err instanceof BudgetExceeded) throw err;
      return undefined;
    });
  // No data (paywalled/quota/unknown symbol) -> signal failure so the caller keeps
  // the previous snapshot's values instead of overwriting them with nulls.
  if (!income) return undefined;

  let forwardPe: number | null = null;
  if (fetchEstimates) {
    const estimates = await fmpGet<EstimateRow[]>("/analyst-estimates", { symbol, period: "annual", limit: 8 })
      .catch((err) => {
        if (err instanceof BudgetExceeded) throw err;
        return undefined;
      });
    if (estimates && estimates.length) {
      const now = Date.now();
      const future = estimates
        .filter((r) => r.date && new Date(r.date).getTime() >= now)
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const next = future[0] ?? estimates[estimates.length - 1];
      const eps = num(next?.epsAvg ?? next?.estimatedEpsAvg);
      if (eps != null && eps > 0) forwardPe = price / eps;
    }
  }

  return {
    revenue: num(income?.revenue),
    earnings: num(income?.netIncome),
    ttmEps: num(income?.eps ?? income?.epsDiluted),
    forwardPe,
  };
}

async function fetchProfile(symbol: string): Promise<ProfileInfo | undefined> {
  const profile = await fmpGet<ProfileRow[]>("/profile", { symbol })
    .then((rows) => rows?.[0])
    .catch((err) => {
      if (err instanceof BudgetExceeded) throw err;
      return undefined;
    });
  if (!profile) return undefined;
  const lastDiv = num(profile.lastDividend);
  return {
    name: profile.companyName ?? null,
    country: profile.country ?? null,
    industry: profile.industry ?? null,
    sector: profile.sector ?? null,
    employees: num(profile.fullTimeEmployees),
    dividendPerShare: lastDiv != null ? lastDiv * 4 : null, // annualize a quarterly payout (approx.)
  };
}

// --- Orchestration -------------------------------------------------------------

export async function buildSnapshot(options: RefreshOptions = {}): Promise<Snapshot> {
  const opts = { ...DEFAULTS, ...options };
  callsThisRun = 0;

  // Reuse everything we can from the last run.
  const prev = await getSnapshot();
  const prevBySymbol = new Map<string, Company>((prev?.companies ?? []).map((c) => [c.symbol, c]));
  const prevEps: Record<string, number> = prev?.ttmEps ?? {};
  const priceHistory: Record<string, PricePoint[]> = { ...(prev?.priceHistory ?? {}) };

  const symbols = UNIVERSE_LIMIT > 0 ? TECH_UNIVERSE.slice(0, UNIVERSE_LIMIT) : [...TECH_UNIVERSE];

  // Phase 1 (priority): fresh quote for every symbol. Budget guard may cut this
  // short on a constrained day; uncovered symbols fall back to prior price/cap.
  const quotes = new Map<string, QuoteRow>();
  await mapPool(symbols, POOL, async (symbol) => {
    const q = await fetchQuote(symbol);
    if (q) quotes.set(symbol, q);
  });

  const priceOf = (symbol: string): number | null =>
    num(quotes.get(symbol)?.price) ?? (prevBySymbol.get(symbol)?.price ?? null);

  // Phase 2: rotating income-statement refresh. Brand-new / missing symbols first,
  // then a rolling slice of the rest. The cursor rotates across runs.
  const missingFund = symbols.filter((s) => {
    const p = prevBySymbol.get(s);
    return !p || p.revenue == null || p.earnings == null;
  });
  const { items: rolledFund, next: fundCursor } = pickRolling(
    symbols,
    prev?.fundamentalsCursor ?? 0,
    opts.maxFundamentalSymbols,
  );
  const fundList = dedupe([...missingFund, ...rolledFund]).slice(0, opts.maxFundamentalSymbols);
  const freshFund = new Map<string, Fundamentals>();
  await mapPool(fundList, POOL, async (symbol) => {
    const f = await fetchIncome(symbol, opts.fetchEstimates, priceOf(symbol) ?? 0);
    if (f) freshFund.set(symbol, f);
  });

  // Phase 3: profiles for symbols still missing static labels (mostly new symbols),
  // then a small rotating slice to refresh employees/dividend over time.
  const missingProfile = symbols.filter((s) => {
    const p = prevBySymbol.get(s);
    return !p || !p.country || !p.industry;
  });
  const { items: rolledProfile, next: profileCursor } = pickRolling(
    symbols,
    prev?.profileCursor ?? 0,
    opts.maxProfileSymbols,
  );
  const profileList = dedupe([...missingProfile, ...rolledProfile]).slice(0, opts.maxProfileSymbols);
  const freshProfile = new Map<string, ProfileInfo>();
  await mapPool(profileList, POOL, async (symbol) => {
    const info = await fetchProfile(symbol);
    if (info) freshProfile.set(symbol, info);
  });

  // Phase 4: seed/repair rolling price history for uncovered symbols (bounded).
  const historyTargets = symbols
    .filter((s) => !historyCovers(priceHistory[s] ?? [], 30))
    .slice(0, opts.maxHistoryBackfill);
  await mapPool(historyTargets, POOL, async (symbol) => {
    const seeded = await fetchHistorySeries(symbol);
    if (seeded.length) priceHistory[symbol] = seeded;
  });

  // --- Assemble ---------------------------------------------------------------
  const dateStr = today();
  const ttmEps: Record<string, number> = { ...prevEps };
  const companies: Company[] = [];

  for (const symbol of symbols) {
    const quote = quotes.get(symbol);
    const prevC = prevBySymbol.get(symbol);

    const price = priceOf(symbol);
    const marketCap = num(quote?.marketCap) ?? (prevC?.marketCap ?? null);
    if (price == null || marketCap == null) continue; // required fields; reuse handles most

    // Rolling history -> 5d/30d. Only append a fresh quote price (not a reused one).
    let series = priceHistory[symbol] ?? [];
    if (quote && num(quote.price) != null) series = appendPrice(series, dateStr, price);
    priceHistory[symbol] = series;

    // Fundamentals: fresh this run, else reused from the previous snapshot.
    const fund = freshFund.get(symbol);
    const revenue = fund ? fund.revenue : (prevC?.revenue ?? null);
    const earnings = fund ? fund.earnings : (prevC?.earnings ?? null);
    const forwardPe = fund ? fund.forwardPe : (prevC?.forwardPe ?? null);
    const eps = fund?.ttmEps ?? prevEps[symbol] ?? null;
    if (eps != null) ttmEps[symbol] = eps;
    // P/E recomputed from the FRESH price each run (eps changes only quarterly).
    const peRatio = eps != null && eps > 0 ? price / eps : (prevC?.peRatio ?? null);

    // Profile (static labels): fresh this run, else reused.
    const prof = freshProfile.get(symbol);
    const name = prof?.name ?? prevC?.name ?? quote?.name ?? symbol;
    const country = prof?.country ?? prevC?.country ?? "";
    const industry = prof?.industry ?? prevC?.industry ?? "";
    const sector = prof?.sector ?? prevC?.sector ?? "";
    const employees = prof?.employees ?? prevC?.employees ?? null;
    const divPerShare = prof?.dividendPerShare ?? null;
    const dividendYield =
      divPerShare != null ? (divPerShare / price) * 100 : (prevC?.dividendYield ?? null);

    companies.push({
      symbol,
      name,
      logoUrl: logoUrl(symbol),
      country,
      industry,
      sector,
      price,
      marketCap,
      peRatio,
      revenue,
      earnings,
      change1d: num(quote?.changePercentage) ?? (prevC?.change1d ?? null),
      change5d: pctChange(series, 5),
      change30d: pctChange(series, 30),
      forwardPe,
      dividendYield,
      employees,
    });
  }

  // Drop history/eps for symbols no longer in the universe, to keep the store small.
  const live = new Set(symbols);
  for (const key of Object.keys(priceHistory)) if (!live.has(key)) delete priceHistory[key];
  for (const key of Object.keys(ttmEps)) if (!live.has(key)) delete ttmEps[key];

  return {
    companies,
    generatedAt: new Date().toISOString(),
    baseCurrency: "USD",
    priceHistory,
    ttmEps,
    fundamentalsCursor: fundCursor,
    profileCursor,
  };
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
