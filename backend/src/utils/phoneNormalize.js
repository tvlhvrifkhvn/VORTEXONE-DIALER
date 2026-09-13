const COUNTRY_CODE = '1';

/**
 * Normalizes a US/Canada (NANP) phone number to E.164 (+1XXXXXXXXXX).
 * Returns null if the input isn't a valid 10-digit NANP number.
 */
function normalizePhone(raw) {
  if (!raw) return null;

  const digits = String(raw).replace(/\D/g, '');

  let tenDigit;
  if (digits.length === 10) {
    tenDigit = digits;
  } else if (digits.length === 11 && digits.startsWith(COUNTRY_CODE)) {
    tenDigit = digits.slice(1);
  } else {
    return null;
  }

  // NANP: area code and exchange code can't start with 0 or 1.
  if (/^[01]/.test(tenDigit.slice(0, 1)) || /^[01]/.test(tenDigit.slice(3, 4))) {
    return null;
  }

  return `+${COUNTRY_CODE}${tenDigit}`;
}

/** Extracts the 3-digit NANP area code from an E.164 US number, or null. */
function areaCodeFromE164(e164) {
  if (!e164 || !e164.startsWith('+1') || e164.length !== 12) return null;
  return e164.slice(2, 5);
}

module.exports = { normalizePhone, areaCodeFromE164 };
