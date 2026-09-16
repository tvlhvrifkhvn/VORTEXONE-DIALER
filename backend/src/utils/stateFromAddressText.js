const { US_STATES } = require('./usStates');

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

const COUNTRY_TOKENS = new Set(['usa', 'us']);

/**
 * Deterministic (no AI, no guessing) extraction of a US state from free-text
 * address-like content — e.g. "1200 Brickell Ave, Miami, Florida" or the
 * scraped-site pattern "boise id usa". Two matching rules only, both
 * unambiguous:
 *  1. A full state name appears anywhere in the text.
 *  2. A 2-letter state code token is immediately followed by "usa"/"us" —
 *     this is what makes "boise id usa" resolve to ID without also matching
 *     a stray real word like "in"/"or"/"me" that happens to also be a state
 *     abbreviation elsewhere in normal text.
 * Returns null (never a guess) when neither rule matches.
 */
function stateFromAddressText(text) {
  if (!text) return null;
  const cleaned = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

  for (const [name, abbr] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(cleaned)) return abbr;
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    const candidate = tokens[i].toUpperCase();
    if (US_STATES.includes(candidate) && COUNTRY_TOKENS.has(tokens[i + 1])) {
      return candidate;
    }
  }

  return null;
}

module.exports = { stateFromAddressText };
