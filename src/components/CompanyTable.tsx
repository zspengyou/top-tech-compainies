"use client";

import { useMemo, useState } from "react";
import type { ColumnDef, RankedRow } from "@/lib/types";
import { renderCell } from "@/components/cells";

type SortState = { key: keyof RankedRow; dir: "asc" | "desc" };

// Compare helper: nulls always sort last; numbers numerically; strings locale-wise.
function compare(a: unknown, b: unknown): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function CompanyTable({
  rows,
  columns,
}: {
  rows: RankedRow[];
  columns: ColumnDef[];
}) {
  // Default view: category order (by the precomputed rank).
  const [sort, setSort] = useState<SortState>({ key: "rank", dir: "asc" });

  const sorted = useMemo(() => {
    const out = [...rows].sort((a, b) => compare(a[sort.key], b[sort.key]));
    return sort.dir === "desc" ? out.reverse() : out;
  }, [rows, sort]);

  function onHeaderClick(column: ColumnDef) {
    if (!column.sortable) return;
    setSort((prev) => {
      if (prev.key === column.key) {
        return { key: column.key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      // New column: default to descending for numbers, ascending for text.
      const numeric = column.format !== "text" && column.format !== "company" && column.format !== "country";
      return { key: column.key, dir: numeric ? "desc" : "asc" };
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
            {columns.map((col) => {
              const isSorted = sort.key === col.key;
              const arrow = isSorted ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
              return (
                <th
                  key={String(col.key)}
                  onClick={() => onHeaderClick(col)}
                  scope="col"
                  className={
                    "whitespace-nowrap px-3 py-2.5 font-medium " +
                    (col.align === "right" ? "text-right" : "text-left") +
                    (col.sortable ? " cursor-pointer select-none hover:text-gray-800" : "") +
                    (isSorted ? " text-gray-900" : "")
                  }
                >
                  {col.label}
                  <span className="text-gray-400">{arrow}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.symbol} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              {columns.map((col) => (
                <td
                  key={String(col.key)}
                  className={
                    "whitespace-nowrap px-3 py-2.5 " +
                    (col.align === "right" ? "text-right" : "text-left")
                  }
                >
                  {renderCell(col, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
