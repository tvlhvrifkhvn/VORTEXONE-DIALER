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

module.exports = { SCHEMA_FIELDS, mapColumns, guessStates };
