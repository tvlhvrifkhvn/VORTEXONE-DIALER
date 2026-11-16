// Settings → Files (C1E): list the campaigns, create one from a template,
// edit its words and numbers, pause, resume or archive it. Only a
// supervisor changes files (the API refuses others with 403).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
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
      <SectionLabel index="02" title="New file" />
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

function EditSection({ campaign, disabled, onSaved }) {
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
      <SectionLabel index="03" title="Edit file" meta={fileLabel(campaign)} />
      <form onSubmit={handleSave} className="space-y-3">
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
        </div>
        <div>
          <label htmlFor="file-ai-context" className="label mb-2 block">AI context</label>
          <Field as="textarea" id="file-ai-context" rows={3} value={form.aiContext} onChange={set('aiContext')} maxLength={2000} className="w-full resize-none" disabled={disabled} />
          <p className="mt-2 text-sm text-muted-foreground">One or two sentences: what we offer and to whom. The AI suggestions and briefs use it.</p>
        </div>
        <div>
          <label htmlFor="file-pitch-script" className="label mb-2 block">Pitch script</label>
          <Field as="textarea" id="file-pitch-script" rows={4} value={form.pitchScript} onChange={set('pitchScript')} maxLength={5000} className="w-full resize-none" disabled={disabled} />
          <p className="mt-2 text-sm text-muted-foreground">
            Shown on the call screen. Use <code>{'{name}'}</code> where your name should appear.
          </p>
        </div>
        <Message message={message} />
        <Button type="submit" variant="primary" disabled={disabled || busy}>
          {busy ? 'Saving…' : 'Save file'}
        </Button>
      </form>
    </Panel>
  );
}

export default function Campaigns() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'supervisor';
  const { campaigns, activeId, refresh } = useCampaign();
  const [editId, setEditId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState(null);

  const editing = campaigns.find((c) => c.id === editId) || campaigns.find((c) => String(c.id) === String(activeId)) || null;

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
    <AppShell>
      <div className="mx-auto mt-6 max-w-4xl space-y-6">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Files</h1>
          <Link to="/settings" className="font-mono text-sm uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted">
            ← Settings
          </Link>
        </div>
        {!isSupervisor && <p className="text-sm text-muted-foreground">Only a supervisor can create or change files.</p>}

        <Panel className="space-y-4 p-6">
          <SectionLabel index="01" title="All files" meta={`${campaigns.length} total`} />
          <ul className="border-t">
            {campaigns.map((c) => (
              <li key={c.id} className="flex min-h-12 flex-wrap items-center justify-between gap-4 border-b py-2">
                <span className="flex items-center gap-4">
                  <FileTag number={c.file_number} name={c.name} />
                  <Badge tone={STATUS_TONE[c.status] || 'outline'}>{c.status}</Badge>
                  {String(c.id) === String(activeId) && <span className="label">Active here</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => setEditId(c.id)} aria-label={`Edit ${fileLabel(c)}`}>
                    Edit
                  </Button>
                  {c.status === 'active' && (
                    <Button onClick={() => changeStatus(c, 'paused')} disabled={!isSupervisor || busyId === c.id} aria-label={`Pause ${fileLabel(c)}`}>
                      Pause
                    </Button>
                  )}
                  {c.status !== 'active' && (
                    <Button onClick={() => changeStatus(c, 'active')} disabled={!isSupervisor || busyId === c.id} aria-label={`Resume ${fileLabel(c)}`}>
                      Resume
                    </Button>
                  )}
                  {c.status !== 'archived' && (
                    <Button onClick={() => changeStatus(c, 'archived')} disabled={!isSupervisor || busyId === c.id} aria-label={`Archive ${fileLabel(c)}`}>
                      ⊘ Archive
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <Message message={message} />
        </Panel>

        <CreateSection
          disabled={!isSupervisor}
          onCreated={async (c) => {
            await refresh();
            setEditId(c.id);
          }}
        />
        {editing && <EditSection campaign={editing} disabled={!isSupervisor} onSaved={() => refresh()} />}
      </div>
    </AppShell>
  );
}
