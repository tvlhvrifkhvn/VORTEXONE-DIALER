import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import StatCard from '../components/stats/StatCard';
import StateReport from '../components/stats/StateReport';
import * as api from '../lib/api';

export default function Reports() {
  const [today, setToday] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [states, setStates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getTodayStats(), api.getPerStateReport()])
      .then(([todayStats, perState]) => {
        setToday(todayStats);
        setStates(perState.states);
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

        {loading ? <p className="text-sm text-text-secondary">Loading…</p> : <StateReport states={states} />}
      </div>
    </AppShell>
  );
}
