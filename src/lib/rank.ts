import { TOP_N } from "@/config/categories";
import type { CategoryDef, Company, RankedRow } from "@/lib/types";

// Sort the full universe by the category metric, drop companies missing that
// metric, take the top N, and stamp each with its category rank.
export function rankByCategory(
  companies: Company[],
  category: CategoryDef,
  topN: number = TOP_N,
): RankedRow[] {
  const metric = category.metric;
  const factor = category.dir === "desc" ? -1 : 1;

  const ranked = companies
    .filter((c) => {
      const v = c[metric];
      return typeof v === "number" && !Number.isNaN(v);
    })
    .sort((a, b) => {
      const av = a[metric] as number;
      const bv = b[metric] as number;
      return (av - bv) * factor;
    })
    .slice(0, topN)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  return ranked;
}
