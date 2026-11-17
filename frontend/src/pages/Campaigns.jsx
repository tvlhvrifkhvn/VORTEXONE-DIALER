// Settings → Files (C1E): list the campaigns, create one from a template,
// edit its words and numbers, pause, resume or archive it. Only a
// supervisor changes files (the API refuses others with 403).
// C7B: rendered inside Settings (/settings/files); no page frame of its own.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Panel from '../components/ui/Panel';
import Button from '../components/ui/Button';
import Field from '../components/ui/Field';
import Badge from '../components/ui/Badge';
import FileTag from '../components/ui/FileTag';
import Segmented from '../components/ui/Segmented';
import SectionLabel from '../components/ui/SectionLabel';
import { useAuth } from '../hooks/useAuth';
import { useCampaign, fileLabel } from '../hooks/useCampaign';
import * as api from '../lib/api';
import StageEditor from '../components/pipeline/StageEditor';
import FieldEditor from '../components/fields/FieldEditor';

const TEMPLATES = {
  real_estate: {
    label: 'Real estate',
    kind: 'real_estate',
    companyLabel: 'Brokerage',
    aiContext:
      'Vortexone Agency offers virtual-assistant services (lead follow-up, appointment setting and admin support) to real estate agents in the United States.',
    pitchScript:
      "Hi, I'm {name} from Vortexone Agency. We offer virtual assistant services for real estate agents — lead follow-up, appointment setting, and admin support. Do you currently have VA support on your team?",
  },
  roofing: {
    label: 'Roofing',
    kind: 'roofing_supplement',
    companyLabel: 'Company',
    aiContext:
      'Vortexone Agency offers virtual-assistant support (claim follow-up, document gathering and scheduling) to roofing contractors who file insurance supplements in the United States.',
    pitchScript:
      "Hi, I'm {name} from Vortexone Agency. We help roofing contractors with insurance supplements — claim follow-up, paperwork and scheduling. Who handles your supplements today?",
  },
  blank: { label: 'Blank', kind: 'custom', companyLabel: 'Company', aiContext: '', pitchScript: '' },
};

const STATUS_TONE = { active: 'outline', paused: 'muted', archived: 'dashed' };

function toForm(c) {
  return {
    name: c.name || '',
    companyLabel: c.company_label || '',
    dailyGoal: c.daily_goal ?? '',
    defaultMaxAttempts: c.default_max_attempts ?? '',
    monthlyBudget: c.monthly_budget_cents === null || c.monthly_budget_cents === undefined ? '' : String(Number(c.monthly_budget_cents) / 100),
    aiContext: c.ai_context || '',
    pitchScript: c.pitch_script || '',
  };
}

function Message({ message }) {
  if (!message) return null;
  return (
    <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
      {message.text}
    </p>
  );
}

function CreateSection({ disabled, onCreated }) {
  const [template, setTemplate] = useState('real_estate');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const handleCreate = async (e) => {
    e.preventDefault();
    const t = TEMPLATES[template];
    setBusy(true);
    setMessage(null);
    try {
      const { campaign } = await api.createCampaign({
        name,
        kind: t.kind,
        companyLabel: t.companyLabel,
        aiContext: t.aiContext || null,
        pitchScript: t.pitchScript || null,
      });
      setName('');
      setMessage({ type: 'ok', text: `${fileLabel(campaign)} created.` });
      onCreated(campaign);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="space-y-4 p-6">
      <SectionLabel title="New file" />
      <form onSubmit={handleCreate} className="space-y-3">
        <div className="space-y-2">
          <p className="label">Start from</p>
          <Segmented
            label="Template"
            options={Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }))}
            value={template}
            onChange={setTemplate}
          />
        </div>
        <div>
          <label htmlFor="new-file-name" className="label mb-2 block">
            Name
          </label>
          <Field
            id="new-file-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Insurance Supplementing"
            maxLength={60}
            className="w-full"
            disabled={disabled}
            required
          />
        </div>
        <Message message={message} />
        <Button type="submit" variant="primary" disabled={disabled || busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create file'}
        </Button>
      </form>
    </Panel>
  );
}

