// Yahoo Finance provider — keyless. Supplies all the market data:
//   - quote      (batched): price, market cap, 1-day change, trailing & forward P/E,
//                 dividend yield. Market cap here is ADR-correct for foreign listings,
//                 which is why we prefer it over deriving cap from SEC shares × price.
//   - chart v8   (per symbol): daily close series, used to compute 5d/30d change.
//   - quoteSummary (per symbol): country, sector, industry, employees.
//
// The quote / quoteSummary endpoints require a cookie + "crumb" handshake. These are
// UNOFFICIAL endpoints (no SLA) so every call is best-effort: failures return
// undefined/empty and the caller reuses the previous snapshot's values.

import type { PricePoint } from "@/lib/types";
import { chunk, num, shiftDate, today } from "@/lib/util";

const UA = "Mozilla/5.0";
const Q1 = "https://query1.finance.yahoo.com";

// --- Public shapes -------------------------------------------------------------

export type YahooQuote = {
  price: number | null;
  marketCap: number | null;
  change1d: number | null; // percent
  peRatio: number | null; // trailing
  forwardPe: number | null;
  dividendYield: number | null; // percent
  name: string | null;
};

export type YahooProfile = {
  country: string | null;
  sector: string | null;
  industry: string | null;
  employees: number | null;
};

// --- Cookie + crumb session (cached for the process) ---------------------------

let session: { cookie: string; crumb: string } | null = null;

async function getSession(): Promise<{ cookie: string; crumb: string } | null> {
  if (session) return session;
  try {
    // fc.yahoo.com hands out the consent cookie without the giant headers the
    // www homepage sends (which overflow Node's header parser).
    const r1 = await fetch("https://fc.yahoo.com/", {
      headers: { "User-Agent": UA },
      redirect: "manual",
    }).catch(() => null);
    const cookie = (r1?.headers?.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) return null;
    const r2 = await fetch(`${Q1}/v1/test/getcrumb`, {
      headers: { "User-Agent": UA, Cookie: cookie },
    });
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.length > 64) return null; // a real crumb is short
    session = { cookie, crumb };
    return session;
  } catch {
    return null;
  }
}

// --- Quotes (batched) ----------------------------------------------------------

type RawQuote = {
  symbol: string;
  regularMarketPrice?: number;
  marketCap?: number;
  regularMarketChangePercent?: number;
  trailingPE?: number;
  forwardPE?: number;
  trailingAnnualDividendYield?: number; // fraction, e.g. 0.0055
  longName?: string;
  shortName?: string;
};

// Fetch quotes for many symbols. Returns a map; missing/failed symbols are absent.
export async function fetchQuotes(symbols: string[]): Promise<Map<string, YahooQuote>> {
  const out = new Map<string, YahooQuote>();
  const sess = await getSession();
  if (!sess) return out;

  for (const group of chunk(symbols, 50)) {
    const url =
      `${Q1}/v7/finance/quote?symbols=${encodeURIComponent(group.join(","))}` +
      `&crumb=${encodeURIComponent(sess.crumb)}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: sess.cookie } });
      if (!res.ok) continue;
      const data = (await res.json()) as { quoteResponse?: { result?: RawQuote[] } };
      for (const q of data.quoteResponse?.result ?? []) {
        const divFrac = num(q.trailingAnnualDividendYield);
        out.set(q.symbol, {
          price: num(q.regularMarketPrice),
          marketCap: num(q.marketCap),
          change1d: num(q.regularMarketChangePercent),
          peRatio: num(q.trailingPE),
          forwardPe: num(q.forwardPE),
          dividendYield: divFrac != null ? divFrac * 100 : null,
          name: q.longName ?? q.shortName ?? null,
        });
      }
    } catch {
      // best-effort; skip this chunk
    }
  }
  return out;
}

// --- Chart history (per symbol) ------------------------------------------------

type ChartResult = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

// Daily close series for the last ~3 months, newest-first. Empty on failure.
export async function fetchHistory(symbol: string): Promise<PricePoint[]> {
  const url = `${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=3mo&interval=1d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return [];
    const data = (await res.json()) as ChartResult;
    const r = data.chart?.result?.[0];
    const ts = r?.timestamp ?? [];
    const closes = r?.indicators?.quote?.[0]?.close ?? [];
    const points: PricePoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const p = closes[i];
      if (p == null || !Number.isFinite(p)) continue;
      points.push({ d: new Date(ts[i] * 1000).toISOString().slice(0, 10), p });
    }
    points.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0)); // newest-first
    return points;
  } catch {
    return [];
  }
}

