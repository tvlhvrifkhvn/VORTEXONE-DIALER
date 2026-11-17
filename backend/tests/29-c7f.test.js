// C7F: the smarter assistant, against the scripted local Groq stub only.
// "How do I create a task" → get_app_help with the guide's task section; a
// general question → the general-advice line and no tool calls; data
// questions still use tools and cite leads; the new tools keep the privacy
// rules; WEB sends only the question (no CRM data, no history, no tools).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const tools = require('../src/services/assistant/tools');
const assistant = require('../src/services/assistant');
const web = require('../src/services/assistant/web');
const { startToolsStub, toolCall, answer } = require('./stubs/groq-tools-stub');

let stub;
let rep;
let lead;
const SECRET_PHONE = '+12145550177';
const SECRET_EMAIL = 'zed.secret@example.com';

const sent = () => stub.requests.slice(stub.offset);
const toolMessages = (body) => (body.messages || []).filter((m) => m.role === 'tool');

before(async () => {
  await h.setupFile();
  rep = await h.createUser({ role: 'rep' });
  lead = await h.createLead({ name: 'Zed Secretname', phone: SECRET_PHONE, email: SECRET_EMAIL, state: 'TX' });
  await h.db.query("UPDATE campaigns SET pitch_script = $1, daily_goal = 80 WHERE id = 1", [`Hi, call me at ${SECRET_PHONE} or ${SECRET_EMAIL}.`]);
  stub = await startToolsStub();
  process.env.GROQ_BASE_URL = stub.url;
});

after(() => stub.close());

test('the system prompt states the three kinds of answers, the model, and the general-advice line', async () => {
  stub.script([answer('Hi.')]);
  await rep.api.post('/api/assistant/ask', { question: 'Hello' });
  const system = sent()[0].messages[0].content;
  assert.match(system, /YOUR DATA/);
  assert.match(system, /HOW TO USE VORTEX ONE OUTREACH/);
  assert.match(system, /GENERAL KNOWLEDGE AND ADVICE/);
  assert.ok(system.includes(assistant.GENERAL_ADVICE_LINE));
  assert.match(system, /You run on the Groq model openai\/gpt-oss-120b/);
  assert.equal(sent()[0].tools.length, 16);
});

test('"how do I create a task" calls get_app_help and gets the guide\'s task section', async () => {
  stub.script([toolCall('get_app_help', { topic: 'create a task' }), answer('Open the lead, then ADD TASK in the top bar.')]);
  const res = await rep.api.post('/api/assistant/ask', { question: 'How do I create a task?' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.toolsUsed, ['get_app_help']);
  const result = JSON.parse(toolMessages(sent()[1])[0].content);
  assert.equal(result.sections[0].title, 'Add a task');
  assert.match(result.sections[0].body, /ADD TASK/);
  // No topic lists the guide's sections.
  const list = await tools.run('get_app_help', {}, { campaignId: 1, seen: new Map() });
  assert.ok(list.topics.includes('Make a smart list or a list') && list.topics.includes('Hotkeys on the call screen'));
});

test('a general question returns the general-advice line and no tool calls', async () => {
  stub.script([answer(`${assistant.GENERAL_ADVICE_LINE}\n- Lead with a question about their week.\n- Keep the first 20 seconds about them.`)]);
  const res = await rep.api.post('/api/assistant/ask', { question: 'How should I open a cold call to a real estate agent?' });
  assert.equal(res.status, 200);
  assert.ok(res.body.answer.startsWith(assistant.GENERAL_ADVICE_LINE));
  assert.deepEqual(res.body.toolsUsed, []);
  assert.equal(sent().length, 1, 'one request, no tool round');
});

test('data questions still use tools and cite leads', async () => {
  stub.script([toolCall('search_leads', { text: 'Zed' }), answer(`Call [lead:${lead.id}] first.`)]);
  const res = await rep.api.post('/api/assistant/ask', { question: 'Who is Zed?' });
  assert.deepEqual(res.body.toolsUsed, ['search_leads']);
  assert.deepEqual(res.body.leadRefs, [{ id: lead.id, name: 'Zed Secretname' }]);
});

test('the new tools keep the privacy rules (no full phone, no email) and work in a file and ALL', async () => {
  const ctx = { campaignId: 1, seen: new Map() };
  const results = [
    await tools.run('get_best_times', { lead_id: lead.id }, ctx),
    await tools.run('get_best_times', { state: 'TX' }, ctx),
    await tools.run('get_objections', {}, ctx),
    await tools.run('get_funnel', { period: 'this month' }, ctx),
    await tools.run('get_file', {}, ctx),
    await tools.run('get_file', {}, { campaignId: 'ALL', seen: new Map() }),
    await tools.run('get_funnel', {}, { campaignId: 'ALL', seen: new Map() }),
  ];
  const text = JSON.stringify(results);
  assert.ok(!text.includes(SECRET_PHONE) && !text.includes('2145550177'), 'no full phone');
  assert.ok(!text.includes(SECRET_EMAIL), 'no email');
  assert.equal(results[4].daily_goal, 80);
  assert.match(results[4].pitch_script, /…0177/);
  assert.equal(results[0].lead_id, lead.id);
  assert.equal(results[0].text, 'Not enough data yet');
  assert.ok(ctx.seen.has(lead.id), 'a best-times lead can be linked');
  await assert.rejects(() => tools.run('get_best_times', { state: 'Texas' }, ctx), /state is at most 2 characters/);
  await assert.rejects(() => tools.run('get_best_times', { state: 'T1' }, ctx), /2-letter/);
  await assert.rejects(() => tools.run('get_funnel', { period: 'last year' }, ctx), /period must be one of/);
});

test('WEB sends only the question: no CRM data, no history, no tools', async () => {
  stub.script([answer('Agents in Texas often prefer texts.\nSources: example.org')]);
  const res = await rep.api.post('/api/assistant/web', {
    question: 'When do real estate agents prefer calls?',
    history: [{ role: 'user', content: 'Zed Secretname is my best lead' }],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.web, true);
  assert.deepEqual(res.body.leadRefs, []);
  const body = sent()[0];
  assert.equal(body.model, web.WEB_MODEL);
  assert.equal(body.tools, undefined);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[1].content, 'When do real estate agents prefer calls?');
  const text = JSON.stringify(body);
  // The question itself mentions real estate; nothing else from the CRM may appear.
  assert.ok(!/Zed|Secretname|2145550177|zed\.secret|FILE 01|Vortexone Agency offers|Brokerage|tool_call/i.test(text), text);
  // The account can't use web search: a clear message.
  stub.fail(404);
  const off = await rep.api.post('/api/assistant/web', { question: 'Anything?' });
  stub.fail(200);
  assert.equal(off.status, 502);
  assert.match(off.body.error, /Web search isn't available on this Groq account/);
  assert.equal((await rep.api.post('/api/assistant/web', { question: '' })).status, 400);
});
