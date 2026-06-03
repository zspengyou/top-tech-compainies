# Top Tech Companies

A companiesmarketcap.com-style site that ranks technology companies by **market cap**,
**earnings**, and **revenue**. Within any category you can re-sort by any column; the
Rank column always reflects the category metric. Built with Next.js (App Router) +
TypeScript + Tailwind, data from Financial Modeling Prep (FMP), stored in Upstash
Redis (with a local-file fallback for dev).

> **Free-tier reality check.** FMP's free tier serves a **fixed 27-symbol whitelist**
> via single-symbol `quote` and caps at **~250 requests/day** — no screener, no batch.
> So this app currently ships a curated **25-company** view (`FMP_UNIVERSE_LIMIT=25`).
> The architecture already supports the full ~200-company universe; that just needs a
> paid FMP tier or an alternative data source (see [Scaling past 27 companies](#scaling-past-27-companies)).

## Quick start

```bash
cp .env.local.example .env.local     # set FMP_API_KEY=...
npm install
npm run refresh:local -- --full      # pull real data -> data/snapshot.json
npm run dev                          # http://localhost:3000  (redirects to /market-cap)
```

`FMP_UNIVERSE_LIMIT=25` is set in `.env.local`, so a refresh fetches 25 companies
(~100 requests on a full run — well under the 250/day cap). Without Upstash env vars
the store reads/writes `data/snapshot.json`, so refresh + dev work with nothing but
an FMP key.

## Initializing the data

The site renders a "No data yet" state until a snapshot exists. To create one:

```bash
# Full backfill — populates every column (price, market cap, P/E, revenue,
# earnings, 30d change) for all 25 companies in a single pass.
npm run refresh:local -- --full
```

Then for ongoing updates, the cheap incremental run (reuses prior fundamentals,
only re-prices + rotates a small slice):

```bash
npm run refresh:local
```

**If you hit `HTTP 429 Limit Reach`** you've spent the day's 250 free requests; the
quota resets ~3PM EST. Runs are resilient — a quota/paywall error never crashes a
refresh, it just reuses the previous snapshot's values for whatever it couldn't fetch
and picks them up on the next run.

## How it works

```
Cron / GitHub Action / npm run refresh:local
        └─> buildSnapshot()  (src/lib/fmp.ts)         fetch + normalize FMP data
              └─> setSnapshot()  (src/lib/store.ts)   Upstash Redis or local JSON
                    └─> /[category] page reads it, ranks, renders <CompanyTable>
```

**One enriched dataset** is stored — a `Company[]` with every field. Each category
page sorts that list by its metric to derive Rank + the top N. Storing one dataset
(not one per category) keeps categories consistent and makes "add a field → add a
column" trivial.

### The refresh pipeline (`src/lib/fmp.ts`)

Every free-tier call is single-symbol, so `buildSnapshot()` is built to do the
minimum and reuse the rest:

| Phase | What it fetches | Cost strategy |
| --- | --- | --- |
| **1. Quotes** (priority) | `/quote` per symbol → price, 1-day change, market cap | One call/symbol every run — this is the bulk of the budget. |
| **2. Income** | `/income-statement` → revenue, earnings, TTM EPS | Reused from the last snapshot; only **new symbols + a rotating slice** (`maxFundamentalSymbols`) re-fetched per run. Changes quarterly. |
| **3. Profile** | `/profile` → name, country, industry, sector, employees, dividend | Reused; only new symbols + a rotating slice (`maxProfileSymbols`). Nearly static. |
| **4. History** | `/historical-price-eod/light` → seed rolling price series | Bounded backfill (`maxHistoryBackfill`) for symbols whose 30-day series is incomplete. |

- **5d / 30d change** is computed from a **rolling price history** stored in the
  snapshot, not re-fetched. Each run appends today's quote price; steady-state cost ≈ 0.
- **P/E** is recomputed every run as `price / storedEPS`, so it tracks the fresh price
  without a daily fundamentals call.
- A **per-run budget guard** (`FMP_DAILY_BUDGET`, default 245) stops issuing calls
  before the cap, so a run never errors out mid-way. Rotating cursors
  (`fundamentalsCursor`, `profileCursor`) ensure each run advances a different slice.

### The universe (`src/config/universe.ts`)

The free tier has no screener, so the universe is a **static curated list**.
`FMP_FREE_TIER` holds the 27 symbols FMP's free tier actually serves a quote for
(verified by scanning the full list); they're ordered first so `FMP_UNIVERSE_LIMIT=N`
selects accessible names. The full ~200-symbol list lives below them, ready for a
paid tier where the screener/batch endpoints unlock the rest.

## Configuration (env vars)

| Var | Default | Purpose |
| --- | --- | --- |
| `FMP_API_KEY` | — | **Required.** Your Financial Modeling Prep key. |
| `FMP_UNIVERSE_LIMIT` | `0` (all) | Cap the refresh to the first N symbols. Set to `25` for the free-tier view. |
| `FMP_DAILY_BUDGET` | `245` | Hard ceiling on FMP calls per run. |
| `FMP_FETCH_ESTIMATES` | `false` | Fetch forward-P/E analyst estimates (paid endpoint). Column shows `—` when off. |
| `CRON_SECRET` | — | Bearer token the `/api/cron/refresh` route requires. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | Snapshot store. Falls back to `data/snapshot.json` when unset. (`KV_REST_API_*` also accepted.) |

## Extending

**Add a column** (e.g. P/S ratio):
1. add the field to `Company` in `src/lib/types.ts`
2. populate it in `src/lib/fmp.ts`
3. add one entry to `src/config/columns.ts`

**Add a ranking category** (e.g. by employees): add one entry to
`src/config/categories.ts`. Routes, tabs, and static params pick it up automatically.

## Deploy to Vercel

1. **Push to GitHub** and "Import Project" in Vercel.
2. **Add Upstash Redis**: Vercel dashboard → Storage → Marketplace → *Upstash Redis*
   → connect. It injects `UPSTASH_REDIS_REST_URL` / `_TOKEN` (the app also reads
   `KV_REST_API_URL` / `_TOKEN`).
3. **Set env vars** (Project → Settings → Environment Variables): `FMP_API_KEY`,
   `FMP_UNIVERSE_LIMIT=25`, and `CRON_SECRET` (a long random string Vercel sends as
   `Authorization: Bearer <CRON_SECRET>`; the route rejects anything else).
4. **Deploy.** Pages render "No data yet" until the first refresh runs.

### Scheduling refreshes

| Option | Best for | Notes |
| --- | --- | --- |
| **GitHub Action** (scheduled) | free tier (recommended) | Run `npm run refresh:local` a couple times/day with `UPSTASH_*` + `FMP_API_KEY` secrets. Writes straight to Upstash; no Vercel function time limit. |
| **Vercel Cron** (`vercel.json`) | Pro plan | Hourly schedule + `maxDuration` configured. Hobby caps crons at once/day. |
| **Manual** | one-offs | `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/refresh` |

#### Example GitHub Action (`.github/workflows/refresh.yml`)

```yaml
name: Refresh data
on:
  schedule: [{ cron: "0 14,21 * * *" }]   # ~2x/day, within FMP free 250/day
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run refresh:local
        env:
          FMP_API_KEY: ${{ secrets.FMP_API_KEY }}
          FMP_UNIVERSE_LIMIT: 25
          UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
```

## Scaling past 27 companies

The 25-company view is a free-tier limit, not an architectural one. To show the full
top-200, either:

- **Paid FMP tier** (~$22–29/mo) — unlocks the screener + batch endpoints and the
  full symbol set. Remove `FMP_UNIVERSE_LIMIT` and the static universe carries ~200.
- **Alternative free sources** — a keyless **Yahoo v8 chart** (price + 1d/5d/30d) +
  **SEC EDGAR** (shares → market cap, revenue, earnings) stack was verified to cover
  all symbols for free. This needs a new provider module in place of `fmp.ts`.

## Notes & caveats

- All amounts are stored in **USD**. Foreign ADRs (e.g. TSM) can show a distorted P/E
  because EPS is reported in local currency against a USD price — a currency/ADR-ratio
  normalization step is the fix.
- `peRatio` is **trailing (TTM)**; `forwardPe` needs the paid analyst-estimates
  endpoint (off by default).
- The snapshot stores internal refresh state (`priceHistory`, `ttmEps`,
  `fundamentalsCursor`, `profileCursor`) that the UI ignores; it's what powers cheap
  incremental refreshes.
