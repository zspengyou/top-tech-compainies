import type { CategoryDef, CategoryId } from "@/lib/types";

// Add a ranking category by adding one entry here. Routes, tabs, and
// generateStaticParams all read from this list.
export const CATEGORIES: CategoryDef[] = [
  { id: "market-cap", label: "Market Cap", metric: "marketCap", dir: "desc" },
  { id: "earnings", label: "Earnings", metric: "earnings", dir: "desc" },
  { id: "revenue", label: "Revenue", metric: "revenue", dir: "desc" },
];

export const DEFAULT_CATEGORY: CategoryId = "market-cap";

// Number of ranked companies shown per category. Configurable via RANKING_LIMIT
// (default 200). Keep it <= UNIVERSE_SIZE (the discovered candidate pool).
export const TOP_N = Number(process.env.RANKING_LIMIT ?? 200);

export function getCategory(id: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.id === id);
}
