const Groq = require('groq-sdk');
const config = require('../config');
const settingsStore = require('./settings');
const { US_STATES } = require('../utils/usStates');
const { ApiError } = require('../middleware/errorHandler');

const STATE_GUESS_BATCH_SIZE = 25;
// Hard ceiling on how many rows get an AI state guess per import — this is
// a last-resort fallback after deterministic address parsing and area-code
// lookup both fail, not the primary path, so it's capped for cost and speed.
const MAX_STATE_GUESS_ROWS = 200;

// llama3-8b-8192, then its successor llama-3.1-8b-instant, were both
// decommissioned by Groq. openai/gpt-oss-20b is Groq's current recommended
// replacement for that small/cheap tier — gpt-oss-120b is the (pricier)
// replacement for the larger 70b-class models, not needed here.
const MODEL = 'openai/gpt-oss-20b';
const SCHEMA_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];
const LOW_CONFIDENCE = 'low';
const UNAVAILABLE_MESSAGE = 'AI mapping unavailable — please map columns manually.';

if (!process.env.GROQ_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn('GROQ_API_KEY not set — AI CSV mapping will be unavailable');
}

/** The settings table (configurable from Settings → Integrations) takes
 * priority over the .env value, so the key can be set from the UI without
 * redeploying. */
async function resolveApiKey() {
  const stored = await settingsStore.getSetting('groq-key');
  return stored || config.groqApiKey || null;
}

async function client() {
  const apiKey = await resolveApiKey();
  if (!apiKey) return null;
  return new Groq({ apiKey });
}

function unavailableResult() {
  const mapping = {};
  const confidence = {};
  for (const field of SCHEMA_FIELDS) {
    mapping[field] = null;
    confidence[field] = 'low';
  }
  return { mapping, confidence, needsReview: [...SCHEMA_FIELDS], unavailable: true, message: UNAVAILABLE_MESSAGE };
}

function buildPrompt(headers, sampleRows) {
  const sample = sampleRows
    .map((row, i) => `Row ${i + 1}: ${JSON.stringify(row)}`)
    .join('\n');

  return `You are mapping CSV columns from a real-estate agent lead list onto a fixed schema.

Schema fields: ${SCHEMA_FIELDS.join(', ')}

CSV headers: ${JSON.stringify(headers)}

Sample rows:
${sample}

For each schema field, pick the CSV header that best matches it (or null if no header matches).
Respond with ONLY a JSON object, no prose, in exactly this shape:
{
  "mapping": { "name": "<header or null>", "phone": "<header or null>", "email": "<header or null>", "address": "<header or null>", "brokerage": "<header or null>", "state": "<header or null>" },
  "confidence": { "name": "high|medium|low", "phone": "high|medium|low", "email": "high|medium|low", "address": "high|medium|low", "brokerage": "high|medium|low", "state": "high|medium|low" }
}`;
}

function safeParseJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new ApiError(502, 'AI mapping response was not valid JSON');
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    throw new ApiError(502, `AI mapping response was not valid JSON: ${err.message}`);
  }
}

/**
 * Asks Groq to map raw CSV headers (plus a few sample rows for context) onto
 * our fixed lead schema. Returns the mapping plus a needsReview list for any
 * field the model wasn't confident about, so the UI can flag it for a human.
 */
async function mapColumns(headers, sampleRows = []) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new ApiError(400, 'headers must be a non-empty array');
  }

  const groq = await client();
  if (!groq) return unavailableResult();

  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [{ role: 'user', content: buildPrompt(headers, sampleRows.slice(0, 3)) }],
  });

  const text = completion.choices?.[0]?.message?.content || '';
  const parsed = safeParseJson(text);

  const mapping = {};
  const confidence = {};
  const needsReview = [];

  for (const field of SCHEMA_FIELDS) {
    const header = parsed.mapping?.[field];
    mapping[field] = header && headers.includes(header) ? header : null;
    const fieldConfidence = (parsed.confidence?.[field] || 'low').toLowerCase();
    confidence[field] = fieldConfidence;
    if (!mapping[field] || fieldConfidence === LOW_CONFIDENCE) {
      needsReview.push(field);
    }
  }

  return { mapping, confidence, needsReview };
}

const CLEAN_BATCH_SIZE = 20;

function buildCleaningPrompt(batch) {
  const rows = batch.map((r) => `${r.index}: ${JSON.stringify(r.fields)}`).join('\n');

  return `You are a data cleaning assistant. Clean each row of real estate agent data:

1. NAME cleaning rules:
   - Remove anything matching "License #: [alphanumeric]"
   - Remove " - null" or "null" anywhere in the name
   - Remove brokerage/company names mixed into the name field (e.g. "MARKET CENTER", "Keller Williams Realty Boise", "Coldwell Banker")
   - Keep only "First Last" or "First Middle Last" format
   - If you cannot extract a real person name, mark the row as SKIP

2. STATE cleaning rules:
   - Extract only the 2-letter US state code
   - "boise id usa" → "ID", "miami florida" → "FL", "austin tx" → "TX"
   - If state cannot be determined, leave blank

3. ADDRESS cleaning rules:
   - If address contains city+state+country mixed like "boise id usa", extract just the city: "Boise"
   - Keep proper street addresses as-is

Rows (index: fields):
${rows}

Return ONLY a JSON array with the same number of rows, no prose, each shaped:
[{"index": 0, "name": "<cleaned>", "state": "<2-letter or empty>", "address": "<cleaned>", "skip": false}]
Mark any unrecoverable row with "skip": true.`;
}

