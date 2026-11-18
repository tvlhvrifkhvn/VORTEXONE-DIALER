// The lead page's composer (C8C), at the top of ACTIVITY: tabs NOTE · SMS ·
// EMAIL · TASK · CALLBACK (NOTE by default). Each tab holds the existing form
// for that action: a note (POST /leads/:id/notes, as the call screen's ADD
// NOTE), SmsCompose and EmailCompose (with DRAFT WITH AI), TaskForm, and the
// callback scheduler that used to sit in the WORK rail. Every submit button is
// solid. `onDone(kind)` tells the page what changed (timeline, tasks, lead).
import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { SmsCompose, EmailCompose } from './LeadActionHub';
import TaskForm from '../tasks/TaskForm';
import * as api from '../../lib/api';

export const COMPOSER_TABS = [
  { value: 'note', label: 'Note' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'task', label: 'Task' },
  { value: 'callback', label: 'Callback' },
];

function NoteCompose({ lead, onSaved }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.addLeadNote(lead.id, body);
      setText('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Field as="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" placeholder="Write a note…" className="w-full resize-none" style={{ minHeight: 80 }} />
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      <div className="flex items-center gap-4">
        <Button type="submit" variant="solid" disabled={busy || !text.trim()}>
          {busy ? 'Saving…' : 'Add note'}
        </Button>
        {saved && <span className="font-mono text-xs uppercase text-foreground">✓ Saved</span>}
      </div>
    </form>
  );
}

/** The callback scheduler (moved from the lead page's WORK rail). */
function CallbackCompose({ lead, onScheduled }) {
  const [when, setWhen] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (!when) return;
    setSaving(true);
    setError(null);
    try {
      const { lead: updated } = await api.scheduleCallback(lead.id, new Date(when).toISOString());
      onScheduled(updated);
      setWhen('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="lead-callback-when" className="label block">
        Callback time
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Field id="lead-callback-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="flex-1 font-mono text-sm" />
        <Button type="submit" variant="solid" disabled={saving || !when}>
          {saving ? 'Saving…' : 'Schedule callback'}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </form>
  );
}

export default function LeadComposer({ lead, tab, onTab, onDone, onLeadChange }) {
  const [busy, setBusy] = useState(false);
  const [taskError, setTaskError] = useState(null);

  const addTask = async (task) => {
    setBusy(true);
    setTaskError(null);
    try {
      await api.createTask({ ...task, leadId: lead.id });
      onDone?.('task');
      return true;
    } catch (err) {
      setTaskError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border bg-card" data-testid="lead-composer">
      <div role="tablist" aria-label="Composer" className="flex border-b">
        {COMPOSER_TABS.map((t) => {
          const on = t.value === tab;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              id={`composer-tab-${t.value}`}
              aria-selected={on}
              aria-controls="composer-panel"
              onClick={() => onTab(t.value)}
              className={`min-h-10 flex-1 border-r px-3 font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150 last:border-r-0 ${
                on ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div id="composer-panel" role="tabpanel" aria-labelledby={`composer-tab-${tab}`} className="p-4">
        {tab === 'note' && <NoteCompose lead={lead} onSaved={() => onDone?.('note')} />}
        {tab === 'sms' && <SmsCompose lead={lead} bare onSent={() => onDone?.('sms')} />}
        {tab === 'email' && <EmailCompose lead={lead} bare onSent={() => onDone?.('email')} />}
        {tab === 'task' && (
          <>
            <TaskForm busy={busy} onSubmit={addTask} submitVariant="solid" />
            {taskError && <p role="alert" className="mt-2 text-sm text-signal">{taskError}</p>}
          </>
        )}
        {tab === 'callback' && (
          <CallbackCompose
            lead={lead}
            onScheduled={(updated) => {
              onLeadChange(updated);
              onDone?.('callback');
            }}
          />
        )}
      </div>
    </section>
  );
}
