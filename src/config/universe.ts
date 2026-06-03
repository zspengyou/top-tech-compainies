// Static curated universe of large/mid-cap technology tickers.
//
// WHY STATIC: FMP's free tier no longer includes the company-screener endpoint
// (HTTP 402), so we can't discover the universe at refresh time. This hand-curated
// list replaces it. Ranking is still data-driven — each refresh prices these
// symbols and sorts by market cap / revenue / earnings — so the ORDER here does
// not matter, only membership.
//
// MAINTENANCE: add or remove tickers here to change the universe. Every symbol
// costs one `quote` call per refresh, and the free tier caps at ~250 calls/day, so
// keep this around ~200. Invalid/delisted symbols simply return no quote and are
// dropped (their slot is wasted, so prune them when noticed).

// Symbols FMP's FREE tier actually returns a /quote for (verified 2026-06-02 by
// scanning the whole list — everything else 402s on free). Listed first so
// FMP_UNIVERSE_LIMIT=N picks accessible names. The full list below is kept for a
// future paid tier, where the screener/batch endpoints unlock the rest.
export const FMP_FREE_TIER: string[] = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSM", "AMD", "ADBE", "CSCO",
  "INTC", "PLTR", "NOK", "BIDU", "BABA", "SHOP", "NFLX", "UBER", "PINS", "SNAP",
  "RBLX", "DOCU", "ZM", "HOOD", "COIN", "PYPL", "SOFI",
];

const FULL_UNIVERSE: string[] = [
  // Mega & large cap
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "AVGO", "TSM", "ORCL",
  "CRM", "AMD", "ADBE", "SAP", "ASML", "CSCO", "ACN", "TXN", "QCOM", "INTU",
  "IBM", "AMAT", "NOW", "ARM", "MU", "ADI", "LRCX", "KLAC", "PANW", "SNPS",
  "CDNS", "ANET", "INTC", "APH", "MRVL", "CRWD", "MSI", "ADSK", "FTNT", "ROP",
  "NXPI", "TEL", "MCHP", "WDAY", "DELL", "SNOW", "FICO", "IT", "CTSH", "HPQ",
  "GLW", "HPE", "KEYS", "ON", "MPWR", "TYL", "ANSS", "GRMN", "CDW", "NTAP",
  "SMCI", "STX", "WDC", "ZS", "TER", "PLTR", "DDOG", "TEAM", "HUBS", "NET",
  "ENPH", "GFS", "SWKS", "QRVO", "ZBRA", "JNPR", "FFIV", "AKAM", "EPAM", "JBL",
  "FLEX", "SNX", "GEN", "PTC", "TRMB",
  // International / ADRs
  "NOK", "ERIC", "STM", "INFY", "WIT", "UMC", "ASX", "NICE", "CHKP", "NTES",
  "BIDU", "JD", "PDD", "BABA", "TME", "SE", "GRAB", "MELI", "SHOP", "SPOT",
  // Internet / software growth
  "NFLX", "UBER", "ABNB", "DASH", "PINS", "SNAP", "RDDT", "RBLX", "U", "APP",
  "DOCU", "ZM", "BOX", "DBX", "WIX", "PCTY", "PAYC", "MNDY", "S", "OKTA",
  "TWLO", "PATH", "BILL", "DT", "ESTC", "CFLT", "GTLB", "DOCN", "AI", "HOOD",
  "COIN", "AFRM", "PYPL", "XYZ", "SOFI", "CYBR", "TENB", "RPD", "QLYS", "VRNS",
  "BSY", "MANH", "DSGX", "DOCS", "CVLT", "PEGA", "PRGS", "BL", "APPF", "ASAN",
  "FIVN", "NCNO", "RNG", "ALRM", "KVYO", "TOST", "GLBE", "FOUR",
  // Semiconductors & hardware (mid cap)
  "CRUS", "SLAB", "LSCC", "POWI", "SITM", "AMBA", "ALGM", "DIOD", "FORM", "ONTO",
  "ACLS", "CAMT", "COHR", "LITE", "IPGP", "NVMI", "KLIC", "ENTG", "AZTA", "AEIS",
  "VRT", "CIEN", "CALX", "EXTR", "NTGR", "FN", "CLS", "SANM", "PLXS", "BHE",
  "OSIS", "VSH", "LFUS", "OLED", "ROG", "ST", "NVT", "AOSL", "CRDO", "ALAB",
  // IT services
  "DXC", "G", "EXLS", "CNXC", "DOX", "UI",
];

// Free-tier-accessible symbols first, then the rest (deduped). Order only affects
// which symbols a FMP_UNIVERSE_LIMIT prefix selects; ranking is always by metric.
export const TECH_UNIVERSE: string[] = [...new Set([...FMP_FREE_TIER, ...FULL_UNIVERSE])];
