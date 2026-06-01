// Display formatters. All values are stored in USD; the currency symbol is a
// single constant so multi-currency support is a localized future change.

const CURRENCY_SYMBOL = "$";

export function formatCurrency(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${CURRENCY_SYMBOL}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// 1.23T / 45.6B / 789M style for large dollar amounts (market cap, revenue).
export function formatBigNumber(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [threshold, suffix] of units) {
    if (abs >= threshold) {
      return `${CURRENCY_SYMBOL}${(value / threshold).toFixed(2)}${suffix}`;
    }
  }
  return `${CURRENCY_SYMBOL}${value.toFixed(2)}`;
}

export function formatPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

// Unsigned percent, no +/- prefix (dividend yield, margins, etc.).
export function formatPercentPlain(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function formatInteger(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatNumber(value: number | null, digits = 2): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatText(value: string | null | undefined): string {
  return value && value.trim() ? value : "—";
}
