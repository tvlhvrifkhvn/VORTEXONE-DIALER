import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import MultilinePanel from '../components/call/MultilinePanel';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import { useMultiline } from '../hooks/useMultiline';
import { endDialingSession, getActiveSessionId } from '../hooks/useCall';

function formatMinutes(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Shown when the rep ends the session — summarizes the session just ended,
 * using the stats POST /api/sessions/end returns. Moved here from
 * Dashboard.jsx along with dialing itself. */
function SessionSummaryModal({ stats, abandonedCount = 0, onClose }) {
  if (!stats) return null;
  const elapsed = formatMinutes(new Date(stats.ended_at).getTime() - new Date(stats.started_at).getTime());

  const rows = [
    ['Dials made', stats.total_dials],
    ['Contacts', stats.total_contacts],
    ['Voicemails', stats.total_voicemails],
    ['No answers', stats.total_no_answers],
    ['Callbacks set', stats.total_callbacks],
    ['DNC', stats.total_dnc],
    ['Time spent', elapsed],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <NeuCard className="w-full max-w-sm space-y-4 p-6">
        <h2 className="text-lg font-semibold text-text-primary">Session summary</h2>
        <dl className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-text-secondary">{label}</dt>
              <dd className="font-medium text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
        {abandonedCount > 0 && (
          <p className="text-xs text-text-secondary">
            {abandonedCount} call{abandonedCount === 1 ? ' was' : 's were'} abandoned when a live contact was found.
          </p>
        )}
        <NeuButton className="w-full" onClick={onClose}>
          Close
        </NeuButton>
      </NeuCard>
    </div>
  );
}

/** Visited directly (navbar link, or a refresh that lost the in-flight
 * session's local state) with nothing running. */
function NoSessionState({ onGoToDashboard }) {
  return (
    <NeuCard className="mx-auto mt-16 max-w-md space-y-3 p-8 text-center">
      <h2 className="text-base font-semibold text-text-primary">No dialing session running</h2>
      <p className="text-sm text-text-secondary">
        Select leads and a line count on the dashboard, then start a dialing session to see it here.
      </p>
      <NeuButton onClick={onGoToDashboard}>Go to Dashboard</NeuButton>
    </NeuCard>
  );
}

/**
 * Dedicated page for the multi-line dialing engine — the dashboard only
 * selects leads and a line count, then hands off here (see Dashboard.jsx's
 * handleStartDialingSession). Reads the leadIds/lineCount the dashboard
 * passed via router state and starts the session on arrival.
 */
export default function DialerSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const [active, setActive] = useState(() => !!getActiveSessionId());
  const [lineCount, setLineCount] = useState(3);
  const [summaryStats, setSummaryStats] = useState(null);
  const [abandonedCount, setAbandonedCount] = useState(0);
  const multiline = useMultiline({ enabled: active });
  const startedRef = useRef(false);

  // A fresh "Start dialing session" navigation from the dashboard carries the
  // chosen leads + line count in router state. Only start on that — never on
  // a bare refresh/direct visit, which would otherwise restart (and lose)
  // whatever the backend session was already mid-way through.
  useEffect(() => {
    const request = location.state;
    if (!request || startedRef.current) return;
    startedRef.current = true;
    setActive(true);
    setLineCount(request.lineCount || 3);
    setSummaryStats(null);
    setAbandonedCount(0);
    multiline.start(request.lineCount, request.leadIds);
    // Consume the router state so navigating back to this exact history
    // entry later doesn't re-trigger a restart.
    navigate('.', { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleEndSession = async () => {
    const result = await multiline.stopSession();
    setActive(false);
    const stats = await endDialingSession();
    setAbandonedCount(result?.abandonedCount || 0);
    setSummaryStats(stats);
  };

  const handleMultilineDisposition = async (line, payload) => {
    await multiline.submitDispositionFor(line, payload);
  };

  const handleCloseSummary = () => {
    setSummaryStats(null);
    navigate('/');
  };

  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-5xl">
        {active ? (
          <MultilinePanel
            lines={multiline.lines.slice(0, lineCount)}
            connected={multiline.connected}
            starting={multiline.starting}
            error={multiline.error}
            onDrop={multiline.dropLine}
            onStop={handleEndSession}
            onDispositionSubmit={handleMultilineDisposition}
          />
        ) : (
          <NoSessionState onGoToDashboard={() => navigate('/')} />
        )}
      </div>

      <SessionSummaryModal stats={summaryStats} abandonedCount={abandonedCount} onClose={handleCloseSummary} />
    </AppShell>
  );
}
