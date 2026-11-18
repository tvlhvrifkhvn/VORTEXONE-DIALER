// Reminder toasts (C6A), bottom left so they never cover the call screen's
// outcome buttons or the ASK drawer. No focus change and no key handlers:
// a reminder during a call is only this toast. CALL, OPEN, SNOOZE 10 MIN, ×.
import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';
import { useReminders } from '../../hooks/useReminders';
import { formatDateTime } from '../../lib/format';

export default function ReminderToasts() {
  const { toasts, dismiss, snooze } = useReminders();
  const navigate = useNavigate();
  if (toasts.length === 0) return null;
  const go = (item, path) => {
    dismiss(item);
    navigate(path);
  };
  return (
    <div className="fixed bottom-4 left-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] space-y-2" aria-live="polite" data-testid="reminders">
      {toasts.slice(-3).map((item) => (
        <div key={`${item.kind}:${item.id}:${item.due_at}`} role="status" className="space-y-2 border border-l-[3px] border-strong border-l-primary bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="label">{item.kind === 'callback' ? 'Callback due' : `Task due · ${item.type}`}</p>
              <p className="truncate text-sm font-medium text-foreground">{item.kind === 'callback' ? item.lead_name : item.title}</p>
              <p className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDateTime(item.due_at)}
                {item.kind === 'task' && item.lead_name ? ` · ${item.lead_name}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(item)}
              aria-label="Close reminder"
              className="min-h-10 px-2 font-mono text-sm text-foreground hover:bg-muted"
            >
              ×
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.lead_id && (
              <>
                <Button variant="primary" className="px-3" onClick={() => go(item, `/call/${item.lead_id}`)}>
                  Call
                </Button>
                <Button className="px-3" onClick={() => go(item, `/leads/${item.lead_id}`)}>
                  Open
                </Button>
              </>
            )}
            <Button variant="ghost" className="px-3" onClick={() => snooze(item)}>
              Snooze 10 min
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
