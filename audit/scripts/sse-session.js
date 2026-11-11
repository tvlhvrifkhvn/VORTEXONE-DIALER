// Drives a real multi-line dialing session over the API while listening to the
// SSE stream, and prints every event the server pushed.
// Usage: node audit/scripts/sse-session.js <tokenfile> <lineCount> <seconds> [steps-json]
//   steps-json: [{"at":5,"do":"dispose","slot":"active","disposition":"contacted"},
//                {"at":8,"do":"release","slot":"active"}, {"at":12,"do":"stop"},
//                {"at":6,"do":"closeSSE"}, {"at":9,"do":"openSSE"}]
// The outcome of each mock call is controlled separately via
// audit/stubs/force-outcome.js (file /var/tmp/audit-scratch/force-outcome).
const fs = require('fs');
const API = process.env.API || 'http://localhost:4000';
const [tokenFile, lineCount, seconds, stepsJson] = process.argv.slice(2);
const token = fs.readFileSync(tokenFile, 'utf8').trim();
const steps = JSON.parse(stepsJson || '[]');
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5);
const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const events = [];
const slots = {}; // slot -> latest {status, leadId, callId}
let maxLive = 0;
let ctl = null;

async function openSSE() {
  ctl = new AbortController();
  const res = await fetch(`${API}/api/calls/stream?token=${token}`, { signal: ctl.signal });
  console.log(`${ts()}s SSE opened (HTTP ${res.status})`);
  (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk);
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const e = JSON.parse(line.slice(6));
          events.push(e);
          slots[e.slotNumber] = { status: e.status, leadId: e.leadId, callId: e.callId };
          const live = Object.values(slots).filter((s) => ['dialing', 'ringing', 'answered', 'held'].includes(s.status)).length;
          maxLive = Math.max(maxLive, live);
          console.log(`${ts()}s slot ${e.slotNumber} ${String(e.status).padEnd(10)} lead=${e.leadId ?? '-'} call=${e.callId ?? '-'}${e.message ? ' msg=' + e.message : ''}${e.promotedFromHold ? ' (promoted from hold)' : ''}`);
        }
      }
    } catch (err) { if (err.name !== 'AbortError') console.log('SSE error', err.message); }
  })();
}
async function post(path, body) {
  const r = await fetch(API + path, { method: 'POST', headers: H, body: JSON.stringify(body || {}) });
  const txt = await r.text();
  console.log(`${ts()}s POST ${path} ${JSON.stringify(body || {})} -> ${r.status} ${txt.slice(0, 220)}`);
  try { return JSON.parse(txt); } catch { return {}; }
}
const activeSlot = () => Object.entries(slots).find(([, s]) => s.status === 'answered')?.[0];

(async () => {
  await openSSE();
  const s = await post('/api/sessions/start', { mode: 'multiline' });
  await post('/api/calls/multiline/start', { sessionId: s.sessionId, lineCount: Number(lineCount) });
  const pending = [...steps].sort((a, b) => a.at - b.at);
  while ((Date.now() - t0) / 1000 < Number(seconds)) {
    while (pending.length && (Date.now() - t0) / 1000 >= pending[0].at) {
      const st = pending.shift();
      const slot = st.slot === 'active' ? activeSlot() : st.slot;
      if (st.do === 'dispose') {
        const callId = slot ? slots[slot].callId : null;
        console.log(`${ts()}s >> dispose slot ${slot} call ${callId} as ${st.disposition}`);
        if (callId) await post('/api/dispositions', { callId, disposition: st.disposition });
      } else if (st.do === 'release') await post('/api/calls/multiline/release', { slotNumber: Number(slot) });
      else if (st.do === 'stop') await post('/api/calls/multiline/stop', {});
      else if (st.do === 'take') await post('/api/calls/multiline/take', { slotNumber: Number(slot) });
      else if (st.do === 'drop') await post('/api/calls/multiline/drop', { slotNumber: Number(slot) });
      else if (st.do === 'closeSSE') { ctl.abort(); console.log(`${ts()}s >> SSE connection closed by client`); }
      else if (st.do === 'openSSE') await openSSE();
      else if (st.do === 'forceOutcome') { fs.writeFileSync('/var/tmp/audit-scratch/force-outcome', st.value || ''); console.log(`${ts()}s >> force-outcome = ${st.value || '(random)'}`); }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  ctl.abort();
  const byStatus = {};
  for (const e of events) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  console.log(`\nSUMMARY sessionId=${s.sessionId} events=${events.length} byStatus=${JSON.stringify(byStatus)} maxConcurrentLiveSlots=${maxLive} (lineCount=${lineCount})`);
  console.log(`SESSION_ID=${s.sessionId}`);
  process.exit(0);
})();
