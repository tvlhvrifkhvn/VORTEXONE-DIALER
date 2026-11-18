// Uploads a CSV through the import API (auto mapping), processes it, waits,
// prints the result summary as JSON. Usage: node seg9-import.js <tokenFile> <csv>
const fs = require('fs');
const path = require('path');
const API = process.env.API || 'http://localhost:4000';
const [tokenFile, file] = process.argv.slice(2);
const token = fs.readFileSync(tokenFile, 'utf8').trim();
const H = { authorization: `Bearer ${token}` };
(async () => {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const up = await (await fetch(`${API}/api/imports/upload`, { method: 'POST', headers: H, body: form })).json();
  if (!up.jobId) { console.log(JSON.stringify({ error: up })); return; }
  await fetch(`${API}/api/imports/process`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ jobId: up.jobId, mapping: up.mapping }) });
  for (let i = 0; i < 60; i++) {
    const st = await (await fetch(`${API}/api/imports/status/${up.jobId}`, { headers: H })).json();
    if (!['pending', 'processing'].includes(st.status)) { console.log(JSON.stringify(st.summary || st.result_summary || st)); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(JSON.stringify({ error: 'timeout' }));
})();
