import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ListTodo, Mail, MessageSquare, Phone, PhoneOff } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import PageFrame from '../components/layout/PageFrame';
import { useStages } from '../hooks/useStages';
import LeadActionHub from '../components/leads/LeadActionHub';
import ColleagueCard from '../components/leads/ColleagueCard';
import LeadStagePanel from '../components/pipeline/LeadStagePanel';
import CustomFieldsPanel from '../components/leads/CustomFieldsPanel';
import TagEditor from '../components/leads/TagEditor';
import TaskPanel from '../components/tasks/TaskPanel';
import LeadSummaryPanel from '../components/assistant/LeadSummaryPanel';
import BestTimeHint from '../components/leads/BestTimeHint';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import ActionButton from '../components/ui/ActionButton';
import StatusBadge from '../components/leads/StatusBadge';
import Badge from '../components/ui/Badge';
import { US_STATES } from '../lib/usStates';
import { formatDateTime } from '../lib/format';
import * as api from '../lib/api';
import { useCampaign, fileLabel, showToast } from '../hooks/useCampaign';

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
  // C7D: the top bar opens the composers (REPLY from Today opens SMS) and the WORK rail.
  const [searchParams] = useSearchParams();
  const [composer, setComposer] = useState(() => (searchParams.get('reply') === '1' ? 'sms' : null));
  const [openWork, setOpenWork] = useState(0);
  const { stages } = useStages();
  // C1E: the company word comes from the file; a lead of another file switches to it.
  const { active, activeId, campaigns, switchTo } = useCampaign();
  const companyWord = (active?.company_label || 'Brokerage').toLowerCase();

  useEffect(() => {
    if (!lead || !campaigns.length || String(lead.campaign_id) === String(activeId)) return;
    const own = campaigns.find((c) => String(c.id) === String(lead.campaign_id));
    const label = own ? fileLabel(own) : `file ${lead.campaign_id}`;
    if (own && own.status !== 'archived' && switchTo(own.id)) {
      showToast(`Switched to ${label}: this lead belongs to it.`);
    } else {
      showToast(`This lead belongs to ${label}.`);
    }
  }, [lead, campaigns, activeId, switchTo]);

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
      navigate('/leads');
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
          <Button onClick={() => navigate('/leads')}>Back to leads →</Button>
        </Panel>
      </AppShell>
    );
  }

  // C7D: three columns under an always-visible top bar. PROFILE (left):
  // contact details, tags and lists, file fields, best time, delete. Main:
  // the composer when opened from the top bar, then the timeline. WORK
  // (right): tasks, callback, AI summary, stage and deal, office.
  const inActiveFile = String(lead.campaign_id) === String(activeId);
  const stageName = stages.find((s) => s.id === lead.pipeline_stage_id)?.name;
  const addTask = () => {
    setOpenWork((n) => n + 1);
    setTimeout(() => {
      const box = document.getElementById('lead-work-tasks');
      box?.scrollIntoView({ block: 'start' });
      box?.querySelector('input')?.focus();
    }, 50);
  };

  const profile = (
    <div className="space-y-6 pt-2" data-testid="lead-profile">
      <p className="label">Profile</p>
      {/* C6B: a merged lead is gone from every list; say where it went. */}
      {lead.merged_into && (
        <p role="status" className="border-l-[3px] border-strong bg-muted px-4 py-2 text-sm text-foreground">
          This lead was merged into{' '}
          <Link to={`/leads/${lead.merged_into}`} className="underline underline-offset-4">
            lead #{lead.merged_into}
          </Link>
          . Its calls, texts, notes and tasks are there now.
        </p>
      )}
      {lead.missing_phone && (
        <p className="flex items-center gap-2 border-l-[3px] border-l-primary bg-muted px-4 py-2 text-sm text-foreground">
          <PhoneOff size={16} strokeWidth={1.5} aria-hidden="true" />
          {lead.original_phone
            ? `Number unreadable: ${lead.original_phone} — this lead can't be dialed until a valid number is added below.`
            : "No phone number on file — this lead can't be dialed until one is added below."}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="label">Contact details</h2>
        {EDITABLE_FIELDS.map((field) => (
          <div key={field}>
            <label htmlFor={`lead-field-${field}`} className="label mb-2 block">
              {field === 'brokerage' ? companyWord : field}
            </label>
            {field === 'state' ? (
              <Field id={`lead-field-${field}`} as="select" value={fields[field]} onChange={(e) => handleChange(field, e.target.value)} className="w-full">
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
      </section>

      {/* C2D: tags (and C7C lists) with add and remove. */}
      <TagEditor lead={lead} onChange={(updated) => setLead((l) => ({ ...l, ...updated }))} />

      {inActiveFile && <CustomFieldsPanel lead={lead} onChange={(updated) => setLead((l) => ({ ...l, ...updated }))} />}

      {/* C6C: the best local hour to call, from the last 90 days. */}
      <BestTimeHint leadId={lead.id} />

      <div className="border-t pt-4">
        {!confirmingDelete ? (
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
            ⊘ Delete lead
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">This removes the lead from every list. This can't be undone from here.</p>
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
    </div>
  );

  const work = (
    <div className="space-y-6 pt-2" data-testid="lead-work">
      <p className="label">Work</p>
      {/* C3A: tasks (add, complete). */}
      <div id="lead-work-tasks">
        <TaskPanel lead={lead} />
      </div>
      <Panel className="space-y-4 p-6">
        <h2 className="label">Schedule a callback</h2>
        <CallbackScheduler lead={lead} onScheduled={setLead} />
      </Panel>
      {/* C5B: the AI summary, on request only. */}
      <LeadSummaryPanel key={lead.id} leadId={lead.id} />
      {/* C2B: stage, lost reason and deal value. Only when the lead is in the active file (else the page switches). */}
      {inActiveFile && <LeadStagePanel lead={lead} onChange={setLead} />}
      <ColleagueCard leadId={lead.id} />
    </div>
  );

  return (
    <AppShell framed>
      <div className="flex flex-col lg:h-full">
        {/* The top bar: always visible. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-3 lg:shrink-0" data-testid="lead-top-bar">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex min-h-10 items-center gap-2 font-mono text-sm font-medium uppercase tracking-button text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            Back
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-foreground">{lead.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{lead.brokerage || `No ${companyWord} on file`}</p>
          </div>
          <StatusBadge status={lead.status} />
          {stageName && <Badge tone="outline">{stageName}</Badge>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => navigate(`/call/${lead.id}`)}>
              <Phone size={16} strokeWidth={1.5} aria-hidden="true" />
              Call
            </Button>
            <Button active={composer === 'sms'} aria-pressed={composer === 'sms'} onClick={() => setComposer((c) => (c === 'sms' ? null : 'sms'))}>
              <MessageSquare size={16} strokeWidth={1.5} aria-hidden="true" />
              SMS
            </Button>
            <Button active={composer === 'email'} aria-pressed={composer === 'email'} onClick={() => setComposer((c) => (c === 'email' ? null : 'email'))}>
              <Mail size={16} strokeWidth={1.5} aria-hidden="true" />
              Email
            </Button>
            <Button onClick={addTask}>
              <ListTodo size={16} strokeWidth={1.5} aria-hidden="true" />
              Add task
            </Button>
          </div>
        </div>

        <div className="lg:min-h-0 lg:flex-1">
          <PageFrame id="lead" left={profile} leftLabel="Profile" right={work} rightLabel="Work" openRight={openWork}>
            <div className="mt-6 space-y-6">
              <LeadActionHub lead={lead} composer={composer} onComposer={setComposer} hideActions />
            </div>
          </PageFrame>
        </div>
      </div>
    </AppShell>
  );
}
