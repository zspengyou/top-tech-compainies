import type { ColumnDef } from "@/lib/types";

// The table renders exactly these columns, in order. To add a column:
//   1) add the field to `Company` in src/lib/types.ts
//   2) populate it in src/lib/snapshot.ts (from Yahoo or SEC)
//   3) add an entry here
// No table/component changes required.
export const COLUMNS: ColumnDef[] = [
  { key: "rank", label: "Rank", format: "rank", align: "right", sortable: false },
  { key: "name", label: "Company", format: "company", align: "left", sortable: true },
  { key: "marketCap", label: "Market Cap", format: "bigNumber", align: "right", sortable: true },
  { key: "price", label: "Price", format: "currency", align: "right", sortable: true },
  { key: "change1d", label: "Today", format: "percent", align: "right", sortable: true },
  { key: "change5d", label: "Past 5 Days", format: "percent", align: "right", sortable: true },
  { key: "change30d", label: "Past 30 Days", format: "percent", align: "right", sortable: true },
  { key: "country", label: "Country", format: "country", align: "left", sortable: true },
  { key: "industry", label: "Industry", format: "text", align: "left", sortable: true },
  { key: "peRatio", label: "P/E (TTM)", format: "number", align: "right", sortable: true },
  { key: "forwardPe", label: "Fwd P/E", format: "number", align: "right", sortable: true },
  { key: "revenue", label: "Revenue", format: "bigNumber", align: "right", sortable: true },
  { key: "dividendYield", label: "Dividend %", format: "percentPlain", align: "right", sortable: true },
  { key: "employees", label: "Employees", format: "integer", align: "right", sortable: true },
];
