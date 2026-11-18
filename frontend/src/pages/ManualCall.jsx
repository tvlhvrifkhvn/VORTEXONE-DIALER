import { useCallback, useEffect, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import DialPad from '../components/call/DialPad';

/** /call/manual (C8F): the dial pad, one 480px column in the middle of the
 * page. While a call is live, a reload or tab close asks first (the page's
 * own Back button is gone: the header nav is the way out). */
export default function ManualCall() {
  const [callInFlight, setCallInFlight] = useState(false);

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
      <div className="mt-6">
        <DialPad onCallStateChange={handleCallStateChange} />
      </div>
    </AppShell>
  );
}
