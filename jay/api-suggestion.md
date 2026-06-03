# Free data-source options for the rankings site

You asked for a properly-researched set of options so you can pick one for the next
step. This is that decision doc. Where I say **VERIFIED**, I actually hit the endpoint
live during research; where I say **UNVERIFIED**, I'm going on docs only and we'd need a
probe before committing.

---

## What the site actually needs per company

| Field | Used for | Hard to get free? |
| --- | --- | --- |
| price | Price column, P/E, market cap | Easy |
| 1d / 5d / 30d change | change columns | Easy (need daily closes) |
| **market cap** | the main ranking | **Hardest** — most free quote feeds omit it |
| revenue (TTM) | Revenue ranking | Medium |
| earnings / net income (TTM) | Earnings ranking | Medium |
| P/E (TTM) | column | Derived (price ÷ EPS) |
| shares outstanding | to derive market cap | Medium |
| country / industry / sector / employees | columns | Medium |
| forward P/E, dividend | columns | Usually paid; OK to leave blank |

Market cap is the field that decides everything, because it's the primary ranking and
the one free feeds most often drop.

---

## Where FMP free leaves us (current state)

**VERIFIED — and it's a dead end past 27 names.** Free FMP serves a fixed **27-symbol
whitelist** via single-symbol `quote`, **~250 calls/day**, no screener, no batch.
Everything else 402s. We already ship this as the 25-company view. It works, it's just
capped at 27 companies forever. Anything bigger needs one of the options below.

---

## Option A — Yahoo v8 chart + SEC EDGAR  ·  *fully free, no keys*  ·  **recommended**

Two keyless sources combined: Yahoo for prices/changes, SEC for the fundamentals and
the shares count that lets us *derive* market cap.

**Yahoo Finance v8 chart** (`query1.finance.yahoo.com/v8/finance/chart/<SYM>`)
- **VERIFIED:** pulled 15 symbols in ~1.2s, no throttling, no key. Gives price + a
  daily close series → 1d/5d/30d trivially. Covers the symbols FMP blocks.
- Caveat: `marketCap` is always null on this endpoint (that's why we pair it with SEC);
  it's an **unofficial** endpoint (no SLA — could change without notice).

**SEC EDGAR XBRL API** (`data.sec.gov/api/xbrl/companyconcept/...`)
- **VERIFIED:** official, keyless (requires a `User-Agent` header). Returns
  `dei:EntityCommonStockSharesOutstanding` for **every** filer I tested incl. foreign
  ones (ASML, SAP, TSM, ARM, BABA), plus revenue and net income.
- **Market cap = SEC shares × Yahoo price.** Works for all US filers.
- Caveats: (1) TTM is fiddly — Q4 isn't filed as a standalone quarter, so naive
  4-quarter sums are wrong; safest is to use the latest annual figure or handle the
  XBRL frames carefully. (2) Foreign filers file IFRS (20-F), so `us-gaap` revenue is
  inconsistent for them — shares are fine, revenue may need fallbacks. (3) Foreign ADRs
  (TSM 1:5 etc.) need the ADR ratio applied or the derived cap is off.

| | |
| --- | --- |
| Cost | $0, no signup, no key |
| Coverage | Full ~200 universe (both sources cover the blocked names) |
| Rate limits | Generous; SEC asks for a real User-Agent + ~10 req/s politeness |
| Effort | **Highest** — two sources, a ticker→CIK map for SEC, SIC→industry mapping, TTM + ADR handling |
| Risk | Yahoo endpoint is unofficial |

**Pick this if:** the goal is the full top-200 for free and you're OK with me writing a
bit more glue code. This is the only verified path that's both free *and* full-universe.

---

## Option B — Finnhub  ·  *free, requires API key*  ·  simplest single provider

One provider, one key, REST JSON. Free tier is **60 calls/min** (no hard daily cap
documented). Has `/quote`, `/stock/metric` (market cap, P/E), `/stock/profile2`
(country, industry, shares), and basic financials.

| | |
| --- | --- |
| Cost | $0 with a free key (email signup) |
| Coverage | US stocks well covered; some non-US on free tier is limited |
| Effort | **Lowest** — single REST provider, closest to a drop-in for `fmp.ts` |
| Risk | **UNVERIFIED by me.** Free-tier market-cap + fundamentals coverage and the exact non-US support need a live probe before we commit. Free tier historically restricts some endpoints. |

**Pick this if:** you want the least code and are OK with me spending one round
verifying its free-tier coverage first (I won't trust the docs blindly).

---

## Option C — Alpha Vantage  ·  *free key, but too throttled*

Clean API with `GLOBAL_QUOTE`, `OVERVIEW` (market cap, P/E, sector), `INCOME_STATEMENT`.
**But the free tier is 25 requests/day.** For ~200 companies that's ~8 days to refresh
once. Realistically unusable here except as a tiny supplement.
**Pick this only if:** we stay at ~20 companies and want richer fundamentals than FMP.

---

## Option D — Paid FMP tier  ·  *~$22–29/mo*  ·  most reliable

Unlocks the screener + batch endpoints and the full symbol set; the code we already
wrote largely works as-is (drop `FMP_UNIVERSE_LIMIT`, restore the screener for the
universe). One provider, one schema, market cap + fundamentals + estimates all clean.
**Pick this if:** you decide reliability/low-effort is worth a small monthly cost. You
previously said no to paid — listing it for completeness.

---

## Option E — Stay on FMP free (25 companies)  ·  *$0, already done*

Do nothing. Ship the 25-company board. **Pick this if:** 25 names is enough for now and
you'd rather move on to UI/features than data plumbing.

---

## My recommendation

- **If you want the full top-200 for free → Option A (Yahoo v8 + SEC EDGAR).** It's the
  only path I *verified* to be both free and full-universe. Costs more code (two
  sources, CIK map, TTM/ADR handling), but no keys, no bills, no caps that matter.
- **If you want minimal code and will accept a quick verification round → Option B
  (Finnhub).** Could be the cleanest single-provider swap *if* its free tier checks out.
- **If 25 companies is fine for now → Option E**, and revisit later.

Tell me the letter and I'll implement it. If you pick **B**, I'll run a live free-tier
probe first and report coverage before writing the provider.

---

### Quick comparison

| Option | Cost | Key? | Full universe? | Market cap | Effort | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| A · Yahoo + SEC | $0 | none | ✅ | derived (shares×price) | High | ✅ |
| B · Finnhub | $0 | yes | ⚠️ likely | direct (if free tier allows) | Low | ❌ |
| C · Alpha Vantage | $0 | yes | ❌ (25/day) | direct | Low | ❌ |
| D · Paid FMP | ~$25/mo | yes | ✅ | direct | Low | ✅ |
| E · FMP free | $0 | yes | ❌ (27 max) | direct | done | ✅ |
