// Populate the local snapshot (data/snapshot.json) without deploying.
//   npm run refresh:local            # incremental: cheap, reuses prior data
//   npm run refresh:local -- --full  # backfill ALL fundamentals + history (cold start)
//
// Data comes from Yahoo Finance + SEC EDGAR — both keyless, so no API key is needed.
// When Upstash env vars are set it writes there instead (same path as the cron job).
//
// A `--full` run fetches SEC fundamentals + Yahoo history for every symbol; an
// incremental run reuses those and only re-prices + rotates a small slice. Run
// `--full` once to seed, then incremental keeps it fresh.

import { config } from "dotenv";
config({ path: ".env.local" });

import { buildSnapshot, type RefreshOptions } from "../src/lib/snapshot";
import { setSnapshot, storeTarget } from "../src/lib/store";

async function main() {
  const full = process.argv.includes("--full");
  const opts: RefreshOptions = full
    ? {
        maxFundamentalSymbols: Infinity,
        maxProfileSymbols: Infinity,
        maxHistoryBackfill: Infinity,
      }
    : {};

  // Writes to Upstash Redis when its REST credentials are present in the
  // environment (so this updates the same store Vercel reads, no cron needed);
  // otherwise falls back to the local data/snapshot.json file.
  console.log(`Target store: ${storeTarget()}`);
  console.log(`Building snapshot from Yahoo + SEC (${full ? "FULL backfill" : "incremental"})…`);
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
      `\n${snapshot.companies.length - withFund} companies have no USD revenue+earnings ` +
        `(foreign filers report IFRS/non-USD and are left blank by design).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
