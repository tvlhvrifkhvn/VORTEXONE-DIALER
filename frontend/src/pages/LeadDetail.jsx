// /leads/:id (C7D, C8C): a top bar (BACK · name and company · STATUS and
// STAGE · local time · CALL, SMS, EMAIL, ⋯) over three columns like Follow Up
// Boss: PROFILE (300px: contact details read-only with EDIT, TAGS & LISTS,
// FIELDS, BEST TIME), ACTIVITY (the composer NOTE · SMS · EMAIL · TASK ·
// CALLBACK, then the timeline filling the column), WORK (320px: PIPELINE,
// NEXT, AI SUMMARY, OFFICE). Nothing new: the existing parts, moved.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, PhoneOff } from 'lucide-react';
import AppShell from '../components/layout/AppShell';
import PageFrame from '../components/layout/PageFrame';
import { useStages } from '../hooks/useStages';
import LeadActionHub from '../components/leads/LeadActionHub';
import LeadComposer from '../components/leads/LeadComposer';
import ColleagueCard from '../components/leads/ColleagueCard';
import LeadStagePanel from '../components/pipeline/LeadStagePanel';
import CustomFieldsPanel from '../components/leads/CustomFieldsPanel';
import TagEditor from '../components/leads/TagEditor';
import TaskPanel from '../components/tasks/TaskPanel';
import LeadSummaryPanel from '../components/assistant/LeadSummaryPanel';
import BestTimeHint from '../components/leads/BestTimeHint';
import { leadLocalTime } from '../components/leads/LeadLocalTime';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Menu from '../components/ui/Menu';
import Dialog from '../components/ui/Dialog';
import ActionButton from '../components/ui/ActionButton';
import StatusBadge from '../components/leads/StatusBadge';
import Badge from '../components/ui/Badge';
import { US_STATES } from '../lib/usStates';
import * as api from '../lib/api';
import { useCampaign, fileLabel, showToast } from '../hooks/useCampaign';
import { useAuth } from '../hooks/useAuth';

const EDITABLE_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];

/** The lead's local time and OPEN / CLOSED, ticking every 30 s. */
function LocalTimeChip({ lead }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const local = leadLocalTime(lead, now);
  if (!local) return null;
  return (
    <span className="whitespace-nowrap font-mono text-xs uppercase tabular-nums text-muted-foreground" title="The lead's local time; calls are allowed 8 AM–9 PM there">
      {local.text}
      {!local.unknown && <span className={local.open ? 'text-foreground' : ''}> · {local.open ? 'Open' : 'Closed'}</span>}
    </span>
  );
}