// --- Profile (per symbol) ------------------------------------------------------

type SummaryResult = {
  quoteSummary?: {
    result?: Array<{
      assetProfile?: {
        country?: string;
        sector?: string;
        industry?: string;
        fullTimeEmployees?: number;
      };
    }>;
  };
};

// Yahoo returns full country names; the UI renders a flag from an ISO-2 code.
const COUNTRY_ISO2: Record<string, string> = {
  "United States": "US", "Taiwan": "TW", "Netherlands": "NL", "Hong Kong": "HK",
  China: "CN", Israel: "IL", Japan: "JP", "South Korea": "KR", Germany: "DE",
  France: "FR", "United Kingdom": "GB", Ireland: "IE", Canada: "CA", Singapore: "SG",
  India: "IN", Sweden: "SE", Finland: "FI", Switzerland: "CH", Brazil: "BR",
  Argentina: "AR", Luxembourg: "LU", "Cayman Islands": "KY", Bermuda: "BM",
  Denmark: "DK", Norway: "NO", Australia: "AU", Spain: "ES", Italy: "IT",
  Uruguay: "UY", Mexico: "MX", Indonesia: "ID", Vietnam: "VN", Poland: "PL",
  Belgium: "BE", Austria: "AT", "British Virgin Islands": "VG", Jersey: "JE",
};

function toIso2(name: string | undefined): string | null {
  if (!name) return null;
  return COUNTRY_ISO2[name] ?? null;
}

export async function fetchProfile(symbol: string): Promise<YahooProfile | undefined> {
  const sess = await getSession();
  if (!sess) return undefined;
  const url =
    `${Q1}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile` +
    `&crumb=${encodeURIComponent(sess.crumb)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: sess.cookie } });
    if (!res.ok) return undefined;
    const data = (await res.json()) as SummaryResult;
    const ap = data.quoteSummary?.result?.[0]?.assetProfile;
    if (!ap) return undefined;
    return {
      country: toIso2(ap.country),
      sector: ap.sector ?? null,
      industry: ap.industry ?? null,
      employees: num(ap.fullTimeEmployees),
    };
  } catch {
    return undefined;
  }
}

// Exposed for callers that want to seed a from/to window if needed later.
export const historyWindow = () => ({ from: shiftDate(today(), -95), to: today() });

// --- Universe discovery (Yahoo screener) ---------------------------------------
//
// Dynamically discovers the tech universe by market cap, so rankings track the
// market instead of a frozen hand-maintained list. Filters to real US exchanges
// and de-dupes dual-class lines (e.g. GOOG vs GOOGL) by company name, keeping the
// higher-market-cap line (results are market-cap sorted, so the first one seen).

type ScreenerQuote = {
  symbol?: string;
  exchange?: string;
  shortName?: string;
  longName?: string;
};

const REAL_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "ASE"]); // Nasdaq / NYSE / NYSE American

// A screen term: match a whole sector or a single industry.
export type ScreenTerm = { field: "sector" | "industry"; value: string };

async function screenerPage(
  sess: { cookie: string; crumb: string },
  terms: ScreenTerm[],
  offset: number,
  size: number,
): Promise<ScreenerQuote[]> {
  const query = {
    operator: "AND",
    operands: [
      { operator: "EQ", operands: ["region", "us"] },
      { operator: "or", operands: terms.map((t) => ({ operator: "EQ", operands: [t.field, t.value] })) },
    ],
  };
  const body = {
    size,
    offset,
    sortField: "intradaymarketcap",
    sortType: "DESC",
    quoteType: "EQUITY",
    query,
    userId: "",
    userIdType: "guid",
  };
  const url = `${Q1}/v1/finance/screener?crumb=${encodeURIComponent(sess.crumb)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "User-Agent": UA, Cookie: sess.cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    finance?: { result?: Array<{ quotes?: ScreenerQuote[] }> };
  };
  return data.finance?.result?.[0]?.quotes ?? [];
}

