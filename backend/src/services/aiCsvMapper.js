const Groq = require('groq-sdk');
const config = require('../config');
const { ApiError } = require('../middleware/errorHandler');

const MODEL = 'llama3-8b-8192';
const SCHEMA_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];
const LOW_CONFIDENCE = 'low';

function client() {
  if (!config.groqApiKey) {
    throw new ApiError(503, 'GROQ_API_KEY is not configured — AI column mapping is unavailable');
  }
  return new Groq({ apiKey: config.groqApiKey });
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

  const completion = await client().chat.completions.create({
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

module.exports = { SCHEMA_FIELDS, mapColumns };