// C7B: the file's editable values in two tabs, BASICS and SCRIPT & AI. One
// form, one save (the same update as before); each tab shows its own fields.
function EditSection({ campaign, tab, disabled, onSaved }) {
  const [form, setForm] = useState(() => toForm(campaign));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  useEffect(() => {
    setForm(toForm(campaign));
    setMessage(null);
  }, [campaign]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const handleSave = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { campaign: saved } = await api.updateCampaign(campaign.id, {
        name: form.name,
        companyLabel: form.companyLabel,
        dailyGoal: form.dailyGoal === '' ? null : Number(form.dailyGoal),
        defaultMaxAttempts: form.defaultMaxAttempts === '' ? null : Number(form.defaultMaxAttempts),
        // C4B: dollars in the form, cents in the file; empty = no budget of its own.
        monthlyBudgetCents: form.monthlyBudget === '' ? null : Math.round(Number(form.monthlyBudget) * 100),
        aiContext: form.aiContext,
        pitchScript: form.pitchScript,
      });
      setMessage({ type: 'ok', text: 'Saved.' });
      onSaved(saved);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="space-y-4 p-6">
      <SectionLabel title={tab === 'script' ? 'Script & AI' : 'Basics'} meta={fileLabel(campaign)} />
      <form onSubmit={handleSave} className="space-y-3">
        {tab === 'basics' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="file-name" className="label mb-2 block">Name</label>
              <Field id="file-name" value={form.name} onChange={set('name')} maxLength={60} className="w-full" disabled={disabled} required />
            </div>
            <div>
              <label htmlFor="file-company-label" className="label mb-2 block">Company label</label>
              <Field id="file-company-label" value={form.companyLabel} onChange={set('companyLabel')} maxLength={40} className="w-full" disabled={disabled} required />
            </div>
            <div>
              <label htmlFor="file-daily-goal" className="label mb-2 block">Daily goal · dials</label>
              <Field id="file-daily-goal" type="number" min="1" max="100000" value={form.dailyGoal} onChange={set('dailyGoal')} placeholder="100" className="w-32 font-mono tabular-nums" disabled={disabled} />
            </div>
            <div>
              <label htmlFor="file-max-attempts" className="label mb-2 block">Max attempts (1–10)</label>
              <Field id="file-max-attempts" type="number" min="1" max="10" value={form.defaultMaxAttempts} onChange={set('defaultMaxAttempts')} placeholder="Global" className="w-32 font-mono tabular-nums" disabled={disabled} />
            </div>
            <div>
              <label htmlFor="file-monthly-budget" className="label mb-2 block">Monthly budget · USD</label>
              <Field id="file-monthly-budget" type="number" min="0" step="0.01" value={form.monthlyBudget} onChange={set('monthlyBudget')} placeholder="No limit" className="w-40 font-mono tabular-nums" disabled={disabled} />
              <p className="mt-2 text-sm text-muted-foreground">Dialing in this file stops at 100 %. The global budget in Settings applies too.</p>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="file-ai-context" className="label mb-2 block">AI context</label>
              <Field as="textarea" id="file-ai-context" rows={3} value={form.aiContext} onChange={set('aiContext')} maxLength={2000} className="w-full resize-none" disabled={disabled} />
              <p className="mt-2 text-sm text-muted-foreground">One or two sentences: what we offer and to whom. The AI suggestions and briefs use it.</p>
            </div>
            <div>
              <label htmlFor="file-pitch-script" className="label mb-2 block">Pitch script</label>
              <Field as="textarea" id="file-pitch-script" rows={6} value={form.pitchScript} onChange={set('pitchScript')} maxLength={5000} className="w-full resize-none" disabled={disabled} />
              <p className="mt-2 text-sm text-muted-foreground">
                Shown on the call screen. Use <code>{'{name}'}</code> where your name should appear.
              </p>
            </div>
          </>
        )}
        <Message message={message} />
        <Button type="submit" variant="primary" disabled={disabled || busy}>
          {busy ? 'Saving…' : 'Save file'}
        </Button>
      </form>
    </Panel>
  );
}

const TABS = [
  { value: 'basics', label: 'Basics' },
  { value: 'script', label: 'Script & AI' },
  { value: 'stages', label: 'Stages' },
  { value: 'fields', label: 'Fields' },
];

/**
 * Settings → Files (C7B): the file list in its own column (NEW FILE on top),
 * the selected file on the right with BASICS · SCRIPT & AI · STAGES · FIELDS.
 * ?file=<id>&tab=<tab> keep the choice in the address. Pause, resume and
 * archive sit on the selected file's header row.
 */
