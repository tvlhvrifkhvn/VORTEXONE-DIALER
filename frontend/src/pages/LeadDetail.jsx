import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PhoneOff } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import LeadActionHub from '../components/leads/LeadActionHub';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import StatusBadge from '../components/leads/StatusBadge';
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
        <p className="rounded-input bg-action-warn/10 px-3 py-2 text-xs font-medium text-action-warn">
          Callback scheduled for {formatDateTime(lead.next_action_at)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <NeuInput
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="flex-1 text-sm"
        />
        <NeuButton className="text-sm" onClick={submit} disabled={saving || !when}>
          {saving ? 'Saving…' : 'Schedule callback'}
        </NeuButton>
      </div>
      {error && <p className="text-xs text-action-hangup">{error}</p>}
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
        <p className="mt-12 text-center text-text-secondary">Loading…</p>
      </AppShell>
    );
  }

  if (!lead) {
    return (
      <AppShell>
        <NeuCard className="mx-auto mt-12 max-w-md p-6 text-center">
          <p className="font-medium text-text-primary">Lead not found</p>
          {error && <p className="mt-2 text-sm text-text-secondary">{error}</p>}
          <NeuButton className="mt-4" onClick={() => navigate('/')}>
            Back to Dashboard
          </NeuButton>
        </NeuCard>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-3xl space-y-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-action-call"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <NeuCard className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-lg font-semibold text-text-primary">{lead.name}</h1>
            <StatusBadge status={lead.status} />
          </div>
          <p className="text-sm text-text-secondary">{lead.brokerage || 'No brokerage on file'}</p>

          {lead.missing_phone && (
            <p className="flex items-center gap-2 rounded-input bg-action-warn/10 px-3 py-2 text-xs font-medium text-action-warn">
              <PhoneOff size={14} />
              No phone number on file — this lead can't be dialed until one is added below.
            </p>
          )}

          {lead.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {lead.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-text-primary shadow-neu-sm"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </NeuCard>

        <LeadActionHub lead={lead} />

        <NeuCard className="space-y-3 p-5">
          <h2 className="text-sm font-semibold text-text-primary">Schedule a callback</h2>
          <CallbackScheduler lead={lead} onScheduled={setLead} />
        </NeuCard>

        <NeuCard className="space-y-3 p-5">
          <h2 className="text-sm font-semibold text-text-primary">Contact details</h2>
          {EDITABLE_FIELDS.map((field) => (
            <div key={field}>
              <label className="mb-1 block text-xs font-medium capitalize text-text-secondary">{field}</label>
              {field === 'state' ? (
                <NeuInput
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
                </NeuInput>
              ) : (
                <NeuInput
                  value={fields[field]}
                  onChange={(e) => handleChange(field, e.target.value)}
                  className="w-full"
                />
              )}
            </div>
          ))}

          {error && <p className="text-sm text-action-hangup">{error}</p>}
          {saved && <p className="text-sm text-action-contacted">Saved.</p>}

          <NeuButton className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </NeuButton>

          <div className="border-t border-shadow/20 pt-4">
            {!confirmingDelete ? (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-sm font-medium text-action-hangup hover:underline"
              >
                Delete lead
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">
                  This removes the lead from every list. This can't be undone from here.
                </p>
                <div className="flex gap-2">
                  <ActionButton
                    variant="hangup"
                    className="flex-1 text-sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Confirm delete'}
                  </ActionButton>
                  <NeuButton className="flex-1 text-sm" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </NeuButton>
                </div>
              </div>
            )}
          </div>
        </NeuCard>
      </div>
    </AppShell>
  );
}
