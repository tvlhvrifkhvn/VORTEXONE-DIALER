import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import StatCard from '../components/stats/StatCard';
import StateReport from '../components/stats/StateReport';
import ObjectionReport from '../components/stats/ObjectionReport';
import NeuCard from '../components/ui/NeuCard';
import { formatDuration, formatTime } from '../lib/format';
import * as api from '../lib/api';

/** Today's ad-hoc dial-pad calls — these have no lead/state, so they can't
 * appear in the per-state breakdown above and get their own small list. */
function ManualCallsSection({ calls }) {
  if (calls.length === 0) return null;

  return (
    <NeuCard className="space-y-3 p-4">
      <h2 className="text-sm font-semibold text-text-primary">Manual calls today</h2>
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

  useEffect(() => {
    Promise.all([api.getTodayStats(), api.getPerStateReport(), api.getManualCallsToday()])
      .then(([todayStats, perState, manual]) => {
        setToday(todayStats);
        setStates(perState.states);
        setManualCalls(manual.calls);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-4xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary">Reports</h1>

        <div className="flex flex-wrap gap-4">
          <StatCard label="Dials today" value={today.dials} />
          <StatCard label="Contacts today" value={today.contacts} />
          <StatCard label="Connect rate today" value={`${today.connectRate}%`} />
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
