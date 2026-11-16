// A scripted local stand-in for Groq's chat completions API (C5A). Tests
// point GROQ_BASE_URL at it, so nothing ever reaches the real Groq API.
//
//   const stub = await startToolsStub();
//   stub.script([toolCall('search_leads', { text: 'Ann' }), answer('Call [lead:3] first.')]);
//   ... stub.requests  → every request body received, in order
//
// Each request takes the next scripted reply; a function reply gets
// (body, index) and returns one. When the script runs out, the last reply
// repeats. Every reply is a plain chat.completion with usage numbers.
const http = require('http');

let callSeq = 0;

/** A reply that asks for one or more tool calls: toolCall('get_lead', { lead_id: 1 }) or toolCall([[name, args], …]). */
function toolCall(nameOrList, args = {}) {
  const list = Array.isArray(nameOrList) ? nameOrList : [[nameOrList, args]];
  return {
    role: 'assistant',
    content: null,
    tool_calls: list.map(([name, a]) => {
      callSeq += 1;
      return {
        id: `call_${callSeq}`,
        type: 'function',
        function: { name, arguments: typeof a === 'string' ? a : JSON.stringify(a) },
      };
    }),
  };
}

/** A final answer. */
function answer(text) {
  return { role: 'assistant', content: text };
}

function completion(message) {
  return {
    id: `stub-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'stub',
    choices: [{ index: 0, finish_reason: message.tool_calls ? 'tool_calls' : 'stop', message }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

async function startToolsStub() {
  let replies = [answer('ok')];
  let status = 200;
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      const index = requests.length;
      requests.push(json);
      res.setHeader('Content-Type', 'application/json');
      if (status !== 200) {
        res.statusCode = status;
        res.end(JSON.stringify({ error: { message: 'stub failure' } }));
        return;
      }
      const next = replies[Math.min(index - stub.offset, replies.length - 1)];
      res.end(JSON.stringify(completion(typeof next === 'function' ? next(json, index) : next)));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stub = {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    offset: 0,
    /** New replies, starting with the next request. */
    script(list) {
      replies = list;
      stub.offset = requests.length;
      status = 200;
    },
    /** Every following request fails with this HTTP status (200 = back to normal). */
    fail(code) {
      status = code;
    },
    close: () => new Promise((r) => server.close(r)),
  };
  return stub;
}

module.exports = { startToolsStub, toolCall, answer };