/** A label-value row in PROFILE. */
function Row({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <dt className="label shrink-0">{label}</dt>
      <dd className="min-w-0 text-right text-foreground">{children}</dd>
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
  const [tab, setTab] = useState(() => (searchParams.get('reply') === '1' ? 'sms' : 'note'));
  const [editing, setEditing] = useState(false);
  const [refresh, setRefresh] = useState({ timeline: 0, tasks: 0 });
  const { user } = useAuth();
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
      setEditing(false);
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

  const inActiveFile = String(lead.campaign_id) === String(activeId);
  const stageName = stages.find((s) => s.id === lead.pipeline_stage_id)?.name;
  const otherFiles = (campaigns || []).filter((c) => String(c.id) !== String(lead.campaign_id) && c.status !== 'archived');

  const openComposer = (t) => {
    setTab(t);
    setTimeout(() => document.getElementById('composer-panel')?.querySelector('textarea, select, input')?.focus(), 50);
  };
  const composed = (kind) =>
    setRefresh((r) => ({ timeline: r.timeline + 1, tasks: kind === 'task' ? r.tasks + 1 : r.tasks }));

  // ⋯ → Move to another file: the existing bulk move with this one lead (supervisor, as on Leads).
  const moveTo = async (file) => {
    if (!window.confirm(`Move ${lead.name} to ${fileLabel(file)}? It starts in that file's first stage.`)) return;
    try {
      await api.bulkMoveCampaign([lead.id], file.id);
      const { lead: moved } = await api.getLead(lead.id);
      setLead(moved);
    } catch (err) {
      setError(err.message);
    }
  };
  const moreItems = [
    ...(user?.role === 'supervisor' ? otherFiles.map((c) => ({ label: `Move to ${fileLabel(c)}`, onSelect: () => moveTo(c) })) : []),
    { label: '⊘ Delete lead', onSelect: () => setConfirmingDelete(true) },
  ];

  const copyPhone = () => {
    navigator.clipboard?.writeText(lead.phone).then(() => showToast('Phone number copied.')).catch(() => {});
  };

  const profile = (
    <div className="space-y-6 pt-2" data-testid="lead-profile">
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
          {lead.original_phone ? `Number unreadable: ${lead.original_phone}. Add a valid number with EDIT.` : 'No phone number on file. Add one with EDIT.'}
        </p>
      )}

      <section className="space-y-2" data-testid="lead-contact">
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <h2 className="label">Profile</h2>
          {!editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Edit contact details">
              Edit
            </Button>
          )}
        </div>
        {editing ? (
          <div className="space-y-3">
            {EDITABLE_FIELDS.map((field) => (
              <div key={field}>
                <label htmlFor={`lead-field-${field}`} className="label mb-1 block">
                  {field === 'brokerage' ? companyWord : field}
                </label>
                {field === 'state' ? (
                  <Field id={`lead-field-${field}`} as="select" value={fields[field]} onChange={(e) => handleChange(field, e.target.value)} className="w-full">
                    {US_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
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
            <div className="flex gap-2">
              <Button variant="solid" size="sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setFields(EDITABLE_FIELDS.reduce((acc, f) => ({ ...acc, [f]: lead[f] || '' }), {}));
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <dl className="space-y-2">
            <Row label="Phone">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono tabular-nums">{lead.phone || '—'}</span>
                {lead.phone && (
                  <button
                    type="button"
                    onClick={copyPhone}
                    aria-label="Copy phone number"
                    title="Copy"
                    className="inline-flex min-h-8 min-w-8 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                  >
                    <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                )}
              </span>
            </Row>
            <Row label="Email">
              <span className="block truncate" title={lead.email || undefined}>
                {lead.email || '—'}
              </span>
            </Row>
            <Row label={companyWord}>{lead.brokerage || '—'}</Row>
            <Row label="Address">{lead.address || '—'}</Row>
            <Row label="State">{lead.state || '—'}</Row>
          </dl>
        )}
        {error && (
          <p role="alert" className="text-sm text-signal">
            <span className="label mr-2 text-signal">Error</span>
            {error}
          </p>
        )}
        {saved && <p className="font-mono text-xs uppercase text-foreground">✓ Saved</p>}
      </section>

      {/* C2D: tags (and C7C lists) with add and remove. */}
      <TagEditor lead={lead} onChange={(updated) => setLead((l) => ({ ...l, ...updated }))} />

      {inActiveFile && <CustomFieldsPanel lead={lead} onChange={(updated) => setLead((l) => ({ ...l, ...updated }))} />}

      {/* C6C: the best local hour to call, from the last 90 days. */}
      <BestTimeHint leadId={lead.id} />
    </div>
  );

  const work = (
    <div className="space-y-6 pt-2" data-testid="lead-work">
      {/* C2B: stage, lost reason and deal value. Only when the lead is in the active file (else the page switches). */}
      {inActiveFile && <LeadStagePanel lead={lead} onChange={setLead} />}
      {/* C3A: the open tasks and the scheduled callback (the forms are the composer's tabs). */}
      <TaskPanel lead={lead} refreshKey={refresh.tasks} />
      {/* C5B: the AI summary, on request only. */}
      <LeadSummaryPanel key={lead.id} leadId={lead.id} />
      <ColleagueCard leadId={lead.id} twoByTwo />
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
            className="flex min-h-11 items-center gap-2 font-mono text-sm font-medium uppercase tracking-button text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            Back
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-foreground">{lead.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{lead.brokerage || `No ${companyWord} on file`}</p>
          </div>
          <span className="flex items-center gap-1">
            <span className="label">Status ·</span>
            <StatusBadge status={lead.status} />
          </span>
          {stageName && (
            <span className="flex items-center gap-1">
              <span className="label">Stage ·</span>
              <Badge tone="outline">{stageName}</Badge>
            </span>
          )}
          <LocalTimeChip lead={lead} />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="lg" className="w-28" onClick={() => navigate(`/call/${lead.id}`)}>
              Call
            </Button>
            <Button size="lg" className="w-28" onClick={() => openComposer('sms')}>
              SMS
            </Button>
            <Button size="lg" className="w-28" onClick={() => openComposer('email')}>
              Email
            </Button>
            <Menu ariaLabel="More lead actions" size="lg" className="w-11 px-0" items={moreItems} />
          </div>
        </div>

        <div className="lg:min-h-0 lg:flex-1">
          <PageFrame id="lead" left={profile} leftLabel="Profile" right={work} rightLabel="Work" leftWidth="lg:w-[300px]" mainClassName="lg:flex lg:flex-col">
            <div className="mt-6 flex flex-col gap-4 lg:min-h-0 lg:flex-1" data-testid="lead-activity">
              <LeadComposer lead={lead} tab={tab} onTab={setTab} onDone={composed} onLeadChange={setLead} />
              <LeadActionHub lead={lead} hideActions refreshKey={refresh.timeline} />
            </div>
          </PageFrame>
        </div>
      </div>
      {confirmingDelete && (
          <Dialog title="Delete lead">
            <div className="space-y-4">
              <p className="text-sm text-foreground">This removes the lead from every list. This can't be undone from here.</p>
              <div className="flex gap-2">
                <ActionButton variant="dnc" className="flex-1" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : '⊘ Confirm delete'}
                </ActionButton>
                <Button className="flex-1" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Dialog>
      )}
    </AppShell>
  );
}
