// Settings → Dialing defaults (C6A): browser notifications for reminders.
// Off until the owner turns it on here and the browser grants permission;
// this browser only (localStorage). The in-app toast always shows.
import { useState } from 'react';
import Segmented from '../ui/Segmented';
import { NOTIFY_KEY } from '../../hooks/useReminders';

function initial() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === 'on' && typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

export default function ReminderSettings() {
  const [on, setOn] = useState(initial);
  const [note, setNote] = useState(null);
  const supported = typeof Notification !== 'undefined';

  const change = async (value) => {
    setNote(null);
    if (value === 'off') {
      try {
        localStorage.setItem(NOTIFY_KEY, 'off');
      } catch {
        /* nothing to keep */
      }
      setOn(false);
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setNote('The browser blocked notifications. Allow them for this site in the browser settings, then try again.');
      return;
    }
    try {
      localStorage.setItem(NOTIFY_KEY, 'on');
    } catch {
      /* the toast still shows */
    }
    setOn(true);
  };

  return (
    <div className="space-y-2" data-testid="reminder-settings">
      <p className="label">Reminder notifications</p>
      {supported ? (
        <div className="flex flex-wrap items-center gap-4">
          <Segmented
            label="Browser notifications for reminders"
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
            value={on ? 'on' : 'off'}
            onChange={change}
          />
          <p className="text-sm text-muted-foreground">
            A reminder always shows in the app at the due time. On: a browser notification too (this browser only), never during a call.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This browser doesn't support notifications; reminders show in the app.</p>
      )}
      {note && <p role="alert" className="text-sm text-foreground">{note}</p>}
    </div>
  );
}
