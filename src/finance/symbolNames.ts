/**
 * Ticker → the name a person would recognise.
 *
 * ⚠️ DELIBERATELY PARTIAL, AND THAT IS THE DESIGN RATHER THAN AN UNFINISHED JOB. A ticker is
 * unambiguous and a remembered company name is not: several of the 78 symbols the fund holds are
 * small issuers whose names I am not certain of, and a confidently wrong name under a ticker on a
 * page a child reads is worse in every way than a ticker on its own. So anything not here renders
 * as the ticker alone with an empty second line — never "Unknown", which is a label pretending to
 * be information.
 *
 * ⚠️ IT IS ALSO NOT A PRICE FEED OR A SOURCE OF TRUTH. It exists because `Holding` carries no
 * name field and the overview wants one for recognition. If a name here is ever wrong, the only
 * thing that breaks is the second line of a row; nothing computes from it.
 *
 * The `Q` suffix on a US ticker means the issuer is in bankruptcy proceedings and the listing has
 * moved off the main exchange, so those say so rather than reading like an ordinary holding.
 */
export const SYMBOL_NAMES: Readonly<Record<string, string>> = {
  AAPL: 'Apple',
  ABR: 'Arbor Realty Trust',
  ADCT: 'ADC Therapeutics',
  AFCG: 'Advanced Flower Capital',
  ATYR: 'aTyr Pharma',
  AUDC: 'AudioCodes',
  BTC: 'Bitcoin',
  CABO: 'Cable One',
  CCOI: 'Cogent Communications',
  CRGY: 'Crescent Energy',
  CXAI: 'CXApp',
  DPRO: 'Draganfly',
  EXOD: 'Exodus Movement',
  FMC: 'FMC Corporation',
  HPE: 'Hewlett Packard Enterprise',
  HUMA: 'Humacyte',
  IFRX: 'InflaRx',
  IP: 'International Paper',
  KO: 'Coca-Cola',
  KTOS: 'Kratos Defense & Security',
  LCID: 'Lucid Group',
  MBLY: 'Mobileye',
  MDXH: 'MDxHealth',
  MSFT: 'Microsoft',
  MYPS: 'PlayStudios',
  NKE: 'Nike',
  NSP: 'Insperity',
  NWL: 'Newell Brands',
  OCCI: 'OFS Credit Company',
  OFS: 'OFS Capital',
  OVV: 'Ovintiv',
  PCT: 'PureCycle Technologies',
  PD: 'PagerDuty',
  PEP: 'PepsiCo',
  PZZA: "Papa John's",
  RC: 'Ready Capital',
  RHI: 'Robert Half',
  SDGR: 'Schrödinger',
  SMSI: 'Smith Micro Software',
  SOUN: 'SoundHound AI',
  SPCE: 'Virgin Galactic',
  STTK: 'Shattuck Labs',
  TCPC: 'BlackRock TCP Capital',
  TROX: 'Tronox',
  VOO: 'Vanguard S&P 500 ETF',
  WEN: "Wendy's",
  WHF: 'WhiteHorse Finance',
}

/** the recognisable name for a ticker, or null when there isn't one worth showing */
export function nameFor(symbol: string): string | null {
  return SYMBOL_NAMES[symbol.toUpperCase()] ?? null
}
