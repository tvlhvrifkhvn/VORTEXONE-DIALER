const { US_STATES } = require('./usStates');
const { STATE_NAMES, COUNTRY_TOKENS } = require('./stateFromAddressText');

/**
 * Grouping identity for "agents at the same office".
 *
 * A brand name alone is useless as a group — "Keller Williams" appears in
 * Boise, Houston and everywhere else — so the key is
 * brokerage + city + state. Two agents only count as colleagues when all
 * three agree.
 */

// Applied to the whole normalized string first, so "KW Boise" becomes
// "keller williams boise" before any suffix stripping happens.
const BROKERAGE_ALIASES = {
  kw: 'keller williams',
  bhgre: 'better homes and gardens real estate',
  bhhs: 'berkshire hathaway home services',
  cb: 'coldwell banker',
  c21: 'century 21',
  remax: 're max',
  exp: 'exp',
};

// Stripped only from the end of the name, repeatedly: "Smith Realty Group"
// → "smith". Never applied mid-string, so "Real Estate Gary Greene" keeps
// its distinguishing tail.
const TRAILING_GENERICS = [
  'real estate',
  'realty',
  'realtors',
  'realtor',
  'properties',
  'property',
  'group',
  'team',
  'associates',
  'company',
  'co',
  'inc',
  'llc',
  'lp',
  'plc',
];

function squash(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * lowercase, de-punctuated, alias-expanded, with trailing generic words
 * removed. Returns '' for anything that normalizes away to nothing.
 */
function normalizeBrokerage(raw) {
  let name = squash(raw);
  if (!name) return '';

  const aliased = name
    .split(' ')
    .map((word) => BROKERAGE_ALIASES[word] || word)
    .join(' ');
  name = squash(aliased);

  // Repeat so "keller williams realty group" reduces all the way down.
  let changed = true;
  while (changed) {
    changed = false;
    for (const generic of TRAILING_GENERICS) {
      if (name === generic) continue; // never strip the name down to nothing
      if (name.endsWith(` ${generic}`)) {
        name = name.slice(0, -(generic.length + 1)).trim();
        changed = true;
      }
    }
  }
  return name;
}

function isStateToken(part) {
  if (!part) return false;
  if (STATE_NAMES[part]) return true;
  return part.length === 2 && US_STATES.includes(part.toUpperCase());
}

/**
 * Pulls the city out of free-text address content, using the same two
 * address shapes stateFromAddressText.js already handles:
 *   "1200 Brickell Ave, Miami, FL" → "miami"
 *   "boise id usa"                 → "boise"
 *
 * Returns '' rather than guessing when the remaining text is clearly a
 * street line (leading house number) or nothing is left.
 */
function cityFromAddressText(text) {
  const cleanedInput = String(text || '').trim();
  if (!cleanedInput) return '';

  if (cleanedInput.includes(',')) {
    const parts = cleanedInput
      .split(',')
      .map((p) => squash(p))
      .filter(Boolean);
    // Drop trailing country/state parts: "…, Miami, FL" → "…, miami"
    while (parts.length > 1) {
      const last = parts[parts.length - 1];
      if (COUNTRY_TOKENS.has(last) || isStateToken(last)) parts.pop();
      else break;
    }
    const candidate = parts[parts.length - 1] || '';
    return /^\d/.test(candidate) ? '' : candidate;
  }

  const tokens = squash(cleanedInput).split(' ').filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (COUNTRY_TOKENS.has(last) || isStateToken(last)) tokens.pop();
    else break;
  }
  const candidate = tokens.join(' ');
  return /^\d/.test(candidate) ? '' : candidate;
}

/**
 * The stored grouping key, or null when there's no brokerage to group on —
 * leads with no brokerage must never be pooled together.
 * City may legitimately be empty (an address we can't parse a city from);
 * the key then falls back to brokerage + state, which still never merges
 * across states.
 */
function buildOfficeKey({ brokerage, address, city, state }) {
  const brand = normalizeBrokerage(brokerage);
  if (!brand) return null;

  const resolvedCity = squash(city) || cityFromAddressText(address);
  const resolvedState = String(state || '').trim().toUpperCase();

  return [brand, resolvedCity, resolvedState].join('|');
}

/** "keller williams|boise|ID" → "Keller Williams · Boise, ID" */
function officeLabelFromKey(officeKey, displayBrokerage) {
  if (!officeKey) return null;
  const [brand, city, state] = officeKey.split('|');
  const titled = (s) =>
    s
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');

  const brandLabel = displayBrokerage || titled(brand);
  const place = [city ? titled(city) : null, state || null].filter(Boolean).join(', ');
  return place ? `${brandLabel} · ${place}` : brandLabel;
}

module.exports = {
  normalizeBrokerage,
  cityFromAddressText,
  buildOfficeKey,
  officeLabelFromKey,
};
