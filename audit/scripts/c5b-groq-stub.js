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
  const system = (body.messages || [])[0]?.content || '';
  const question = [...(body.messages || [])].reverse().find((m) => m.role === 'user')?.content || '';
  // C5C: the brief, the two drafts, and proposals.
  if (!body.tools && /morning brief/.test(system)) {
    const facts = JSON.parse(body.messages[1].content);
    const c = facts.candidates || [];
    return answer(JSON.stringify({
      note: 'No callbacks or tasks due yet; the queue is full of fresh leads, so dial early while the East Coast is open.',
      callFirst: c.slice(0, 4).map((l, i) => ({ id: l.id, reason: ['Never dialed, in the queue and inside calling hours.', 'Fresh lead at a busy brokerage.', 'Same office as a lead you reached.', 'Queued longest in this state.'][i] })),
    }));
  }
  if (!body.tools && /You draft a text/.test(system)) {
    return answer('{"text": "Hi Karen, Talha from Vortexone here. Following up on our chat: we can take lead follow-up and appointment setting off your plate. Open to a 10-minute call this week?"}');
  }
  if (!body.tools && /You draft a short email/.test(system)) {
    return answer('{"subject": "Quick follow-up", "body": "Hi Karen,\\n\\nThanks for your time earlier. We help agents with lead follow-up and appointment setting so you can stay with clients.\\n\\nWould a 10-minute call this week work?\\n\\nTalha, Vortexone"}');
  }
  if (body.tools && /^Plan /.test(question)) {
    const toolMsgs = (body.messages || []).filter((m) => m.role === 'tool');
    if (toolMsgs.length === 0) return toolCall('get_pipeline', {});
    if (toolMsgs.length === 1) {
      const file = JSON.parse(toolMsgs[0].content).files[0];
      const interested = file.stages.find((st) => st.name === 'Interested');
      return toolCall([
        ['propose_task', { lead_id: 1, title: 'Call back about the trial offer', due_at: new Date(Date.now() + 864e5).toISOString().slice(0, 11) + '15:00:00Z', type: 'call' }],
        ['propose_stage', { lead_id: 1, stage_id: interested.id }],
      ]);
    }
    return answer('I suggest a callback tomorrow and moving [lead:1] to Interested. Confirm below if that looks right.');
  }
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
