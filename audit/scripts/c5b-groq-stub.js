// C5B gate: a local Groq stand-in for the assistant screenshots, built on
// backend/tests/stubs/groq-tools-stub.js. Start the backend with
// GROQ_BASE_URL=http://127.0.0.1:<port> (printed on start).
//   ask:     search_leads first, then an answer linking the first lead found
//   summary: a JSON summary (a request without tools)
// Usage: node audit/scripts/c5b-groq-stub.js [port]
const http = require('http');
const { toolCall, answer } = require('../../backend/tests/stubs/groq-tools-stub');

const port = Number(process.argv[2]) || 4599;

function reply(body) {
  if (!body.tools) {
    return answer(
      '{"summary": "Agent at a mid-size brokerage, reached once and asked for pricing by email. Interested but busy until next week.", "nextStep": "Call back Tuesday morning with the two-week trial offer.", "objections": ["Too busy right now", "Already has an assistant"]}'
    );
  }
  const toolMsgs = (body.messages || []).filter((m) => m.role === 'tool');
  if (toolMsgs.length === 0) return toolCall('search_leads', { status: 'in_queue' });
  let leads = [];
  try {
    leads = JSON.parse(toolMsgs[0].content).leads || [];
  } catch {
    /* no leads */
  }
  const [a, b] = leads;
  if (!a) return answer("I couldn't find any queued leads in this file.");
  return answer(
    `Start with [lead:${a.id}]: in the queue, ${a.state || 'state unknown'} is inside calling hours now.` +
      (b ? `\nThen [lead:${b.id}], also queued in ${b.state || 'an unknown state'}.` : '') +
      '\nBoth have no task yet; add one after the call.'
  );
}

function completion(message) {
  return {
    id: 'stub', object: 'chat.completion', created: 0, model: 'stub',
    choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(completion(reply(JSON.parse(raw || '{}')))));
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`groq stub on http://127.0.0.1:${port}`));
