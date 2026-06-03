import { notFound } from "next/navigation";
import { CATEGORIES, getCategory, TOP_N } from "@/config/categories";
import { COLUMNS } from "@/config/columns";
import { rankByCategory } from "@/lib/rank";
import { getSnapshot } from "@/lib/store";
import { CategoryTabs } from "@/components/CategoryTabs";
import { CompanyTable } from "@/components/CompanyTable";

// Re-read the snapshot at most once an hour (matches the cron cadence).
export const revalidate = 3600;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c.id }));
}

export default async function CategoryPage({
  params,
}: {
  params: { category: string };
}) {
  const category = getCategory(params.category);
  if (!category) notFound();

  const snapshot = await getSnapshot();

  if (!snapshot) {
    return (
      <>
        <CategoryTabs active={category.id} />
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          No data yet. Run <code className="rounded bg-gray-100 px-1.5 py-0.5">npm run refresh:local</code>{" "}
          (or trigger the cron) to populate the snapshot.
        </div>
      </>
    );
  }

  // Rank the entire universe; the client decides how many to show (default TOP_N).
  const rows = rankByCategory(snapshot.companies, category, Infinity);

  return (
    <>
      <CategoryTabs active={category.id} />
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Top tech companies by {category.label.toLowerCase()}
        </h2>
        <p className="text-xs text-gray-400">
          Updated {new Date(snapshot.generatedAt).toLocaleString()}
        </p>
      </div>
      <CompanyTable rows={rows} columns={COLUMNS} defaultLimit={TOP_N} />
    </>
  );
}
