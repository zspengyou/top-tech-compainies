# Top Tech Companies


A companiesmarketcap.com-style site that ranks ~200 technology companies by **market
cap**, **earnings**, and **revenue**. Within any category you can re-sort by any
column; the Rank column always reflects the category metric. Built with Next.js (App
Router) + TypeScript + Tailwind, data from **Yahoo Finance + SEC EDGAR** (both
keyless), stored in Upstash Redis with a local-file fallback for dev.

> **No API keys required.** Market data comes from Yahoo Finance and authoritative
> USD fundamentals from the SEC's official XBRL API — both free and keyless. (An
> earlier version used Financial Modeling Prep, whose free tier capped at a 27-symbol
> whitelist; that's why the codebase moved to these sources.)

## Quick start

```bash
cp .env.local.example .env.local     # optional: set SEC_USER_AGENT to your contact
npm install
npm run refresh:local -- --full      # pull real data -> data/snapshot.json (~30s)
npm run dev                          # http://localhost:3000  (redirects to /market-cap)
```

Without Upstash env vars the store reads/writes `data/snapshot.json`, so refresh + dev
work with nothing configured at all.

## Initializing the data

The site renders a "No data yet" state until a snapshot exists. Create one with a full
backfill — it fetches SEC fundamentals + price history for every symbol:

```bash
npm run refresh:local -- --full      # cold start: all columns, all ~200 companies
```

Then keep it fresh with the cheap incremental run (re-prices everything, reuses
fundamentals/profiles, and rotates a small slice of them):

```bash
npm run refresh:local
```

A `--full` cold start takes ~90s for the full ~600-company pool (SEC requests are
throttled to respect its ~10 req/s limit). Runs are resilient: if a source
rate-limits or errors on a symbol, that symbol keeps its previous values and is
retried next run — a refresh never half-writes or crashes.

**Updating production from your machine.** `refresh:local` writes to **Upstash Redis
whenever its REST credentials are present in the environment** — the same store Vercel
reads — otherwise it writes `data/snapshot.json`. So if your `.env.local` has the
Upstash vars (e.g. pulled via `vercel env pull`), running `npm run refresh:local`
updates the live site directly, no cron required. The command prints its target
(`Target store: Upstash Redis (…)` vs `local file (…)`) so you can confirm. The
snapshot is gzip-compressed in Redis (~1.3MB JSON → ~270KB) to stay under Upstash's
1MB request limit.

## How it works

```
Cron / GitHub Action / npm run refresh:local
        └─> buildSnapshot()  (src/lib/snapshot.ts)    fetch + normalize Yahoo + SEC
              └─> setSnapshot()  (src/lib/store.ts)    Upstash Redis or local JSON
                    └─> /[category] page reads it, ranks, renders <CompanyTable>
```

**One enriched dataset** is stored — a `Company[]` with every field. Each category
page sorts that list by its metric to derive Rank + the top N. Storing one dataset
(not one per category) keeps categories consistent and makes "add a field → add a
column" trivial.

### Data sources & division of labor

| Source | Module | Provides | Notes |
| --- | --- | --- | --- |
| **Yahoo `quote`** (batched) | `src/lib/yahoo.ts` | price, **market cap**, 1d change, trailing & forward P/E, dividend yield | Market cap is ADR-correct for foreign listings. Uses a cookie+crumb handshake; **unofficial** endpoint (no SLA). |
| **Yahoo `chart` v8** | `src/lib/yahoo.ts` | daily close series → 5d / 30d change | Keyless. |
| **Yahoo `quoteSummary`** | `src/lib/yahoo.ts` | country, sector, industry, employees | Crumb-protected, same session as `quote`. |
| **SEC EDGAR** company-facts | `src/lib/sec.ts` | revenue, earnings (net income) | Official, USD-normalized. Uses the **latest annual (10-K)** figure. |

### The refresh pipeline (`src/lib/snapshot.ts`)

| Phase | What it fetches | Cost strategy |
| --- | --- | --- |
| **1. Quotes** (priority) | Yahoo batched quote for every symbol | ~1 call per 50 symbols — cheap, runs every time. |
| **2. Fundamentals** | SEC revenue + earnings | Reused from the last snapshot; only **new symbols + a rotating slice** (`maxFundamentalSymbols`) re-fetched per run. Annual figures change yearly. |
| **3. Profile** | Yahoo country/sector/industry/employees | Reused; only new symbols + a rotating slice (`maxProfileSymbols`). |
| **4. History** | Yahoo chart series | Bounded backfill (`maxHistoryBackfill`) for symbols whose 30-day series is incomplete. |