/**
 * Second Groq pass, run after column mapping: cleans the actual row values
 * (license numbers and brokerage names glued into the name field, "boise id
 * usa" in place of a state, and so on). Returns { rows, cleaned, skipped }
 * where rows are the surviving rows with cleaned values applied.
 *
 * Safety: the model's output is only ever used to overwrite name/state/
 * address, and each value is sanity-checked before it's accepted — a state
 * has to be a real US code, a name has to be non-empty and free of the junk
 * patterns. When the key isn't configured or a batch fails, the original
 * rows pass through untouched so the import still works.
 */
async function cleanRows(rows, mapping) {
  const result = { rows, cleanedCount: 0, skippedCount: 0, originals: new Map() };
  if (!Array.isArray(rows) || rows.length === 0) return result;
  if (!mapping || !mapping.name) return result;

  const groq = await client();
  if (!groq) return result;

  const cleanedByIndex = new Map();
  const skipped = new Set();

  for (let i = 0; i < rows.length; i += CLEAN_BATCH_SIZE) {
    const batch = rows.slice(i, i + CLEAN_BATCH_SIZE).map((row, offset) => ({
      index: i + offset,
      fields: {
        name: row[mapping.name] ?? '',
        state: mapping.state ? row[mapping.state] ?? '' : '',
        address: mapping.address ? row[mapping.address] ?? '' : '',
      },
    }));

    try {
      const completion = await groq.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [{ role: 'user', content: buildCleaningPrompt(batch) }],
      });
      const text = completion.choices?.[0]?.message?.content || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) continue;

      for (const entry of JSON.parse(match[0])) {
        if (typeof entry?.index !== 'number' || !rows[entry.index]) continue;
        if (entry.skip === true) {
          skipped.add(entry.index);
          continue;
        }
        cleanedByIndex.set(entry.index, entry);
      }
    } catch {
      // A failed batch leaves those rows as-is rather than dropping them.
    }
  }

  const surviving = [];
  rows.forEach((row, index) => {
    if (skipped.has(index)) {
      result.skippedCount += 1;
      return;
    }

    const cleaned = cleanedByIndex.get(index);
    if (!cleaned) {
      surviving.push(row);
      return;
    }

    const next = { ...row };
    let changed = false;

    const cleanName = typeof cleaned.name === 'string' ? cleaned.name.trim() : '';
    // Reject a "cleaned" name that is empty or still carries the junk we
    // asked it to strip — better to keep the original than trust a bad edit.
    if (cleanName && !/license\s*#|null/i.test(cleanName) && cleanName !== String(row[mapping.name] ?? '').trim()) {
      result.originals.set(surviving.length, String(row[mapping.name] ?? ''));
      next[mapping.name] = cleanName;
      changed = true;
    }

    const cleanState = typeof cleaned.state === 'string' ? cleaned.state.trim().toUpperCase() : '';
    if (mapping.state && US_STATES.includes(cleanState) && cleanState !== String(row[mapping.state] ?? '').trim()) {
      next[mapping.state] = cleanState;
      changed = true;
    }

    const cleanAddress = typeof cleaned.address === 'string' ? cleaned.address.trim() : '';
    if (mapping.address && cleanAddress && cleanAddress !== String(row[mapping.address] ?? '').trim()) {
      next[mapping.address] = cleanAddress;
      changed = true;
    }

    if (changed) result.cleanedCount += 1;
    surviving.push(next);
  });

  result.rows = surviving;
  return result;
}

function buildStateGuessPrompt(batch) {
  const lines = batch
    .map((r) => `${r.index}: name="${r.name || ''}", address="${r.address || ''}", brokerage="${r.brokerage || ''}"`)
    .join('\n');

  return `Each line below is a US real-estate lead with no recognizable state on file. Guess the
2-letter US state code ONLY when the text plainly implies one (e.g. a city you're certain is in
that state, or a state name/abbreviation embedded in the text). If you are not confident, answer
null — never guess randomly.

${lines}

Respond with ONLY a JSON array, no prose, shaped exactly like:
[{"index": 0, "state": "ID"}, {"index": 1, "state": null}]`;
}

/**
 * Last-resort AI fallback for rows where neither the mapped state column,
 * deterministic address-text parsing, nor phone area code produced a valid
 * state (see csvImport.js). Every answer is validated against US_STATES
 * before use — an invalid or hallucinated code is silently discarded, same
 * as a "null" answer, so a bad guess never corrupts a lead's state (state
 * drives calling-hours enforcement, see CLAUDE.md).
 */
async function guessStates(candidates) {
  const results = new Map();
  if (!Array.isArray(candidates) || candidates.length === 0) return results;

  const groq = await client();
  if (!groq) return results;

  const capped = candidates.slice(0, MAX_STATE_GUESS_ROWS);
  for (let i = 0; i < capped.length; i += STATE_GUESS_BATCH_SIZE) {
    const batch = capped.slice(i, i + STATE_GUESS_BATCH_SIZE);
    try {
      const completion = await groq.chat.completions.create({
        model: MODEL,
        temperature: 0,
        messages: [{ role: 'user', content: buildStateGuessPrompt(batch) }],
      });
      const text = completion.choices?.[0]?.message?.content || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      for (const entry of parsed) {
        const state = (entry?.state || '').toUpperCase();
        if (US_STATES.includes(state)) results.set(entry.index, state);
      }
    } catch {
      // A malformed/failed batch just means those rows stay unresolved —
      // never propagate a guess we couldn't validate.
    }
  }
  return results;
}

module.exports = { SCHEMA_FIELDS, mapColumns, guessStates, cleanRows };
