// STUB (test harness) — preloaded with NODE_OPTIONS=--require. Makes the mock
// telephony adapter behave like an adapter that never sends the optional
// 'busy' event: busy events are dropped, everything else passes through
// (a busy line then arrives only as 'ended'). Labelled "no-busy adapter".
const path = require('path');
// The server runs from <checkout>/backend, so patch that checkout's adapter.
const mock = require(path.resolve(process.cwd(), 'src/telephony/mockAdapter'));
const original = mock.placeCall;
mock.placeCall = (from, to, onEvent) => original(from, to, (event) => (event.type === 'busy' ? undefined : onEvent(event)));
