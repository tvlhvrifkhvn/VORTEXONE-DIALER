const Groq = require('groq-sdk');
const config = require('../config');
const settingsStore = require('./settings');
const { ApiError } = require('../middleware/errorHandler');

// llama3-8b-8192, then its successor llama-3.1-8b-instant, were both
// decommissioned by Groq. openai/gpt-oss-20b is Groq's current recommended
// replacement for that small/cheap tier.
const MODEL = 'openai/gpt-oss-20b';

if (!process.env.GROQ_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn('GROQ_API_KEY not set — AI note expansion will be unavailable');
}

/** Settings-table value (Settings → Integrations) takes priority over .env,
 * matching aiCsvMapper.js. */
async function resolveApiKey() {
  const stored = await settingsStore.getSetting('groq-key');
  return stored || config.groqApiKey || null;
}

async function client() {
  const apiKey = await resolveApiKey();
  if (!apiKey) return null;
  return new Groq({ apiKey });
}

const SYSTEM_PROMPT =
  'You clean up rough, shorthand call notes taken by a cold-calling sales rep into ' +
  'clear, professional sentences. Keep every fact from the original note — do not add ' +
  'information that was not stated. Do not invent names, numbers, or outcomes. Respond ' +
  'with only the rewritten note text, no preamble, no quotes.';

/**
 * Sends a rough note (e.g. "interested busy till friday has 2 agents") to
 * Groq and returns a clean, professional rewrite. Used by the "Expand" button
 * on the call screen's notes field.
 */
async function expandNote(roughText) {
  const trimmed = (roughText || '').trim();
  if (!trimmed) {
    throw new ApiError(400, 'note text is required');
  }

  const groq = await client();
  if (!groq) return trimmed;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: trimmed },
    ],
  });

  const expanded = completion.choices?.[0]?.message?.content?.trim();
  if (!expanded) {
    throw new ApiError(502, 'AI note expansion returned an empty response');
  }
  return expanded;
}

module.exports = { expandNote };
