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
