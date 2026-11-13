const COUNTRY_CODE = '1';

// A trailing extension: "x123", "x 123", "ext 123", "ext. 123", "extension 123", "#123".
const EXTENSION_PATTERN = /\s*[,;]?\s*(?:x|ext\.?|extension|#)\s*(\d{1,6})\s*$/i;
// A vanity number: starts with digits (at least the area code side), then
// letters, e.g. "602-555-CALL" or "1-800-FLOWERS". Text that starts with a
// letter ("call office", "n/a") is never treated as a vanity number.
const VANITY_PATTERN = /^[\s\d().+-]*\d[\s\d().+-]*[A-Za-z][A-Za-z\d\s.-]*$/;
const KEYPAD = {
  A: 2, B: 2, C: 2, D: 3, E: 3, F: 3, G: 4, H: 4, I: 4, J: 5, K: 5, L: 5, M: 6,
  N: 6, O: 6, P: 7, Q: 7, R: 7, S: 7, T: 8, U: 8, V: 8, W: 9, X: 9, Y: 9, Z: 9,
};

/** 10 digits, or 11 starting with the country code, as a valid NANP E.164 number; else null. */
function toE164(digits) {
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

/**
 * Reads a phone number the way people type it into spreadsheets:
 * "(602) 555-0605", "602.555.0605", "+1 602 555 0605", "1-602-555-0605",
 * "602-555-0605 x123" / "ext. 123" (the extension is kept separately),
 * and vanity numbers like "602-555-CALL" (letters → keypad digits).
 *
 * Returns { e164, extension, original, unreadable }:
 *   e164        +1XXXXXXXXXX, or null when no valid US number is in the text
 *   extension   digits after x / ext, only when e164 was found
 *   original    the trimmed raw text (null when blank)
 *   unreadable  true when there was text but no valid number in it
 */
function parsePhone(raw) {
  const original = raw == null ? '' : String(raw).trim();
  if (!original) return { e164: null, extension: null, original: null, unreadable: false };

  let text = original;
  let extension = null;
  const ext = text.match(EXTENSION_PATTERN);
  if (ext && /\d/.test(text.slice(0, ext.index))) {
    extension = ext[1];
    text = text.slice(0, ext.index);
  }

  let e164 = toE164(text.replace(/\D/g, ''));
  if (!e164 && VANITY_PATTERN.test(text)) {
    const keyed = text.toUpperCase().replace(/[A-Z]/g, (ch) => String(KEYPAD[ch]));
    e164 = toE164(keyed.replace(/\D/g, ''));
  }

  return { e164, extension: e164 ? extension : null, original, unreadable: !e164 };
}

/**
 * Normalizes a US/Canada (NANP) phone number to E.164 (+1XXXXXXXXXX).
 * Returns null if the input isn't a valid 10-digit NANP number. Accepts the
 * same formats as parsePhone (an extension is ignored here).
 */
function normalizePhone(raw) {
  return parsePhone(raw).e164;
}

/** Extracts the 3-digit NANP area code from an E.164 US number, or null. */
function areaCodeFromE164(e164) {
  if (!e164 || !e164.startsWith('+1') || e164.length !== 12) return null;
  return e164.slice(2, 5);
}

module.exports = { normalizePhone, parsePhone, areaCodeFromE164 };
