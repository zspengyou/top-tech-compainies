// The technology universe is DISCOVERED dynamically each refresh from Yahoo's
// screener (top companies by market cap), so the rankings track the market instead
// of a frozen hand-maintained list. What's configured here is only the *definition*
// of "technology" — a stable industry taxonomy — plus safety nets. None of the
// actual companies are hard-coded, so as market caps shift the list updates itself.

import type { ScreenTerm } from "@/lib/yahoo";

// What the universe screens for: the whole Technology sector, plus the specific
// cross-sector industries where Yahoo files big tech (Alphabet & Meta under Internet
// Content, Amazon & Alibaba under Internet Retail, gaming names under Electronic
// Gaming). Screening the sector keeps every tech industry without enumerating them.
// This taxonomy is stable — unlike a company list, it doesn't drift as valuations
// change. (Entertainment is deliberately omitted so Disney/Warner don't appear.)
export const TECH_SCREEN: ScreenTerm[] = [
  { field: "sector", value: "Technology" },
  { field: "industry", value: "Internet Content & Information" },
  { field: "industry", value: "Internet Retail" },
  { field: "industry", value: "Electronic Gaming & Multimedia" },
];

// A few marquee tech names whose Yahoo industry sits just outside the screen above
// (e.g. Netflix is "Entertainment"). Tiny and stable — a supplement to discovery,
// not a replacement for it.
export const EXTRA_TICKERS: string[] = ["NFLX"];

// Size of the candidate pool discovered each refresh. Should exceed the largest
// RANKING_LIMIT you intend to display. Override with the UNIVERSE_SIZE env var.
export const UNIVERSE_SIZE = Number(process.env.UNIVERSE_SIZE ?? 600);

// Last-resort seed: used only if the screener is unavailable on a cold start with
// no previous snapshot to reuse. Steady state never depends on this list.
export const SEED_UNIVERSE: string[] = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSM", "ORCL", "NFLX",
  "CRM", "AMD", "ADBE", "CSCO", "ACN", "IBM", "TXN", "QCOM", "INTU", "NOW",
  "AMAT", "ARM", "MU", "ADI", "LRCX", "KLAC", "PANW", "SNPS", "CDNS", "ANET",
  "INTC", "PLTR", "CRWD", "NXPI", "MRVL", "DELL", "UBER", "SHOP", "PYPL", "SNOW",
];
