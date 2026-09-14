const Groq = require('groq-sdk');
const config = require('../config');
const { ApiError } = require('../middleware/errorHandler');

const MODEL = 'llama3-8b-8192';

function client() {
  if (!config.groqApiKey) {
    throw new ApiError(503, 'GROQ_API_KEY is not configured — note expansion is unavailable');
  }
  return new Groq({ apiKey: config.groqApiKey });
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

  const completion = await client().chat.completions.create({
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
