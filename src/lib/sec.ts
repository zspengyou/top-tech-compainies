// SEC EDGAR provider — keyless, official. Supplies USD-normalized fundamentals:
// revenue and net income (earnings), from each company's XBRL company-facts.
//
// We deliberately use the latest ANNUAL (10-K, fiscal-year) figure rather than
// summing quarters: Q4 isn't filed as a standalone quarter, so naive 4-quarter TTM
// is wrong. Annual is in USD for US filers. Foreign private issuers file IFRS (20-F)
// and have no us-gaap facts, so they return null here — better a dash than a
// local-currency value masquerading as USD. Market cap / price come from Yahoo, so
// foreign names still rank by market cap; they just lack revenue/earnings.
//
// SEC requests a descriptive User-Agent with contact info and ~10 req/s politeness.

// SEC's WAF rejects User-Agents containing URLs/parentheses; it wants a plain
// "name email" string. Override via SEC_USER_AGENT with your own contact.
const SEC_UA = process.env.SEC_USER_AGENT ?? "top-tech-rankings contact@toptech.dev";

export type SecFundamentals = { revenue: number | null; earnings: number | null };

// SEC asks for <= ~10 requests/second. This spaces request *starts* ~120ms apart
// even across concurrent callers (lastStart is bumped synchronously before await).
let lastStart = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastStart + 120 - now);
  lastStart = Math.max(now, lastStart + 120);
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

// --- ticker -> CIK map (cached for the process) --------------------------------

let cikMap: Map<string, string> | null = null;

async function getCikMap(): Promise<Map<string, string>> {
  if (cikMap) return cikMap;
  const map = new Map<string, string>();
  try {
    await throttle();
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": SEC_UA },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, { ticker: string; cik_str: number }>;
      for (const v of Object.values(data)) {
        map.set(v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0"));
      }
    }
  } catch {
    // leave map empty; callers degrade to null fundamentals
  }
  cikMap = map;
  return map;
}

export async function hasCik(symbol: string): Promise<boolean> {
  return (await getCikMap()).has(symbol.toUpperCase());
}

// --- company facts -------------------------------------------------------------

type Fact = { val?: number; start?: string; end?: string; form?: string; fp?: string };
type Concept = { units?: Record<string, Fact[]> };
type CompanyFacts = { facts?: { "us-gaap"?: Record<string, Concept> } };

// Revenue is reported under several concept names depending on the filer/era.
const REVENUE_CONCEPTS = [
  "RevenueFromContractWithCustomerExcludingAssessedTax",
  "RevenueFromContractWithCustomerIncludingAssessedTax",
  "Revenues",
  "SalesRevenueNet",
];

// Number of days a fact's period spans (duration facts have start+end).
function spanDays(f: Fact): number {
  return (new Date(f.end!).getTime() - new Date(f.start!).getTime()) / 86_400_000;
}

// Latest annual (10-K, full fiscal year) USD value for a concept, or null. Filers
// sometimes tag quarterly facts as fp="FY" with the same end-date as the real annual,
// so we require a ~full-year span to exclude those before picking the newest.
function latestAnnualUSD(concept: Concept | undefined): Fact | null {
  const units = concept?.units?.USD;
  if (!units) return null;
  const annual = units.filter(
    (f) =>
      f.form === "10-K" &&
      f.fp === "FY" &&
      f.start &&
      f.end &&
      Number.isFinite(f.val) &&
      spanDays(f) >= 330, // a full fiscal year, not a quarter
  );
  if (annual.length === 0) return null;
  annual.sort((a, b) => (a.end! < b.end! ? 1 : -1)); // newest end-date first
  return annual[0];
}

// Returns fundamentals, or `undefined` when the lookup *failed* (network/HTTP error)
// so the caller can keep the previous snapshot's values instead of nulling them. A
// successful lookup with no us-gaap data (foreign IFRS filers) returns explicit nulls.
export async function fetchFundamentals(symbol: string): Promise<SecFundamentals | undefined> {
  const cik = (await getCikMap()).get(symbol.toUpperCase());
  if (!cik) return { revenue: null, earnings: null }; // not an SEC filer: genuine no-data

  try {
    await throttle();
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: { "User-Agent": SEC_UA },
    });
    if (!res.ok) return undefined; // throttled/transient -> reuse prior, retry later
    const facts = ((await res.json()) as CompanyFacts).facts?.["us-gaap"] ?? {};

    // Revenue: pick the concept whose latest annual value is the most recent overall
    // (filers migrate between concept names, leaving stale data under old ones).
    let revenue: Fact | null = null;
    for (const name of REVENUE_CONCEPTS) {
      const cand = latestAnnualUSD(facts[name]);
      if (cand && (!revenue || cand.end! > revenue.end!)) revenue = cand;
    }
    const earnings = latestAnnualUSD(facts["NetIncomeLoss"]);

    return {
      revenue: revenue?.val ?? null,
      earnings: earnings?.val ?? null,
    };
  } catch {
    return undefined; // network error -> reuse prior, retry later
  }
}
