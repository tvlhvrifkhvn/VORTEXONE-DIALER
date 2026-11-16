import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import MultilinePanel from '../components/call/MultilinePanel';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import SectionLabel from '../components/ui/SectionLabel';
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
    <Dialog title="Session summary" onClose={onClose} className="max-w-sm">
      <dl className="text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between border-b py-2 last:border-b-0">
            <dt className="label">{label}</dt>
            <dd className="font-mono font-medium tabular-nums text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {abandonedCount > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          {abandonedCount} call{abandonedCount === 1 ? ' was' : 's were'} abandoned when a live contact was found.
        </p>
      )}
      <Button className="mt-6 w-full" onClick={onClose}>
        Close
      </Button>
    </Dialog>
  );
}

/** Visited directly (navbar link, or a refresh that lost the in-flight
 * session's local state) with nothing running. */
function NoSessionState({ onGoToDashboard }) {
  return (
    <Panel className="mt-6 max-w-md space-y-4 p-6">
      <h2 className="label">No dialing session</h2>
      <p className="text-base text-foreground">
        Start a dialing session from Today, or select leads and a line count on the Leads page, to see it here.
      </p>
      <Button variant="primary" onClick={onGoToDashboard}>
        Go to leads →
      </Button>
    </Panel>
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

  // Set when Stop left the rep's current call live: that line stays on screen
  // until its outcome is logged, then the session summary opens.
  const [finishing, setFinishing] = useState(null);

  const finishSession = async (abandoned) => {
    setActive(false);
    setFinishing(null);
    const stats = await endDialingSession();
    setAbandonedCount(abandoned);
    setSummaryStats(stats);
  };

  const handleEndSession = async () => {
    const result = await multiline.stopSession();
    if (result?.keptLive) {
      setFinishing({ slotNumber: result.keptLive.slotNumber, abandonedCount: result.abandonedCount || 0 });
      return;
    }
    await finishSession(result?.abandonedCount || 0);
  };

  const handleMultilineDisposition = async (line, payload) => {
    await multiline.submitDispositionFor(line, payload);
    if (finishing && line.slotNumber === finishing.slotNumber) await finishSession(finishing.abandonedCount);
  };

  const handleCloseSummary = () => {
    setSummaryStats(null);
    navigate('/');
  };

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-[1440px]">
        <SectionLabel index="01" title="Lines" className="mb-4" />
        {finishing && (
          <p className="mb-4 border border-l-[3px] border-strong border-l-primary bg-card px-4 py-2 text-sm font-medium text-foreground">
            Dialing stopped. Finish the call you're on and log its outcome — the session summary opens after that.
          </p>
        )}
        {active ? (
          <MultilinePanel
            lines={multiline.lines.slice(0, lineCount)}
            connected={multiline.connected}
            starting={multiline.starting}
            error={multiline.error}
            onDrop={multiline.dropLine}
            onStop={finishing ? null : handleEndSession}
            onDispositionSubmit={handleMultilineDisposition}
          />
        ) : (
          <NoSessionState onGoToDashboard={() => navigate('/leads')} />
        )}
      </div>

      <SessionSummaryModal stats={summaryStats} abandonedCount={abandonedCount} onClose={handleCloseSummary} />
    </AppShell>
  );
}
