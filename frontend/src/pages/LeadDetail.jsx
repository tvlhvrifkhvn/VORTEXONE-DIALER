import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PhoneOff } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import LeadActionHub from '../components/leads/LeadActionHub';
import ColleagueCard from '../components/leads/ColleagueCard';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import ActionButton from '../components/ui/ActionButton';
import StatusBadge from '../components/leads/StatusBadge';
import Badge from '../components/ui/Badge';
import { US_STATES } from '../lib/usStates';
import { formatDateTime } from '../lib/format';
import * as api from '../lib/api';

const EDITABLE_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];

function CallbackScheduler({ lead, onScheduled }) {
  const [when, setWhen] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
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
    <div className="space-y-2">
      {lead.status === 'callback_scheduled' && lead.next_action_at && (
        <p className="border-l-[3px] border-strong bg-muted px-4 py-2 text-sm text-foreground">
          Callback scheduled for{' '}
          <span className="font-mono tabular-nums">{formatDateTime(lead.next_action_at)}</span>
        </p>
      )}
      <label htmlFor="lead-callback-when" className="label block">
        Callback time
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Field
          id="lead-callback-when"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="flex-1 font-mono text-sm"
        />
        <Button variant="primary" onClick={submit} disabled={saving || !when}>
          {saving ? 'Saving…' : 'Schedule callback'}
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </div>
  );
}

export default function LeadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [fields, setFields] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    api
      .getLead(id)
      .then(({ lead: found }) => {
        setLead(found);
        setFields(EDITABLE_FIELDS.reduce((acc, f) => ({ ...acc, [f]: found[f] || '' }), {}));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleChange = (field, value) => setFields((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { lead: updated } = await api.updateLead(lead.id, fields);
      setLead(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteLead(lead.id);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <p className="label mt-12">Loading…</p>
      </AppShell>
    );
  }

  if (!lead) {
    return (
      <AppShell>
        <Panel className="mt-6 max-w-md space-y-4 p-6">
          <p className="label">Lead not found</p>
          {error && <p className="text-sm text-muted-foreground">{error}</p>}
          <Button onClick={() => navigate('/')}>Back to dashboard →</Button>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-3xl space-y-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex min-h-10 items-center gap-2 font-mono text-sm font-medium uppercase tracking-button text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          Back
        </button>

        <Panel className="space-y-4 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-[-0.01em] text-foreground">{lead.name}</h1>
              <p className="mt-1 text-base text-muted-foreground">{lead.brokerage || 'No brokerage on file'}</p>
            </div>
            <StatusBadge status={lead.status} />
          </div>

          {lead.missing_phone && (
            <p className="flex items-center gap-2 border-l-[3px] border-l-primary bg-muted px-4 py-2 text-sm text-foreground">
              <PhoneOff size={16} strokeWidth={1.5} aria-hidden="true" />
              {lead.original_phone
                ? `Number unreadable: ${lead.original_phone} — this lead can't be dialed until a valid number is added below.`
                : "No phone number on file — this lead can't be dialed until one is added below."}
            </p>
          )}

          {lead.tags?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {lead.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          )}
        </Panel>

        <ColleagueCard leadId={lead.id} />

        <LeadActionHub lead={lead} />

        <Panel className="space-y-4 p-6">
          <h2 className="label">Schedule a callback</h2>
          <CallbackScheduler lead={lead} onScheduled={setLead} />
        </Panel>

        <Panel className="space-y-4 p-6">
          <h2 className="label">Contact details</h2>
          {EDITABLE_FIELDS.map((field) => (
            <div key={field}>
              <label htmlFor={`lead-field-${field}`} className="label mb-2 block">
                {field}
              </label>
              {field === 'state' ? (
                <Field
                  id={`lead-field-${field}`}
                  as="select"
                  value={fields[field]}
                  onChange={(e) => handleChange(field, e.target.value)}
                  className="w-full"
                >
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Field>
              ) : (
                <Field
                  id={`lead-field-${field}`}
                  value={fields[field]}
                  onChange={(e) => handleChange(field, e.target.value)}
                  className={`w-full ${field === 'phone' ? 'font-mono tabular-nums' : ''}`}
                />
              )}
            </div>
          ))}

          {error && (
            <p role="alert" className="text-sm text-signal">
              <span className="label mr-2 text-signal">Error</span>
              {error}
            </p>
          )}
          {saved && <p className="font-mono text-xs uppercase text-foreground">✓ Saved</p>}

          <Button variant="primary" className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>

          <div className="border-t pt-4">
            {!confirmingDelete ? (
              <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
                ⊘ Delete lead
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This removes the lead from every list. This can't be undone from here.
                </p>
                <div className="flex gap-2">
                  <ActionButton variant="dnc" className="flex-1" onClick={handleDelete} disabled={deleting}>
                    {deleting ? 'Deleting…' : '⊘ Confirm delete'}
                  </ActionButton>
                  <Button className="flex-1" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