- **5d / 30d change** comes from a **rolling price history** stored in the snapshot;
  each run appends today's quote price, so steady-state history cost ≈ 0.
- Rotating cursors (`fundamentalsCursor`, `profileCursor`) advance a different slice
  each run, so slowly-changing data refreshes over time without re-fetching everything.

### The universe (`src/config/universe.ts`)

The universe is **discovered dynamically** each refresh from Yahoo's screener (top
companies by market cap), so the rankings track the market instead of going stale on a
hand-maintained list. What's configured is only the *definition* of "technology" — the
whole Technology sector plus a few cross-sector industries where Yahoo files big tech
(Alphabet/Meta under *Internet Content*, Amazon under *Internet Retail*). That taxonomy
is stable; the company list isn't. Dual-class lines (GOOG vs GOOGL) are de-duped by
company name, keeping the higher-cap one. A tiny `SEED_UNIVERSE` is only a cold-start
fallback used if the screener is unreachable and there's no prior snapshot.

## Configuration (env vars)

All optional — the app runs keyless with sensible defaults.

| Var | Default | Purpose |
| --- | --- | --- |
| `RANKING_LIMIT` | `200` | How many ranked companies each category page shows. Raise to e.g. `500`. |
| `UNIVERSE_SIZE` | `600` | Size of the candidate pool discovered each refresh. Keep ≥ `RANKING_LIMIT`. |
| `SEC_USER_AGENT` | a built-in default | SEC asks for a `name email` contact string. URLs/parentheses trip its WAF — keep it plain. |
| `CRON_SECRET` | — | Bearer token the deployed `/api/cron/refresh` route requires. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | — | Snapshot store. Falls back to `data/snapshot.json` when unset. (`KV_REST_API_*` also accepted.) |

## Extending

**Add a column** (e.g. P/S ratio):
1. add the field to `Company` in `src/lib/types.ts`
2. populate it in `src/lib/snapshot.ts` (from Yahoo or SEC)
3. add one entry to `src/config/columns.ts`

**Add a ranking category** (e.g. by employees): add one entry to
`src/config/categories.ts`. Routes, tabs, and static params pick it up automatically.

## Deploy to Vercel

1. **Push to GitHub** and "Import Project" in Vercel.
2. **Add Upstash Redis**: Vercel dashboard → Storage → Marketplace → *Upstash Redis*
   → connect. It injects `UPSTASH_REDIS_REST_URL` / `_TOKEN` (the app also reads
   `KV_REST_API_URL` / `_TOKEN`).
3. **Set env vars** (Project → Settings → Environment Variables): `CRON_SECRET` (a
   long random string Vercel sends as `Authorization: Bearer <CRON_SECRET>`; the route
   rejects anything else), and optionally `SEC_USER_AGENT`. No data-provider key needed.
4. **Deploy.** Pages render "No data yet" until the first refresh runs — then seed it:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/refresh`.

### Scheduling refreshes

| Option | Best for | Notes |
| --- | --- | --- |
| **GitHub Action** (scheduled) | recommended | Run `npm run refresh:local` once or twice a day with the `UPSTASH_*` secrets. Writes straight to Upstash; no Vercel function time limit. |
| **Vercel Cron** (`vercel.json`) | Pro plan | Daily schedule + `maxDuration` configured. Hobby caps crons at once/day and functions at 60s — a full refresh is ~30s, so it fits. |
| **Manual** | one-offs | `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/refresh` |

#### Example GitHub Action (`.github/workflows/refresh.yml`)

```yaml
name: Refresh data
on:
  schedule: [{ cron: "0 14 * * *" }]   # daily
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
          SEC_USER_AGENT: ${{ secrets.SEC_USER_AGENT }}
          UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
```

## Notes & caveats

- All amounts are **USD**. Market cap (Yahoo) is ADR-correct for foreign listings.
- **Foreign filers** (TSM, ASML, SAP, BABA, …) file IFRS, not US-GAAP, so the SEC has
  no USD revenue/earnings for them — those cells show `—` rather than a misleading
  local-currency figure. They still rank by market cap (from Yahoo). ~30 of ~200 names.
- `peRatio` is **trailing**; `forwardPe` is Yahoo's consensus forward P/E.
- The Yahoo `quote` / `quoteSummary` endpoints are unofficial (cookie+crumb). If Yahoo
  changes them, market-data fields degrade gracefully (reuse prior values); SEC remains
  the stable fundamentals backbone.
- The snapshot stores internal refresh state (`priceHistory`, `fundamentalsCursor`,
  `profileCursor`) that the UI ignores; it powers cheap incremental refreshes.
- Logos are loaded from a public image CDN by ticker; some may 404 and render blank.
```