// Returns up to `size` US tech tickers, market-cap descending. Empty on failure.
export async function fetchTechUniverse(terms: ScreenTerm[], size: number): Promise<string[]> {
  const sess = await getSession();
  if (!sess) return [];
  const out: string[] = [];
  const seenSymbol = new Set<string>();
  const seenName = new Set<string>();
  for (let offset = 0; offset < 3000 && out.length < size; offset += 250) {
    let quotes: ScreenerQuote[];
    try {
      quotes = await screenerPage(sess, terms, offset, 250);
    } catch {
      break;
    }
    if (quotes.length === 0) break;
    for (const q of quotes) {
      if (out.length >= size) break;
      const s = q.symbol ?? "";
      if (!REAL_EXCHANGES.has(q.exchange ?? "") || !/^[A-Z]{1,5}$/.test(s) || seenSymbol.has(s)) {
        continue;
      }
      const name = (q.shortName ?? q.longName ?? "").trim();
      if (name && seenName.has(name)) continue; // dual-class / duplicate company
      seenSymbol.add(s);
      if (name) seenName.add(name);
      out.push(s);
    }
  }
  return out;
}

// --- Key statistics (single symbol, for the detail page) -----------------------
//
// Pulls the rich quoteSummary modules behind a Yahoo "key statistics" page and maps
// them into display-ready sections. Yahoo pre-formats most numbers (a `.fmt` string
// like "7.30B" / "19.08%"), so we render those directly and fall back to the raw.

export type StatRow = { label: string; value: string };
export type StatSection = { title: string; rows: StatRow[] };
export type StockDetail = {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string | null;
  price: number | null;
  change: number | null; // signed, for color
  priceFmt: string;
  changeFmt: string;
  changePercentFmt: string;
  summary: string | null;
  website: string | null;
  hq: string | null;
  sections: StatSection[];
};

