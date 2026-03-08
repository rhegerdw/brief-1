/**
 * Territory extraction utilities for franchise/multi-location company differentiation.
 *
 * Extracts territory (city/metro) from company names, email domains, and other context
 * BEFORE the company upsert, enabling (name + territory) matching.
 */

// US state abbreviations for location extraction
const US_STATES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', 'tennessee': 'TN',
  'texas': 'TX', 'utah': 'UT', 'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA',
  'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
}

const STATE_ABBRS = new Set(Object.values(US_STATES))

// Major US cities mapped to their states for quick lookup
const MAJOR_CITIES: Record<string, string> = {
  // Pennsylvania
  'pittsburgh': 'PA', 'philadelphia': 'PA', 'philly': 'PA', 'pgh': 'PA',
  'harrisburg': 'PA', 'allentown': 'PA', 'erie': 'PA',
  // Texas
  'houston': 'TX', 'dallas': 'TX', 'austin': 'TX', 'san antonio': 'TX',
  'fort worth': 'TX', 'el paso': 'TX', 'dfw': 'TX', 'plano': 'TX',
  // California
  'los angeles': 'CA', 'la': 'CA', 'san francisco': 'CA', 'sf': 'CA',
  'san diego': 'CA', 'san jose': 'CA', 'sacramento': 'CA', 'oakland': 'CA',
  'fresno': 'CA', 'bay area': 'CA', 'silicon valley': 'CA',
  // New York
  'new york': 'NY', 'nyc': 'NY', 'manhattan': 'NY', 'brooklyn': 'NY',
  'buffalo': 'NY', 'rochester': 'NY', 'albany': 'NY',
  // Florida
  'miami': 'FL', 'tampa': 'FL', 'orlando': 'FL', 'jacksonville': 'FL',
  'fort lauderdale': 'FL', 'st petersburg': 'FL',
  // Illinois
  'chicago': 'IL', 'chi': 'IL', 'naperville': 'IL', 'aurora': 'IL',
  // Ohio
  'columbus': 'OH', 'cleveland': 'OH', 'cincinnati': 'OH', 'toledo': 'OH',
  'akron': 'OH', 'dayton': 'OH',
  // Georgia
  'atlanta': 'GA', 'atl': 'GA', 'savannah': 'GA', 'augusta': 'GA',
  // North Carolina
  'charlotte': 'NC', 'raleigh': 'NC', 'durham': 'NC', 'greensboro': 'NC',
  // Michigan
  'detroit': 'MI', 'grand rapids': 'MI', 'ann arbor': 'MI',
  // Arizona
  'phoenix': 'AZ', 'tucson': 'AZ', 'scottsdale': 'AZ', 'mesa': 'AZ',
  // Washington
  'seattle': 'WA', 'tacoma': 'WA', 'spokane': 'WA',
  // Colorado
  'denver': 'CO', 'colorado springs': 'CO', 'boulder': 'CO',
  // Massachusetts
  'boston': 'MA', 'cambridge': 'MA', 'worcester': 'MA',
  // Virginia
  'virginia beach': 'VA', 'norfolk': 'VA', 'richmond': 'VA', 'arlington': 'VA',
  // Tennessee
  'nashville': 'TN', 'memphis': 'TN', 'knoxville': 'TN', 'chattanooga': 'TN',
  // Maryland
  'baltimore': 'MD', 'bethesda': 'MD',
  // Missouri
  'kansas city': 'MO', 'st louis': 'MO', 'st. louis': 'MO',
  // Indiana
  'indianapolis': 'IN', 'indy': 'IN', 'fort wayne': 'IN',
  // Wisconsin
  'milwaukee': 'WI', 'madison': 'WI',
  // Minnesota
  'minneapolis': 'MN', 'st paul': 'MN', 'twin cities': 'MN',
  // Oregon
  'portland': 'OR',
  // Nevada
  'las vegas': 'NV', 'vegas': 'NV', 'reno': 'NV',
  // Louisiana
  'new orleans': 'LA', 'nola': 'LA', 'baton rouge': 'LA',
  // Kentucky
  'louisville': 'KY', 'lexington': 'KY',
  // Oklahoma
  'oklahoma city': 'OK', 'okc': 'OK', 'tulsa': 'OK',
  // Connecticut
  'hartford': 'CT', 'new haven': 'CT', 'stamford': 'CT',
  // Utah
  'salt lake city': 'UT', 'slc': 'UT', 'provo': 'UT',
  // Alabama
  'birmingham': 'AL', 'montgomery': 'AL', 'mobile': 'AL',
  // South Carolina
  'charleston': 'SC', 'columbia': 'SC', 'greenville': 'SC',
  // New Mexico
  'albuquerque': 'NM', 'santa fe': 'NM',
  // DC Metro
  'washington dc': 'DC', 'washington': 'DC', 'dc': 'DC', 'dmv': 'DC',
}

// Territory aliases for normalization
const TERRITORY_ALIASES: Record<string, string> = {
  'philly': 'philadelphia',
  'pgh': 'pittsburgh',
  'nyc': 'new york',
  'la': 'los angeles',
  'sf': 'san francisco',
  'dfw': 'dallas',
  'chi': 'chicago',
  'atl': 'atlanta',
  'dmv': 'washington dc',
  'nola': 'new orleans',
  'indy': 'indianapolis',
  'okc': 'oklahoma city',
  'slc': 'salt lake city',
  'vegas': 'las vegas',
}

