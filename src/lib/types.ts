// Core domain types. Keep `Company` open: adding an optional field here +
// a column in src/config/columns.ts is all it takes to surface new data.

export type Company = {
  symbol: string;
  name: string;
  logoUrl: string;
  country: string; // ISO-2 country code (e.g. "US"), used for the flag
  industry: string;
  sector: string;

  price: number;
  marketCap: number;

  // Nullable metrics: when missing the table renders an em dash.
  peRatio: number | null;
  revenue: number | null; // TTM revenue, USD
  earnings: number | null; // TTM net income, USD

  change1d: number | null; // percent, e.g. 3.85 means +3.85%
  change5d: number | null; // percent
  change30d: number | null; // percent

  forwardPe: number | null; // price / next-FY estimated EPS
  dividendYield: number | null; // percent, e.g. 0.55 means 0.55%
  employees: number | null; // full-time employees

  // --- add more here, then populate in snapshot.ts + add a column to show ---
};

// One stored daily price point, used to compute 5d/30d change without
// re-fetching history every run.
export type PricePoint = { d: string; p: number }; // d = "YYYY-MM-DD", p = close

export type Snapshot = {
  companies: Company[];
  generatedAt: string; // ISO timestamp
  baseCurrency: "USD";

  // --- internal refresh state (not rendered) ---
  // Rolling per-symbol price history, newest-first, capped to ~45 days.
  priceHistory?: Record<string, PricePoint[]>;
  // Rotating cursors so each run refreshes a different slice of SEC fundamentals
  // / Yahoo profiles, spreading the per-symbol cost across runs.
  fundamentalsCursor?: number;
  profileCursor?: number;
};

// A company row with the rank it holds *within a given category*.
export type RankedRow = Company & { rank: number };

export type CategoryId = "market-cap" | "revenue" | "earnings";

export type CategoryDef = {
  id: CategoryId;
  label: string;
  // The Company field used to rank within this category.
  metric: keyof Company;
  dir: "asc" | "desc";
};

export type ColumnFormat =
  | "rank"
  | "company"
  | "currency"
  | "bigNumber"
  | "percent" // signed + red/green (for price changes)
  | "percentPlain" // unsigned, neutral color (for yields/margins)
  | "number"
  | "integer"
  | "country"
  | "text";

export type ColumnDef = {
  key: keyof RankedRow;
  label: string;
  format: ColumnFormat;
  align: "left" | "right";
  sortable: boolean;
};
