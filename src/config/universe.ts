// Static curated universe of large/mid-cap technology tickers.
//
// WHY STATIC: the free data sources (Yahoo, SEC) have no tech-sector screener, so
// the universe is hand-curated rather than discovered at refresh time. Ranking is
// still data-driven — each refresh prices these symbols and sorts by market cap /
// revenue / earnings — so the ORDER here does not matter, only membership.
//
// MAINTENANCE: add or remove tickers here to change the universe. Yahoo prices every
// symbol each run (batched, cheap); SEC fundamentals + Yahoo history are reused and
// only refreshed in a rotating slice, so a large list stays inexpensive. Invalid/
// delisted symbols simply return no quote and are dropped — prune them when noticed.

const FULL_UNIVERSE: string[] = [
  // Mega & large cap
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "TSM", "ORCL",
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

// One ticker per company — dual-class lines (e.g. Alphabet's GOOG vs GOOGL) are
// pruned in the list above so a company isn't double-counted in the rankings.
export const TECH_UNIVERSE: string[] = [...new Set(FULL_UNIVERSE)];
