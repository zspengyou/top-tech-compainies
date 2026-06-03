// Snapshot builder — orchestrates the Yahoo + SEC providers into the stored
// Company[] that the pages render. Free, keyless.
//
//  - Yahoo quote (batched) prices EVERY symbol each run -> price, market cap (the
//    primary ranking, ADR-correct), 1-day change, trailing & forward P/E, dividend.
//  - 5d/30d change come from a rolling price history kept in the snapshot; today's
//    price is appended from the quote, so steady-state cost is ~0. New/uncovered
//    symbols are seeded from Yahoo's chart endpoint (bounded backfill).
//  - Revenue & earnings (SEC) and country/sector/industry/employees (Yahoo profile)
//    change rarely, so they're REUSED from the previous snapshot; only brand-new
//    symbols plus a small rotating slice are re-fetched each run.

import type { Company, PricePoint, Snapshot } from "@/lib/types";
import { getSnapshot } from "@/lib/store";
import { EXTRA_TICKERS, SEED_UNIVERSE, TECH_SCREEN, UNIVERSE_SIZE } from "@/config/universe";
import { dedupe, mapPool, num, pickRolling, shiftDate, today } from "@/lib/util";
import {
  fetchHistory,
  fetchProfile,
  fetchQuotes,
  fetchTechUniverse,
  type YahooProfile,
} from "@/lib/yahoo";
import { fetchFundamentals, type SecFundamentals } from "@/lib/sec";

// Concurrency for per-symbol fetches (Yahoo chart / profile, SEC facts). Kept modest
// to stay polite and avoid Yahoo throttling.
const POOL = 6;
// Rolling history kept this many days (covers the 30-day lookback + slack).
const HISTORY_DAYS = 45;

export type RefreshOptions = {
  // Max symbols whose SEC fundamentals (revenue/earnings) are re-fetched this run.
  maxFundamentalSymbols?: number;
  // Max symbols whose Yahoo profile (country/sector/industry/employees) is fetched.
  maxProfileSymbols?: number;
  // Max symbols to seed/repair price history via Yahoo's chart endpoint.
  maxHistoryBackfill?: number;
};

const DEFAULTS: Required<RefreshOptions> = {
  maxFundamentalSymbols: 25,
  maxProfileSymbols: 25,
  maxHistoryBackfill: 30,
};

function logoUrl(symbol: string): string {
  return `https://images.financialmodelingprep.com/symbol/${symbol}.png`;
}

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

// --- Orchestration -------------------------------------------------------------

export async function buildSnapshot(options: RefreshOptions = {}): Promise<Snapshot> {
  const opts = { ...DEFAULTS, ...options };

  // Reuse everything we can from the last run.
  const prev = await getSnapshot();
  const prevBySymbol = new Map<string, Company>((prev?.companies ?? []).map((c) => [c.symbol, c]));
  const priceHistory: Record<string, PricePoint[]> = { ...(prev?.priceHistory ?? {}) };

  // Discover the universe dynamically (top by market cap). If the screener is
  // unavailable, fall back to the previous snapshot's symbols so the site doesn't
  // shrink; on a cold start with neither, use the small static seed.
  const discovered = await fetchTechUniverse(TECH_SCREEN, UNIVERSE_SIZE);
  const base =
    discovered.length >= 20
      ? discovered
      : prev && prev.companies.length > 0
        ? prev.companies.map((c) => c.symbol)
        : SEED_UNIVERSE;
  const symbols = dedupe([...base, ...EXTRA_TICKERS]);

  // Phase 1 (priority): batched Yahoo quotes for every symbol.
  const quotes = await fetchQuotes(symbols);

  // Phase 2: SEC fundamentals — brand-new/missing symbols first, then a rolling slice.
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
  const freshFund = new Map<string, SecFundamentals>();
  await mapPool(fundList, POOL, async (symbol) => {
    const f = await fetchFundamentals(symbol);
    if (f) freshFund.set(symbol, f); // undefined = fetch failed -> keep prior values
  });

  // Phase 3: Yahoo profiles — symbols still missing labels first, then a rolling slice.
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
  const freshProfile = new Map<string, YahooProfile>();
  await mapPool(profileList, POOL, async (symbol) => {
    const info = await fetchProfile(symbol);
    if (info) freshProfile.set(symbol, info);
  });

  // Phase 4: seed/repair rolling price history for uncovered symbols (bounded).
  const historyTargets = symbols
    .filter((s) => !historyCovers(priceHistory[s] ?? [], 30))
    .slice(0, opts.maxHistoryBackfill);
  await mapPool(historyTargets, POOL, async (symbol) => {
    const seeded = await fetchHistory(symbol);
    if (seeded.length) priceHistory[symbol] = seeded;
  });

  // --- Assemble ---------------------------------------------------------------
  const dateStr = today();
  const companies: Company[] = [];

  for (const symbol of symbols) {
    const quote = quotes.get(symbol);
    const prevC = prevBySymbol.get(symbol);

    const price = quote?.price ?? prevC?.price ?? null;
    const marketCap = quote?.marketCap ?? prevC?.marketCap ?? null;
    if (price == null || marketCap == null) continue; // required fields

    // Rolling history -> 5d/30d. Only append a fresh quote price (not a reused one).
    let series = priceHistory[symbol] ?? [];
    if (quote?.price != null) series = appendPrice(series, dateStr, price);
    priceHistory[symbol] = series;

    // Fundamentals (SEC): fresh this run, else reused.
    const fund = freshFund.get(symbol);
    const revenue = fund ? fund.revenue : (prevC?.revenue ?? null);
    const earnings = fund ? fund.earnings : (prevC?.earnings ?? null);

    // Profile (Yahoo): fresh this run, else reused.
    const prof = freshProfile.get(symbol);
    const country = prof?.country ?? prevC?.country ?? "";
    const industry = prof?.industry ?? prevC?.industry ?? "";
    const sector = prof?.sector ?? prevC?.sector ?? "";
    const employees = prof?.employees ?? prevC?.employees ?? null;

    companies.push({
      symbol,
      name: quote?.name ?? prevC?.name ?? symbol,
      logoUrl: logoUrl(symbol),
      country,
      industry,
      sector,
      price,
      marketCap,
      peRatio: quote?.peRatio ?? prevC?.peRatio ?? null,
      revenue,
      earnings,
      change1d: quote?.change1d ?? prevC?.change1d ?? null,
      change5d: pctChange(series, 5),
      change30d: pctChange(series, 30),
      forwardPe: quote?.forwardPe ?? prevC?.forwardPe ?? null,
      dividendYield: quote?.dividendYield ?? prevC?.dividendYield ?? null,
      employees,
    });
  }

  // Drop history for symbols no longer in the universe, to keep the store small.
  const live = new Set(symbols);
  for (const key of Object.keys(priceHistory)) if (!live.has(key)) delete priceHistory[key];

  return {
    companies,
    generatedAt: new Date().toISOString(),
    baseCurrency: "USD",
    priceHistory,
    fundamentalsCursor: fundCursor,
    profileCursor,
  };
}
