// QUICK ACTIONS on the call screen's HELP column (C8E): compact rows ADD TAG,
// QUICK SMS, ADD TASK, SCHEDULE CALLBACK. Each opens its existing form inline
// (tag, SMS, callback) or in a Dialog (task). The logic is the old 8-button
// action grid's (CallActionGrid.jsx, removed): the same tag endpoints and
// the two quick tags colleagueIntel reads, SmsCompose, TaskForm, and
// CallControls for the callback. Nothing here submits a disposition, so a
// rep can tag and text while still talking.
import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Dialog from '../ui/Dialog';
import { SmsCompose } from '../leads/LeadActionHub';
import TaskForm from '../tasks/TaskForm';
import CallControls from './CallControls';
import * as api from '../../lib/api';

// Read by colleagueIntel.js when summarizing an office — keep in sync with
// CLIENT_TAG / INTERESTED_TAG there.
const SUGGESTED_TAGS = ['interested', 'client'];

function Row({ label, open, onToggle, children, count }) {
  return (
    <li className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left font-mono text-xs font-medium uppercase tracking-button transition-colors duration-150 ${
          open ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
        }`}
      >
        <span>{label}</span>
        <span aria-hidden="true">{count ?? (open ? '−' : '+')}</span>
      </button>
      {open && <div className="space-y-2 p-3">{children}</div>}
    </li>
  );
}

export default function CallQuickActions({ lead, onLeadUpdated, onScheduleCallback, callbackDisabled }) {
  const [open, setOpen] = useState(null); // 'tag' | 'sms' | 'callback' | null
  const [taskOpen, setTaskOpen] = useState(false);
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);

  const toggle = (panel) => {
    setError(null);
    setOpen((current) => (current === panel ? null : panel));
  };
  const showFlash = (message) => {
    setFlash(message);
    setTimeout(() => setFlash(null), 2000);
  };

  const handleAddTag = async (explicitTag) => {
    const tag = (explicitTag ?? tagText).trim();
    if (!tag) return;
    setBusy(true);
    setError(null);
    try {
      const { lead: updated } = await api.addLeadTag(lead.id, tag);
      onLeadUpdated?.(updated);
      setTagText('');
      showFlash('Tag added');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveTag = async (tag) => {
    setError(null);
    try {
      const { lead: updated } = await api.removeLeadTag(lead.id, tag);
      onLeadUpdated?.(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-2" data-testid="quick-actions">
      <ul className="border">
        <Row label="Add tag" open={open === 'tag'} onToggle={() => toggle('tag')}>
          {lead.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {lead.tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 whitespace-nowrap border border-strong py-0.5 pl-2 pr-1 font-mono text-xs uppercase text-foreground">
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove tag ${tag}`} className="px-1 text-muted-foreground hover:bg-foreground hover:text-background">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Field
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              placeholder="e.g. gatekeeper"
              aria-label="New tag"
              className="min-w-0 flex-1 text-sm"
              autoFocus
            />
            <Button variant="solid" onClick={() => handleAddTag()} disabled={busy || !tagText.trim()}>
              Add
            </Button>
          </div>
          {/* `client` and `interested` are the two tags colleagueIntel reads for an office's social proof. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Quick</span>
            {SUGGESTED_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleAddTag(tag)}
                disabled={busy || lead.tags?.includes(tag)}
                className="min-h-8 border border-strong px-2 font-mono text-xs uppercase text-foreground transition-colors duration-150 hover:bg-muted disabled:opacity-40"
              >
                {tag}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Quick SMS" open={open === 'sms'} onToggle={() => toggle('sms')}>
          <SmsCompose lead={lead} bare />
        </Row>
        <li className="border-b last:border-b-0">
          <button
            type="button"
            onClick={() => setTaskOpen(true)}
            aria-haspopup="dialog"
            className="flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left font-mono text-xs font-medium uppercase tracking-button text-foreground transition-colors duration-150 hover:bg-muted"
          >
            <span>Add task</span>
            <span aria-hidden="true">+</span>
          </button>
        </li>
        <Row label="Schedule callback" open={open === 'callback'} onToggle={() => toggle('callback')}>
          <CallControls onScheduleCallback={onScheduleCallback} disabled={callbackDisabled} startOpen />
        </Row>
      </ul>

      {taskOpen && (
        <Dialog title={`Add task · ${lead.name}`} onClose={() => setTaskOpen(false)} className="max-w-2xl">
          <TaskForm
            busy={busy}
            submitVariant="solid"
            onSubmit={async (task) => {
              setBusy(true);
              setError(null);
              try {
                await api.createTask({ ...task, leadId: lead.id });
                setTaskOpen(false);
                showFlash('Task added');
                return true;
              } catch (err) {
                setError(err.message);
                return false;
              } finally {
                setBusy(false);
              }
            }}
          />
          {error && <p role="alert" className="mt-2 text-sm text-signal">{error}</p>}
        </Dialog>
      )}

      {error && !taskOpen && <p role="alert" className="text-sm text-signal">{error}</p>}
      {flash && <p className="font-mono text-xs uppercase text-foreground">✓ {flash}</p>}
    </div>
  );
}
