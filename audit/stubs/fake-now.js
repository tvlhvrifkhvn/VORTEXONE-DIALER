// STUB (test harness) — preloaded with NODE_OPTIONS=--require. Shifts the Node
// process clock so that "now" starts at $FAKE_NOW (ISO) and then advances in
// real time. Only the Node side moves; Postgres now() is unaffected.
// Labelled "controlled clock" in the report.
if (process.env.FAKE_NOW) {
  const offset = Date.parse(process.env.FAKE_NOW) - Date.now();
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
    static now() { return RealDate.now() + offset; }
  }
  global.Date = FakeDate;
}