// A Yahoo value is either a plain string/number or a { raw, fmt } wrapper.
function asRawFmt(x: unknown): { raw?: unknown; fmt?: string } | undefined {
  if (x && typeof x === "object" && ("raw" in x || "fmt" in x)) {
    return x as { raw?: unknown; fmt?: string };
  }
  return undefined;
}
function fmtVal(x: unknown): string {
  const v = asRawFmt(x);
  if (v) {
    if (typeof v.fmt === "string" && v.fmt !== "") return v.fmt;
    if (v.raw != null) return String(v.raw);
    return "—";
  }
  if (typeof x === "string" && x !== "") return x;
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return "—";
}
function rawNum(x: unknown): number | null {
  const v = asRawFmt(x);
  const n = v ? v.raw : x;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
const str = (x: unknown): string | null => (typeof x === "string" && x !== "" ? x : null);

export async function fetchKeyStats(symbol: string): Promise<StockDetail | undefined> {
  const sess = await getSession();
  if (!sess) return undefined;
  const modules = "price,summaryDetail,defaultKeyStatistics,financialData,assetProfile";
  const url =
    `${Q1}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}` +
    `&crumb=${encodeURIComponent(sess.crumb)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Cookie: sess.cookie } });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      quoteSummary?: { result?: Array<Record<string, Record<string, unknown>>> };
    };
    const r = data.quoteSummary?.result?.[0];
    if (!r) return undefined;
    const p = r.price ?? {};
    const s = r.summaryDetail ?? {};
    const k = r.defaultKeyStatistics ?? {};
    const f = r.financialData ?? {};
    const a = r.assetProfile ?? {};
    const row = (label: string, x: unknown): StatRow => ({ label, value: fmtVal(x) });
    const hq = [str(a.city), str(a.state), str(a.country)].filter(Boolean).join(", ");

    const sections: StatSection[] = [
      {
        title: "Valuation Measures",
        rows: [
          row("Market Cap", p.marketCap ?? s.marketCap),
          row("Enterprise Value", k.enterpriseValue),
          row("Trailing P/E", s.trailingPE),
          row("Forward P/E", k.forwardPE ?? s.forwardPE),
          row("PEG Ratio", k.pegRatio),
          row("Price/Sales (ttm)", s.priceToSalesTrailing12Months),
          row("Price/Book", k.priceToBook),
          row("Enterprise Value/Revenue", k.enterpriseToRevenue),
          row("Enterprise Value/EBITDA", k.enterpriseToEbitda),
        ],
      },
      {
        title: "Financial Highlights",
        rows: [
          row("Profit Margin", f.profitMargins),
          row("Operating Margin (ttm)", f.operatingMargins),
          row("Return on Assets (ttm)", f.returnOnAssets),
          row("Return on Equity (ttm)", f.returnOnEquity),
          row("Revenue (ttm)", f.totalRevenue),
          row("Revenue Per Share (ttm)", f.revenuePerShare),
          row("Quarterly Revenue Growth (yoy)", f.revenueGrowth),
          row("Gross Profit (ttm)", f.grossProfits),
          row("EBITDA", f.ebitda),
          row("Net Income to Common (ttm)", k.netIncomeToCommon),
          row("Diluted EPS (ttm)", k.trailingEps),
          row("Quarterly Earnings Growth (yoy)", k.earningsQuarterlyGrowth),
        ],
      },
      {
        title: "Balance Sheet & Cash Flow",
        rows: [
          row("Total Cash (mrq)", f.totalCash),
          row("Total Cash Per Share (mrq)", f.totalCashPerShare),
          row("Total Debt (mrq)", f.totalDebt),
          row("Total Debt/Equity (mrq)", f.debtToEquity),
          row("Current Ratio (mrq)", f.currentRatio),
          row("Book Value Per Share (mrq)", k.bookValue),
          row("Operating Cash Flow (ttm)", f.operatingCashflow),
          row("Levered Free Cash Flow (ttm)", f.freeCashflow),
        ],
      },
      {
        title: "Trading Information",
        rows: [
          row("Beta (5Y Monthly)", k.beta ?? s.beta),
          row("52-Week Change", k["52WeekChange"]),
          row("52 Week High", s.fiftyTwoWeekHigh),
          row("52 Week Low", s.fiftyTwoWeekLow),
          row("50-Day Moving Average", s.fiftyDayAverage),
          row("200-Day Moving Average", s.twoHundredDayAverage),
          row("Avg Volume (3m)", s.averageVolume),
          row("Shares Outstanding", k.sharesOutstanding),
          row("Float", k.floatShares),
          row("% Held by Insiders", k.heldPercentInsiders),
          row("% Held by Institutions", k.heldPercentInstitutions),
          row("Shares Short", k.sharesShort),
          row("Short Ratio", k.shortRatio),
        ],
      },
      {
        title: "Dividends & Splits",
        rows: [
          row("Forward Annual Dividend Rate", s.dividendRate),
          row("Forward Annual Dividend Yield", s.dividendYield),
          row("Trailing Annual Dividend Rate", s.trailingAnnualDividendRate),
          row("Trailing Annual Dividend Yield", s.trailingAnnualDividendYield),
          row("Payout Ratio", s.payoutRatio),
          row("Ex-Dividend Date", s.exDividendDate),
        ],
      },
    ];

    const name = str(p.longName) ?? str(p.shortName) ?? symbol;
    return {
      symbol,
      name,
      exchange: str(p.exchangeName),
      currency: str(p.currency),
      price: rawNum(p.regularMarketPrice),
      change: rawNum(p.regularMarketChange),
      priceFmt: fmtVal(p.regularMarketPrice),
      changeFmt: fmtVal(p.regularMarketChange),
      changePercentFmt: fmtVal(p.regularMarketChangePercent),
      summary: str(a.longBusinessSummary),
      website: str(a.website),
      hq: hq || null,
      sections,
    };
  } catch {
    return undefined;
  }
}
