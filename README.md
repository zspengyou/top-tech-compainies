# Top Tech Companies

A companiesmarketcap.com-style site that ranks the top 200 technology companies by
**market cap**, **earnings**, and **revenue**. Within any category you can re-sort
by any column; the Rank column always reflects the category. Built with Next.js
(App Router) + TypeScript + Tailwind, data from Financial Modeling Prep (FMP),
stored in Upstash Redis (with a local-file fallback for dev).

## Local development

```bash
cp .env.local.example .env.local     # set FMP_API_KEY=...
npm install
npm run refresh:local                # pull real data -> data/snapshot.json
npm run dev                          # http://localhost:3000
```

Without Upstash env vars set, the store reads/writes `data/snapshot.json`, so the
local refresh + dev server work with nothing but an FMP key.

## How it works

```
Cron / GitHub Action / npm run refresh:local
        └─> buildSnapshot()  (src/lib/fmp.ts)         fetch + normalize FMP data
              └─> setSnapshot()  (src/lib/store.ts)   Upstash Redis or local JSON
                    └─> /[category] page reads it, ranks, renders <CompanyTable>
```

- **One enriched dataset** (~260 companies) is stored; each category page sorts it
  by that category's metric to derive the top-200 + Rank.
- The table is **config-driven** — see "Extending" below.

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
   → connect to the project. It injects the REST URL/token env vars
   (`UPSTASH_REDIS_REST_URL`/`_TOKEN`, or `KV_REST_API_URL`/`_TOKEN` — the app reads both).
3. **Set env vars** (Project → Settings → Environment Variables):
   - `FMP_API_KEY` — your Financial Modeling Prep key
   - `CRON_SECRET` — a long random string. Vercel sends it as
     `Authorization: Bearer <CRON_SECRET>` to the cron endpoint; the route rejects
     anything else.
4. **Deploy.** Pages render the "No data yet" state until the first refresh runs.

### Refreshing the data — built for the FMP free tier (250 requests/day)

The provider is optimized to stay under the free daily cap:

- **Batched quotes** — `/batch-quote` fetches ~50 symbols/request, not one each.
- **Reused fundamentals** — revenue, earnings, employees, and forward P/E are read
  from the previous snapshot and only a bounded rotating subset is re-fetched per
  run (`maxFundamentalSymbols`, default 50). They change quarterly, so this is safe.
- **Rolling price history** — 5d/30d change is computed from a price series stored
  in the snapshot; today's price is already fetched, so steady-state cost is ~0.
  New/uncovered symbols are seeded via a bounded historical backfill
  (`maxHistoryBackfill`, default 50).

A typical run is **~100 requests** (1 screener + ~5 batch quotes + bounded
backfills) — comfortably under 250/day, leaving room for ~2 runs/day.

**Cold start** needs to seed every company's fundamentals + history once. Because
that exceeds 250 requests, the incremental refresh fills it in over several runs
(the cursor rotates through the universe). Just run it repeatedly across a couple
of days — re-runs after the daily reset (3PM EST) keep adding coverage. Or run
`npm run refresh:local -- --full` locally, repeated across days until full.

| Option | Best for | Notes |
| --- | --- | --- |
| **GitHub Action** (scheduled) | free tier (recommended) | Run `npm run refresh:local` a couple times/day with `UPSTASH_*` + `FMP_API_KEY` secrets. Writes straight to Upstash; no Vercel function time limit, and reuse keeps each run cheap. |
| **Vercel Cron** (`vercel.json`) | Pro plan | Hourly schedule + `maxDuration: 300` configured. Hobby caps crons at once/day and functions at 60s; an incremental run now fits 60s, but once/day is slow for cold-start fill. |
| **Manual** | one-offs | `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/refresh` |

> **Forward P/E** uses FMP's analyst-estimates endpoint, which is typically paid.
> It's off by default; set `FMP_FETCH_ESTIMATES=true` if your plan includes it.
> Otherwise that column shows `—`.

Trigger a refresh a few times after deploy to build up the first snapshot.

#### Example GitHub Action (`.github/workflows/refresh.yml`)

```yaml
name: Refresh data
on:
  schedule: [{ cron: "0 14,21 * * *" }]   # ~2x/day; keeps within FMP free 250/day
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
          UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
```

## Notes

- All amounts are stored in **USD**. The currency symbol is a single constant in
  `src/lib/format.ts`; multi-currency display (like the original site's CAD view)
  is a localized future change plus an FX step.
- `peRatio` is **trailing (TTM)**; `forwardPe` is computed from FMP consensus
  next-FY EPS estimates (paid endpoint — see the forward P/E note above).
- The snapshot also stores internal refresh state (`priceHistory`,
  `fundamentalsCursor`) that the UI ignores; it's what powers cheap incremental
  refreshes.
