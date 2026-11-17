import { useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import StatCard from '../components/stats/StatCard';
import StateReport from '../components/stats/StateReport';
import ObjectionReport from '../components/stats/ObjectionReport';
import BestHoursTable from '../components/stats/BestHoursTable';
import StageFunnel from '../components/stats/StageFunnel';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import SectionLabel from '../components/ui/SectionLabel';
import Segmented from '../components/ui/Segmented';
import { useCampaign, fileLabel } from '../hooks/useCampaign';
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
  const [bestHours, setBestHours] = useState(null); // C6C
  const [funnel, setFunnel] = useState(null); // C6C
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // C1E: THIS FILE (the active file) or ALL FILES ('ALL' on every request).
  const { active } = useCampaign();
  const [scope, setScope] = useState('file');
  const [period, setPeriod] = useState({});
  const campaign = scope === 'all' ? 'ALL' : undefined;

  const load = (nextPeriod = period, nextCampaign = campaign) => {
    setError(null);
    setLoading(true);
    setPeriod(nextPeriod);
    return Promise.all([
      api.getTodayStats(nextPeriod, nextCampaign),
      api.getPerStateReport(nextCampaign),
      api.getManualCallsToday(nextPeriod, nextCampaign),
      api.getBestHours(nextCampaign),
      api.getFunnel(nextPeriod, nextCampaign),
    ])
      .then(([todayStats, perState, manual, best, stageFunnel]) => {
        setToday(todayStats);
        setStates(perState.states);
        setManualCalls(manual.calls);
        setBestHours(best);
        setFunnel(stageFunnel);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeScope = (next) => {
    setScope(next);
    load(period, next === 'all' ? 'ALL' : undefined);
  };

  const downloadPdf = (p) => api.downloadDailyPdf(p, campaign).catch((err) => setError(err.message));
  const periodLabel = today.period ? `${today.period.label} (${today.period.timezone})` : '';

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-5xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Reports</h1>
          <Segmented
            label="Report scope"
            options={[
              { value: 'file', label: 'This file' },
              { value: 'all', label: 'All files' },
            ]}
            value={scope}
            onChange={changeScope}
          />
        </div>
        <p className="label" data-testid="report-scope">{scope === 'all' ? 'All files' : fileLabel(active)}</p>
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
            {scope === 'all' ? (
              <p className="text-sm text-muted-foreground">Objections are reported per file. Choose THIS FILE to see them.</p>
            ) : (
              <ObjectionReport />
            )}
            {/* C6C */}
            <BestHoursTable data={bestHours} index="04" />
            <StageFunnel data={funnel} index="05" />
          </>
        )}
      </div>
    </AppShell>
  );
}
