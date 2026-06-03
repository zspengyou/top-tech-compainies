"use client";

import { useMemo, useState } from "react";
import type { ColumnDef, RankedRow } from "@/lib/types";
import { renderCell } from "@/components/cells";

type SortState = { key: keyof RankedRow; dir: "asc" | "desc" };

// Compare two non-null values: numbers numerically; strings locale-wise.
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

// Direction-aware comparator: nulls always sort last, regardless of dir.
function compare(a: unknown, b: unknown, dir: "asc" | "desc"): number {
  const aNull = a == null || a === "";
  const bNull = b == null || b === "";
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const c = compareValues(a, b);
  return dir === "desc" ? -c : c;
}

export function CompanyTable({
  rows,
  columns,
  defaultLimit = 200,
}: {
  rows: RankedRow[];
  columns: ColumnDef[];
  defaultLimit?: number;
}) {
  // Default view: category order (by the precomputed rank).
  const [sort, setSort] = useState<SortState>({ key: "rank", dir: "asc" });
  // How many rows to show. `rows` arrives ranked, so we keep the top N by rank
  // and then sort that subset by whatever column the user picks.
  const [limit, setLimit] = useState(defaultLimit);

  const sorted = useMemo(() => {
    const top = rows.slice(0, Math.max(0, limit));
    return top.sort((a, b) => compare(a[sort.key], b[sort.key], sort.dir));
  }, [rows, sort, limit]);

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
    <>
      <div className="mb-2 flex items-center justify-end gap-2 text-xs text-gray-500">
        <label htmlFor="row-limit">Show</label>
        <input
          id="row-limit"
          type="number"
          min={1}
          max={rows.length}
          value={limit}
          onChange={(e) => {
            const n = Number(e.target.value);
            setLimit(Number.isFinite(n) && n > 0 ? Math.min(n, rows.length) : 0);
          }}
          className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-gray-700 focus:border-gray-400 focus:outline-none"
        />
        <span>of {rows.length}</span>
      </div>
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
    </>
  );
}
