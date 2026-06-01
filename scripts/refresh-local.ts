// Populate the local snapshot (data/snapshot.json) without deploying.
//   npm run refresh:local            # incremental: cheap, reuses prior fundamentals
//   npm run refresh:local -- --full  # backfill ALL fundamentals + history (heavy)
//
// Reads FMP_API_KEY from .env.local. When Upstash env vars are set it writes
// there instead (same code path as the cron job).
//
// NOTE: the free FMP tier allows 250 requests/day. A `--full` cold start needs
// more than that, so it self-heals across days — re-run it after the daily reset
// (3PM EST) until every company has fundamentals + price history.

import { config } from "dotenv";
config({ path: ".env.local" });

import { buildSnapshot, type RefreshOptions } from "../src/lib/fmp";
import { setSnapshot } from "../src/lib/store";

async function main() {
  const full = process.argv.includes("--full");
  const opts: RefreshOptions = full
    ? { maxFundamentalSymbols: Infinity, maxHistoryBackfill: Infinity }
    : {};

  console.log(`Building snapshot from FMP (${full ? "FULL backfill" : "incremental"})…`);
  const start = Date.now();
  const snapshot = await buildSnapshot(opts);
  await setSnapshot(snapshot);
  const secs = ((Date.now() - start) / 1000).toFixed(1);

  const withFund = snapshot.companies.filter((c) => c.revenue != null && c.earnings != null).length;
  const withHist = snapshot.companies.filter((c) => c.change30d != null).length;
  console.log(
    `Done in ${secs}s — ${snapshot.companies.length} companies stored ` +
      `(${withFund} with revenue+earnings, ${withHist} with 30d change).`,
  );

  const top = [...snapshot.companies]
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 5)
    .map((c) => `${c.symbol} ${(c.marketCap / 1e12).toFixed(2)}T pe=${c.peRatio ?? "—"}`);
  console.log("Top 5 by market cap:", top.join(", "));

  if (withFund < snapshot.companies.length) {
    console.log(
      `\n${snapshot.companies.length - withFund} companies still need fundamentals. ` +
        `Re-run (incremental rotates through them, or use --full) after the daily reset.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
