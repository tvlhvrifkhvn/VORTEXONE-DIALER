import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import DialPad from '../components/call/DialPad';

/** Manual dial page — replaces the old navbar modal. */
export default function ManualCall() {
  const navigate = useNavigate();
  const [callInFlight, setCallInFlight] = useState(false);

  // The modal version refused to close mid-call so a live call couldn't be
  // orphaned with no UI to hang it up from. A page needs the browser-level
  // equivalent for reloads and tab closes; the in-app Back button is guarded
  // separately below.
  useEffect(() => {
    if (!callInFlight) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [callInFlight]);

  const handleCallStateChange = useCallback((inFlight) => setCallInFlight(inFlight), []);

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-md space-y-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          disabled={callInFlight}
          title={callInFlight ? 'Hang up before leaving this page' : 'Back to Today'}
          className="flex min-h-10 items-center gap-2 font-mono text-sm font-medium uppercase tracking-button text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          Back
        </button>

        <DialPad onDone={() => navigate('/')} onCallStateChange={handleCallStateChange} />
      </div>
    </AppShell>
  );
}