export interface TerritoryResult {
  territory: string  // City/metro name (e.g., "Pittsburgh")
  state: string      // State abbreviation (e.g., "PA")
  source: 'company_name' | 'email_subdomain' | 'email_domain_city' | 'inferred'
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Normalize a territory name for consistent matching
 */
export function normalizeTerritory(territory: string): string {
  const lower = territory.toLowerCase().trim()
  return TERRITORY_ALIASES[lower] || lower
}

/**
 * Check if two territories refer to the same location
 */
export function territoriesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const normA = normalizeTerritory(a)
  const normB = normalizeTerritory(b)
  return normA === normB || normA.includes(normB) || normB.includes(normA)
}

/**
 * Get state abbreviation from a city name
 */
export function getStateFromCity(city: string): string | null {
  const normalized = city.toLowerCase().trim()
  return MAJOR_CITIES[normalized] || null
}

/**
 * Get state abbreviation from full state name
 */
export function getStateAbbreviation(stateName: string): string | null {
  const normalized = stateName.toLowerCase().trim()
  if (STATE_ABBRS.has(normalized.toUpperCase())) {
    return normalized.toUpperCase()
  }
  return US_STATES[normalized] || null
}

/**
 * Check if a string is a known US city
 */
export function isKnownCity(text: string): boolean {
  return text.toLowerCase().trim() in MAJOR_CITIES
}

/**
 * Extract territory from company name patterns like:
 * - "ServiceMaster of Houston"
 * - "Stratus Engineering Pittsburgh"
 * - "ABC Company - Dallas"
 * - "XYZ Philadelphia Office"
 */
function extractFromCompanyName(companyName: string): TerritoryResult | null {
  if (!companyName) return null

  // Pattern: "Company of City" or "Company in City"
  const ofMatch = companyName.match(/^(.+?)\s+(?:of|in)\s+([A-Za-z\s]+)$/i)
  if (ofMatch) {
    const city = ofMatch[2].trim()
    const state = getStateFromCity(city)
    if (state) {
      return {
        territory: city,
        state,
        source: 'company_name',
        confidence: 'high'
      }
    }
  }

  // Pattern: "Company - City" or "Company | City"
  const dashMatch = companyName.match(/^(.+?)\s*[-|]\s*([A-Za-z\s]+)$/i)
  if (dashMatch) {
    const city = dashMatch[2].trim()
    const state = getStateFromCity(city)
    if (state) {
      return {
        territory: city,
        state,
        source: 'company_name',
        confidence: 'high'
      }
    }
  }

  // Pattern: "Company City" (city at end) - check last word(s)
  const words = companyName.split(/\s+/)
  // Try last two words (for "New York", "Los Angeles", etc.)
  if (words.length >= 2) {
    const lastTwo = words.slice(-2).join(' ')
    const state = getStateFromCity(lastTwo)
    if (state) {
      return {
        territory: lastTwo,
        state,
        source: 'company_name',
        confidence: 'medium'
      }
    }
  }
  // Try last word
  if (words.length >= 1) {
    const lastOne = words[words.length - 1]
    const state = getStateFromCity(lastOne)
    if (state) {
      return {
        territory: lastOne,
        state,
        source: 'company_name',
        confidence: 'medium'
      }
    }
  }

  return null
}

/**
 * Extract territory from email subdomain like:
 * - joe@pittsburgh.servicemaster.com -> "Pittsburgh"
 * - info@houston.stratus.com -> "Houston"
 */
function extractFromEmailSubdomain(email: string): TerritoryResult | null {
  if (!email || !email.includes('@')) return null

  const domain = email.split('@')[1]
  if (!domain) return null

  const parts = domain.split('.')
  if (parts.length < 3) return null // Need subdomain.company.tld

  const subdomain = parts[0].toLowerCase()
  const state = getStateFromCity(subdomain)

  if (state) {
    return {
      territory: subdomain,
      state,
      source: 'email_subdomain',
      confidence: 'high'
    }
  }

  return null
}

/**
 * Extract territory from email domain containing city like:
 * - joe@servicemaster-houston.com -> "Houston"
 * - info@stratusdallas.com -> "Dallas"
 */
function extractFromEmailDomainCity(email: string): TerritoryResult | null {
  if (!email || !email.includes('@')) return null

  const domain = email.split('@')[1]
  if (!domain) return null

  const domainWithoutTld = domain.split('.')[0].toLowerCase()

  // Check if domain contains a city name
  for (const [city, state] of Object.entries(MAJOR_CITIES)) {
    if (domainWithoutTld.includes(city.replace(/\s+/g, ''))) {
      return {
        territory: city,
        state,
        source: 'email_domain_city',
        confidence: 'medium'
      }
    }
  }

  return null
}

/**
 * Main entry point: extract territory from available context.
 * Tries multiple sources in priority order.
 */
export function extractTerritory(ctx: {
  companyName?: string
  email?: string
}): TerritoryResult | null {
  // 1. Try company name (highest priority - most explicit)
  if (ctx.companyName) {
    const fromName = extractFromCompanyName(ctx.companyName)
    if (fromName) return fromName
  }

  // 2. Try email subdomain
  if (ctx.email) {
    const fromSubdomain = extractFromEmailSubdomain(ctx.email)
    if (fromSubdomain) return fromSubdomain
  }

  // 3. Try email domain containing city
  if (ctx.email) {
    const fromDomain = extractFromEmailDomainCity(ctx.email)
    if (fromDomain) return fromDomain
  }

  return null
}

/**
 * Parse "City, ST" format into territory and state
 */
export function parseLocationString(location: string): { territory: string; state: string } | null {
  if (!location) return null

  // "City, ST" format
  const match = location.match(/^([A-Za-z\s]+),\s*([A-Z]{2})$/i)
  if (match) {
    const state = match[2].toUpperCase()
    if (STATE_ABBRS.has(state)) {
      return {
        territory: match[1].trim(),
        state
      }
    }
  }

  // Just city name
  const state = getStateFromCity(location)
  if (state) {
    return {
      territory: location.trim(),
      state
    }
  }

  return null
}
