import type { ColumnDef, RankedRow } from "@/lib/types";
import {
  formatBigNumber,
  formatCurrency,
  formatInteger,
  formatNumber,
  formatPercent,
  formatPercentPlain,
  formatText,
} from "@/lib/format";

// Turn an ISO-2 country code into a flag emoji (e.g. "US" -> 🇺🇸).
function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return "";
  const A = 0x1f1e6;
  const base = "A".charCodeAt(0);
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((ch) => A + (ch.charCodeAt(0) - base)),
  );
}

function ChangeCell({ value }: { value: number | null }) {
  const cls = value == null ? "text-gray-400" : value >= 0 ? "text-up" : "text-down";
  return <span className={cls}>{formatPercent(value)}</span>;
}

function CompanyCell({ row }: { row: RankedRow }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={row.logoUrl}
        alt=""
        width={24}
        height={24}
        className="h-6 w-6 shrink-0 rounded bg-gray-100 object-contain"
        loading="lazy"
      />
      <div className="min-w-0">
        <div className="truncate font-medium text-gray-900">{row.name}</div>
        <div className="text-xs text-gray-400">{row.symbol}</div>
      </div>
    </div>
  );
}

function CountryCell({ code }: { code: string }) {
  if (!code) return <span className="text-gray-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden>{flagEmoji(code)}</span>
      <span>{code.toUpperCase()}</span>
    </span>
  );
}

// Renders a single cell based on the column's declared format. Adding a new
// `ColumnFormat` means adding a case here.
export function renderCell(column: ColumnDef, row: RankedRow): React.ReactNode {
  const value = row[column.key];
  switch (column.format) {
    case "rank":
      return <span className="tabular-nums text-gray-500">{row.rank}</span>;
    case "company":
      return <CompanyCell row={row} />;
    case "currency":
      return <span className="tabular-nums">{formatCurrency(value as number | null)}</span>;
    case "bigNumber":
      return <span className="tabular-nums">{formatBigNumber(value as number | null)}</span>;
    case "percent":
      return <ChangeCell value={value as number | null} />;
    case "percentPlain":
      return <span className="tabular-nums">{formatPercentPlain(value as number | null)}</span>;
    case "number":
      return <span className="tabular-nums">{formatNumber(value as number | null)}</span>;
    case "integer":
      return <span className="tabular-nums">{formatInteger(value as number | null)}</span>;
    case "country":
      return <CountryCell code={value as string} />;
    case "text":
    default:
      return <span>{formatText(value as string)}</span>;
  }
}
