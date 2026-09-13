import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import StateSidebar from '../components/layout/StateSidebar';
import LeadTable from '../components/leads/LeadTable';
import LeadFilters from '../components/leads/LeadFilters';
import StatCard from '../components/stats/StatCard';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import ActionButton from '../components/ui/ActionButton';
import { useLeads, useStateCounts } from '../hooks/useLeads';
import * as api from '../lib/api';

const EMPTY_FILTERS = { search: '', status: '', dateFrom: '', dateTo: '', state: null };

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const { leads, total, loading, refresh } = useLeads(filters);
  const { counts, refresh: refreshCounts } = useStateCounts();
  const [stats, setStats] = useState({ dials: 0, contacts: 0, connectRate: 0 });
  const [dialMode, setDialMode] = useState('power');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const load = () => api.getTodayStats().then(setStats).catch(() => {});
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const handleSnooze = async (id) => {
    await api.snoozeLead(id);
    refresh();
    refreshCounts();
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.downloadDailyPdf();
    } catch (err) {
      window.alert(`Couldn't export PDF: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto mt-4 flex max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap gap-4">
          <StatCard label="Dials today" value={stats.dials} />
          <StatCard label="Contacts today" value={stats.contacts} />
          <StatCard label="Connect rate" value={`${stats.connectRate}%`} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ActionButton variant="call" className="btn-glow" onClick={() => navigate('/call/next')}>
              Start Dialing
            </ActionButton>
            <NeuButton onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export PDF'}
            </NeuButton>
          </div>

          <div className="flex items-center gap-1 rounded-input bg-surface p-1 shadow-neu-inset">
            <button
              type="button"
              onClick={() => setDialMode('power')}
              className={`rounded-input px-3 py-1.5 text-xs font-medium transition-shadow ${
                dialMode === 'power' ? 'shadow-neu-sm text-text-primary' : 'text-text-secondary'
              }`}
            >
              Power dial
            </button>
            <button
              type="button"
              disabled
              title="Multi-line dialing arrives in phase 3"
              className="cursor-not-allowed rounded-input px-3 py-1.5 text-xs font-medium text-text-secondary/50"
            >
              Multi-line
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row">
          <StateSidebar
            counts={counts}
            selectedState={filters.state}
            onSelectState={(state) => setFilters((f) => ({ ...f, state }))}
          />

          <div className="flex-1 space-y-3">
            <NeuCard className="p-3">
              <LeadFilters filters={filters} onChange={setFilters} />
            </NeuCard>
            <div className="text-xs text-text-secondary">{total} lead{total === 1 ? '' : 's'}</div>
            <LeadTable leads={leads} loading={loading} onSnooze={handleSnooze} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