export default function FilesSettings() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  const { campaigns, activeId, refresh } = useCampaign();
  const [params, setParams] = useSearchParams();
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  const creating = params.get('file') === 'new';
  const tab = TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'basics';
  const editing = creating
    ? null
    : campaigns.find((c) => String(c.id) === params.get('file')) || campaigns.find((c) => String(c.id) === String(activeId)) || null;
  const select = (next) => setParams({ ...Object.fromEntries(params), ...next }, { replace: true });

  const changeStatus = async (c, status) => {
    if (status === 'archived' && !window.confirm(`Archive ${fileLabel(c)}? Its leads stay, but it leaves the file menu.`)) return;
    setBusyId(c.id);
    setMessage(null);
    try {
      await api.setCampaignStatus(c.id, status);
      await refresh();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="files-settings">
      <div>
        <h2 className="text-xl font-semibold tracking-[-0.01em] text-foreground">Files</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each file has its own pitch script, daily goal, company label, AI context, stages and fields.</p>
        {!isSupervisor && <p className="mt-1 text-sm text-muted-foreground">Only a supervisor can create or change files.</p>}
      </div>
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        {/* The file list: its own column. */}
        <div className="space-y-2 xl:w-64 xl:shrink-0" aria-label="All files">
          <Button variant="primary" className="w-full" onClick={() => select({ file: 'new' })} disabled={!isSupervisor}>
            + New file
          </Button>
          <ul className="border-t">
            {campaigns.map((c) => {
              const selected = editing && c.id === editing.id;
              return (
                <li key={c.id} className="border-b">
                  <button
                    type="button"
                    onClick={() => select({ file: String(c.id) })}
                    aria-current={selected ? 'true' : undefined}
                    className={`flex min-h-12 w-full flex-col items-start gap-1 px-2 py-2 text-left transition-colors duration-150 ${selected ? 'bg-muted' : 'hover:bg-muted'}`}
                  >
                    <FileTag number={c.file_number} name={c.name} />
                    <span className="flex items-center gap-2">
                      <Badge tone={STATUS_TONE[c.status] || 'outline'}>{c.status}</Badge>
                      {String(c.id) === String(activeId) && <span className="label">Active here</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Message message={message} />
        </div>

        {/* The selected file. */}
        <div className="min-w-0 flex-1 space-y-4">
          {creating ? (
            <CreateSection
              disabled={!isSupervisor}
              onCreated={async (c) => {
                await refresh();
                select({ file: String(c.id), tab: 'basics' });
              }}
            />
          ) : editing ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <FileTag number={editing.file_number} name={editing.name} />
                  <Badge tone={STATUS_TONE[editing.status] || 'outline'}>{editing.status}</Badge>
                </div>
                <span className="flex flex-wrap gap-2">
                  {editing.status === 'active' && (
                    <Button onClick={() => changeStatus(editing, 'paused')} disabled={!isSupervisor || busyId === editing.id} aria-label={`Pause ${fileLabel(editing)}`}>
                      Pause
                    </Button>
                  )}
                  {editing.status !== 'active' && (
                    <Button onClick={() => changeStatus(editing, 'active')} disabled={!isSupervisor || busyId === editing.id} aria-label={`Resume ${fileLabel(editing)}`}>
                      Resume
                    </Button>
                  )}
                  {editing.status !== 'archived' && (
                    <Button onClick={() => changeStatus(editing, 'archived')} disabled={!isSupervisor || busyId === editing.id} aria-label={`Archive ${fileLabel(editing)}`}>
                      ⊘ Archive
                    </Button>
                  )}
                </span>
              </div>
              <Segmented label="File settings" options={TABS} value={tab} onChange={(t) => select({ tab: t })} />
              {(tab === 'basics' || tab === 'script') && (
                <EditSection campaign={editing} tab={tab} disabled={!isSupervisor} onSaved={() => refresh()} />
              )}
              {tab === 'stages' && <StageEditor key={editing.id} campaign={editing} disabled={!isSupervisor} />}
              {tab === 'fields' && <FieldEditor key={`f-${editing.id}`} campaign={editing} disabled={!isSupervisor} />}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Pick a file on the left.</p>
          )}
        </div>
      </div>
    </div>
  );
}
