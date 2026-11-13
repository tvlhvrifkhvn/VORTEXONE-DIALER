import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import StatCard from '../components/stats/StatCard';
import StateReport from '../components/stats/StateReport';
import ObjectionReport from '../components/stats/ObjectionReport';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
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
    <NeuCard className="flex flex-wrap items-end gap-3 p-4">
      <label className="text-xs font-medium text-text-secondary">
        From
        <NeuInput type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block" aria-label="From" />
      </label>
      <label className="text-xs font-medium text-text-secondary">
        To
        <NeuInput type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block" aria-label="To" />
      </label>
      <NeuButton onClick={() => onApply(range)} disabled={busy || Boolean(from) !== Boolean(to)}>Show</NeuButton>
      <NeuButton onClick={() => { setFrom(''); setTo(''); onApply({}); }} disabled={busy}>Today</NeuButton>
      <NeuButton onClick={() => onPdf(range)} disabled={busy || Boolean(from) !== Boolean(to)}>Download PDF</NeuButton>
    </NeuCard>
  );
}

function ManualCallsSection({ calls }) {
  if (calls.length === 0) return null;

  return (
    <NeuCard className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-text-primary">Manual calls in this period</h2>
      <ul className="divide-y divide-shadow/20">
        {calls.map((call) => (
          <li key={call.id} className="flex items-center justify-between py-2 text-sm">
            <span className="font-mono text-text-primary">{call.to_number}</span>
            <span className="text-text-secondary">{formatTime(call.started_at)}</span>
            <span className="text-text-secondary">{formatDuration(call.duration_seconds)}</span>
          </li>
        ))}
      </ul>
    </NeuCard>
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
      <div className="mx-auto mt-4 max-w-4xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary">Reports</h1>
        <PeriodPicker onApply={load} onPdf={downloadPdf} busy={loading} />
        {periodLabel && <p className="text-sm text-text-secondary" data-testid="report-period">{periodLabel}</p>}
        {error && <p className="text-sm text-action-hangup">{error}</p>}

        <div className="flex flex-wrap gap-4">
          <StatCard label="Dials" value={today.dials} />
          <StatCard label="Contacts" value={today.contacts} />
          <StatCard label="Connect rate" value={`${today.connectRate}%`} />
        </div>

        {loading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
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
