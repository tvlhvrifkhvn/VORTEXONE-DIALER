import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import StatCard from '../components/stats/StatCard';
import StateReport from '../components/stats/StateReport';
import ObjectionReport from '../components/stats/ObjectionReport';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import SectionLabel from '../components/ui/SectionLabel';
import { formatDuration, formatTime } from '../lib/format';
import * as api from '../lib/api';

/** Today's ad-hoc dial-pad calls — these have no lead/state, so they can't
 * appear in the per-state breakdown above and get their own small list. */
/** From / To picker (local date-times in the reporting timezone). Empty = today. */
function PeriodPicker({ onApply, onPdf, busy }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = from && to ? { from, to } : {};
  return (
    <Panel className="flex flex-wrap items-end gap-4 p-4">
      <label className="label">
        From
        <Field type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-2 block font-mono text-sm normal-case tracking-normal" aria-label="From" />
      </label>
      <label className="label">
        To
        <Field type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="mt-2 block font-mono text-sm normal-case tracking-normal" aria-label="To" />
      </label>
      <Button variant="primary" onClick={() => onApply(range)} disabled={busy || Boolean(from) !== Boolean(to)}>Show</Button>
      <Button onClick={() => { setFrom(''); setTo(''); onApply({}); }} disabled={busy}>Today</Button>
      <Button onClick={() => onPdf(range)} disabled={busy || Boolean(from) !== Boolean(to)}>Export PDF ↓</Button>
    </Panel>
  );
}

function ManualCallsSection({ calls }) {
  if (calls.length === 0) return null;

  return (
    <section>
      <SectionLabel index="03" title="Manual calls in this period" className="mb-2" />
      <Panel className="px-4 py-2">
        <ul className="divide-y">
          {calls.map((call) => (
            <li key={call.id} className="flex items-center justify-between py-2 font-mono text-sm tabular-nums">
              <span className="text-foreground">{call.to_number}</span>
              <span className="text-muted-foreground">{formatTime(call.started_at)}</span>
              <span className="text-muted-foreground">{formatDuration(call.duration_seconds)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

export default function Reports() {
  const [today, setToday] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [states, setStates] = useState([]);
  const [manualCalls, setManualCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = (period = {}) => {
    setError(null);
    setLoading(true);
    return Promise.all([api.getTodayStats(period), api.getPerStateReport(), api.getManualCallsToday(period)])
      .then(([todayStats, perState, manual]) => {
        setToday(todayStats);
        setStates(perState.states);
        setManualCalls(manual.calls);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const downloadPdf = (period) => api.downloadDailyPdf(period).catch((err) => setError(err.message));
  const periodLabel = today.period ? `${today.period.label} (${today.period.timezone})` : '';

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-5xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Reports</h1>
        <PeriodPicker onApply={load} onPdf={downloadPdf} busy={loading} />
        {periodLabel && <p className="label" data-testid="report-period">{periodLabel}</p>}
        {error && (
          <p role="alert" className="text-sm text-signal">
            <span className="label mr-2 text-signal">Error</span>
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-4">
          <StatCard label="Dials" value={today.dials} />
          <StatCard label="Contacts" value={today.contacts} />
          <StatCard label="Connect rate" value={`${today.connectRate}%`} />
        </div>

        {loading ? (
          <p className="label">Loading…</p>
        ) : (
          <>
            <StateReport states={states} />
            <ManualCallsSection calls={manualCalls} />
            <ObjectionReport />
          </>
        )}
      </div>
    </AppShell>
  );
}
