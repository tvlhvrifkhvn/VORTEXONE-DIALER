// C7F: the panel's optional WEB switch. The question alone — never CRM data,
// never the conversation, no tools — goes to a Groq model with built-in web
// search (groq/compound). If the account can't use it, the answer says so.
const assistant = require('./index');
const { ApiError } = require('../../middleware/errorHandler');

const { client, writeLog, withDeadline, usageOf } = assistant._internals;

const WEB_MODEL = 'groq/compound';
const WEB_TIMEOUT_MS = 30000;
const MAX_QUESTION = 1000;
const MAX_ANSWER = 4000;

const SYSTEM = `You answer one question with a web search. You know nothing about the user's own data or CRM, and you must not ask for it.
Keep the answer to about 12 lines; short markdown lists are fine. Name the sites you used at the end ("Sources: …").`;

async function webAsk({ userId, campaignId, question }) {
  const started = Date.now();
  const totals = { prompt: 0, completion: 0 };
  let q = null;
  try {
    const { groq } = await client(); // the same key and on/off switch as the assistant
    if (typeof question !== 'string' || !question.trim()) throw new ApiError(400, 'Ask a question');
    q = question.trim();
    if (q.length > MAX_QUESTION) throw new ApiError(400, `A question is at most ${MAX_QUESTION} characters`);
    let completion;
    try {
      completion = await withDeadline(
        groq.chat.completions.create(
          { model: WEB_MODEL, temperature: 0.2, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: q }] },
          { timeout: WEB_TIMEOUT_MS, maxRetries: 0 }
        ),
        started + WEB_TIMEOUT_MS
      );
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if ([400, 403, 404].includes(err.status)) {
        throw new ApiError(502, `Web search isn't available on this Groq account (model ${WEB_MODEL}). Turn WEB off to ask about your data.`);
      }
      throw err;
    }
    usageOf(completion, totals);
    const answer = String(completion.choices?.[0]?.message?.content || '').trim().slice(0, MAX_ANSWER) || 'No answer came back from the web search.';
    await writeLog({ userId, campaignId, kind: 'ask', question: q, toolsCalled: [{ name: 'web_search', args: {} }], promptTokens: totals.prompt, completionTokens: totals.completion, ms: Date.now() - started });
    return { answer, web: true, model: WEB_MODEL, leadRefs: [], toolsUsed: ['web_search'], proposals: [] };
  } catch (err) {
    if (err.status === 400) throw err;
    await writeLog({ userId, campaignId, kind: 'ask', question: q, toolsCalled: [{ name: 'web_search', args: {} }], ms: Date.now() - started, error: err.code || err.message });
    if (err instanceof assistant.NotConfiguredError || err instanceof ApiError) throw err;
    console.warn(`[assistant] web answer failed after ${Date.now() - started}ms: ${err.message}`);
    throw new ApiError(502, "The web search couldn't answer right now. Try again in a moment.");
  }
}

module.exports = { WEB_MODEL, SYSTEM, webAsk };
