import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSnapshot } from "@/lib/store";
import { fetchKeyStats } from "@/lib/yahoo";

// Re-fetch the live key-stats at most once an hour (per symbol, cached by Next).
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: { symbol: string };
}): Promise<Metadata> {
  const symbol = decodeURIComponent(params.symbol).toUpperCase();
  return { title: `${symbol} — Key Statistics · Top Tech Companies` };
}

export default async function StockPage({ params }: { params: { symbol: string } }) {
  const symbol = decodeURIComponent(params.symbol).toUpperCase();

  const [snapshot, detail] = await Promise.all([getSnapshot(), fetchKeyStats(symbol)]);
  const company = snapshot?.companies.find((c) => c.symbol === symbol);
  if (!detail && !company) notFound();

  const name = detail?.name ?? company?.name ?? symbol;
  const logoUrl =
    company?.logoUrl ?? `https://images.financialmodelingprep.com/symbol/${symbol}.png`;
  const up = (detail?.change ?? 0) >= 0;

  return (
    <div>
      <Link href="/market-cap" className="text-sm text-gray-500 hover:text-gray-800">
        ← Back to rankings
      </Link>

      {/* Header */}
      <div className="mb-6 mt-3 flex items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded bg-gray-100 object-contain"
        />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">
            {name} <span className="font-normal text-gray-400">({symbol})</span>
          </h2>
          <div className="text-sm text-gray-500">
            {[detail?.exchange, detail?.currency].filter(Boolean).join(" · ")}
          </div>
        </div>
        {detail?.price != null && (
          <div className="ml-auto shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums">{detail.priceFmt}</div>
            <div className={"text-sm tabular-nums " + (up ? "text-up" : "text-down")}>
              {up ? "+" : ""}
              {detail.changeFmt} ({detail.changePercentFmt})
            </div>
          </div>
        )}
      </div>

      {/* Stat sections */}
      {detail ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {detail.sections.map((sec) => (
            <section key={sec.title} className="rounded-lg border border-gray-200 bg-white">
              <h3 className="border-b border-gray-200 px-4 py-2.5 text-sm font-semibold">
                {sec.title}
              </h3>
              <dl className="divide-y divide-gray-100">
                {sec.rows.map((r) => (
                  <div key={r.label} className="flex justify-between gap-4 px-4 py-2 text-sm">
                    <dt className="text-gray-500">{r.label}</dt>
                    <dd className="tabular-nums text-gray-900">{r.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
          Detailed statistics are unavailable right now. Try again shortly.
        </p>
      )}

      {/* About */}
      {detail?.summary && (
        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">About {name}</h3>
          <p className="text-sm leading-relaxed text-gray-600">{detail.summary}</p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-500">
            {detail.hq && <span>HQ: {detail.hq}</span>}
            {detail.website && (
              <a
                href={detail.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {detail.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
