# Project Progress — Top Tech Companies

A companiesmarketcap.com-style site ranking the top ~200 technology companies by
**market cap**, **earnings**, and **revenue**, with click-to-sort columns. Built to
deploy on **Vercel** with **Next.js**, data from **Financial Modeling Prep (FMP)**.

This file is the running log of decisions and status. Newest entries on top.

---

## Status (2026-06-01)

- ✅ App scaffolded and building (Next.js 14 App Router + TypeScript + Tailwind).
- ✅ Three categories live (`/market-cap`, `/earnings`, `/revenue`); `/` redirects to
  `/market-cap`. Per-category Rank + client-side column sorting verified.
- ✅ Columns: Rank, Company (logo+ticker), Market Cap, Price, Today, Past 5 Days,
  Past 30 Days, Country, Industry, P/E (TTM), Forward P/E, Revenue, Dividend %,
  Employees. Config-driven — adding a column/category is a one-line change.
- ✅ Storage: Upstash Redis in prod, local `data/snapshot.json` fallback in dev.
- ✅ FMP provider optimized for the **free tier (250 req/day)**: ~1,300 → ~100
  requests/refresh. Verified with a mock-server test (batching + reuse).
- ⏳ Cold start: needs several incremental runs (or `--full` across days) to seed
  all fundamentals + price history within the daily cap.
- ⏳ Not yet deployed to Vercel; `.github/workflows/refresh.yml` not yet added.

---

## Architecture

```
refresh (cron / GitHub Action / npm run refresh:local)
  └─ buildSnapshot()  src/lib/fmp.ts     fetch + normalize FMP, reuse prior data
       └─ setSnapshot()  src/lib/store.ts  Upstash Redis or local JSON
            └─ /[category] page reads snapshot → rankByCategory() → <CompanyTable>
```

- **One enriched dataset** (~240 companies) is stored; each category page sorts it
  by that category's metric to derive the top-200 + Rank.
- **Config-driven UI**: `src/config/columns.ts` and `src/config/categories.ts` drive
  the table and routes. Add a field to `Company` (`src/lib/types.ts`), populate it in
  `fmp.ts`, add one column entry — no component changes.

### Key files
| File | Purpose |
| --- | --- |
| `src/lib/types.ts` | `Company`, `Snapshot`, `PricePoint`, config types |
| `src/lib/fmp.ts` | FMP provider, `buildSnapshot(opts)` — batching + reuse |
| `src/lib/store.ts` | Upstash Redis / local-file snapshot persistence |
| `src/lib/rank.ts` | `rankByCategory()` — sort + top-N + Rank stamping |
| `src/lib/format.ts` | currency / T-B-M / percent / integer formatters |
| `src/config/categories.ts` | ranking categories (add one to add a category) |
| `src/config/columns.ts` | table columns (add one to add a column) |
| `src/app/[category]/page.tsx` | server page: read → rank → render |
| `src/app/api/cron/refresh/route.ts` | cron endpoint, `CRON_SECRET` guarded |
| `src/components/CompanyTable.tsx` | client table, click-to-sort |
| `scripts/refresh-local.ts` | local refresh (`--full` for heavy backfill) |
| `vercel.json` | cron schedule (twice daily) |

---

## Decisions

- **Data source: FMP**, free tier only (no paid plans). Trailing P/E and most fields
  are free; **forward P/E uses analyst-estimates (paid)** — gated behind
  `FMP_FETCH_ESTIMATES=true`, shows `—` otherwise.
- **Refresh model: cron → cached snapshot**, pages read the snapshot (no
  per-request FMP calls).
- **Store: Upstash Redis** (Vercel Marketplace). Started with `@vercel/kv` but it's
  deprecated → swapped to `@upstash/redis`. `store.ts` reads either `UPSTASH_*` or
  `KV_*` env names.
- **Rank is fixed per category**; column header clicks re-sort the view but the Rank
  column stays tied to the category (matches companiesmarketcap).
- **USD only** for now; currency symbol is one constant in `format.ts` — multi-currency
  (e.g. the original's CAD view) is a future FX step.

---

## Free-tier optimization (the big one)

Original code: 5 FMP calls × ~260 companies = **~1,300 requests/refresh** — over 5×
the free daily cap of 250. Rewrote `buildSnapshot()` to:

1. **Batch quotes** — `/batch-quote` ~50 symbols/request (260 → ~6 calls). Gives
   price, marketCap, P/E, 1-day change.
2. **Reuse fundamentals** — revenue, earnings, employees, forward P/E are read from
   the previous snapshot; only a bounded rotating subset (`maxFundamentalSymbols`,
   default 50) + brand-new symbols are re-fetched each run. A `fundamentalsCursor`
   rotates through the universe.
3. **Rolling price history** — `priceHistory` in the snapshot stores a daily price
   series; 5d/30d change is computed from it. Today's price is already fetched, so
   steady-state cost ~0. New symbols seeded via bounded historical backfill
   (`maxHistoryBackfill`, default 50).
4. **dividendYield from the screener** (`lastAnnualDividend`) — no profile call.

Result: **~100 requests/run**, ~2 runs/day within budget. Verified via a temporary
mock-FMP-server test: screener 1×, batch-quote 1× per run; fundamentals coverage
accumulated 3 → 6 across two runs (reuse confirmed — already-covered symbols not
re-fetched).

**Cold start** can't seed everything within 250 requests; incremental runs fill it in
over a few days (cursor rotates), or run `npm run refresh:local -- --full` repeatedly
after each 3PM EST reset.

---

## Run / deploy

```bash
cp .env.local.example .env.local      # set FMP_API_KEY=...
npm install
npm run refresh:local                 # incremental; repeat to build coverage
npm run dev                           # http://localhost:3000
```

Deploy: push to GitHub → import in Vercel → add Upstash Redis integration → set
`FMP_API_KEY` + `CRON_SECRET` → deploy. See `README.md` for the full guide and the
recommended GitHub Action refresh schedule.

---

## Open items / next steps

- [ ] Add `.github/workflows/refresh.yml` (scheduled `refresh:local` → Upstash).
- [ ] Deploy to Vercel + connect Upstash; run refresh a few times to seed.
- [ ] Decide on forward P/E (keep paid-gated, or drop the column on free tier).
- [ ] Optional: bump `maxFundamentalSymbols`/`maxHistoryBackfill` for faster cold
      start at higher per-run cost.
- [ ] 2 npm advisories (Next 14.2.35 + postcss) only fixable via Next 16 major
      upgrade — deferred to avoid a breaking change mid-build.
- [ ] Future: multi-currency display, per-company detail pages, watchlist.
