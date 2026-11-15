import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import Badge from '../components/ui/Badge';
import * as api from '../lib/api';

// The only fields the server accepts (smsService.TEMPLATE_FIELDS).
const MERGE_FIELDS = ['{{name}}', '{{first_name}}', '{{brokerage}}', '{{state}}', '{{city}}'];
const SEGMENT_SIZE = 160;
const SAMPLE_LEAD = { name: 'Sarah Whitman', brokerage: 'Whitman Realty Group', state: 'FL' };

function segmentCount(len) {
  return Math.max(1, Math.ceil(len / SEGMENT_SIZE));
}

function mergePreview(body, lead) {
  return body
    .replace(/\{\{name\}\}/g, lead.name || '')
    .replace(/\{\{brokerage\}\}/g, lead.brokerage || '')
    .replace(/\{\{state\}\}/g, lead.state || '')
    .replace(/  +/g, ' ')
    .trim();
}

function TemplateEditor({ initial, onSaved, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [body, setBody] = useState(initial?.body || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  const insertChip = (chip) => {
    const el = textareaRef.current;
    if (!el) return setBody((b) => b + chip);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + chip + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + chip.length;
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (initial) await api.updateSmsTemplate(initial.id, { name, body });
      else await api.createSmsTemplate({ name, body });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const segments = segmentCount(body.length);
  const preview = mergePreview(body, SAMPLE_LEAD);
  const missingStop = body.length > 0 && !/stop/i.test(body);

  return (
    <NeuCard className="space-y-4 p-6">
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label htmlFor="template-name" className="label mb-2 block">
            Name
          </label>
          <NeuInput id="template-name" value={name} onChange={(e) => setName(e.target.value)} className="w-full" required />
        </div>
        <div>
          <label htmlFor="template-body" className="label mb-2 block">
            Message
          </label>
          <NeuInput
            id="template-body"
            as="textarea"
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full resize-none"
            style={{ minHeight: 100 }}
            required
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">Insert</span>
          {MERGE_FIELDS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => insertChip(chip)}
              className="min-h-8 border border-strong px-2 font-mono text-xs text-foreground transition-colors duration-150 hover:bg-foreground hover:text-background"
            >
              {chip}
            </button>
          ))}
        </div>
        <p className={`font-mono text-xs tabular-nums ${segments > 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          {body.length} / {SEGMENT_SIZE} characters ({segments} segment{segments === 1 ? '' : 's'}
          {segments > 1 ? ' — costs 2x to send' : ''})
        </p>
        {missingStop && (
          <p className="border-l-[3px] border-strong bg-muted px-4 py-2 text-sm text-foreground">
            Consider adding "Reply STOP to opt out" — most carriers expect this on marketing texts.
          </p>
        )}
        {body && (
          <div className="border bg-muted p-4 text-sm text-foreground">
            <p className="label mb-2">Preview (sample lead)</p>
            {preview}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-signal">{error}</p>}
        <div className="flex gap-2">
          <NeuButton type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save template'}
          </NeuButton>
          <NeuButton type="button" onClick={onCancel}>
            Cancel
          </NeuButton>
        </div>
      </form>
    </NeuCard>
  );
}

export default function SmsTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | 'new' | template
  const [error, setError] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .getSmsTemplates()
      .then(({ templates: t }) => setTemplates(t))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = async (id) => {
    try {
      await api.deleteSmsTemplate(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">SMS templates</h1>
          {!editing && (
            <NeuButton variant="primary" onClick={() => setEditing('new')}>
              New template
            </NeuButton>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-signal">{error}</p>}

        {editing && (
          <TemplateEditor
            initial={editing === 'new' ? null : editing}
            onSaved={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => setEditing(null)}
          />
        )}

        {!editing && loading && <p className="label">Loading…</p>}

        {!editing &&
          !loading &&
          templates.map((t) => (
            <NeuCard key={t.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  {t.name}
                  {t.needs_fixing && (
                    <span title={`Can't be sent until fixed: ${(t.invalid_tokens || []).join(', ')}`}>
                      <Badge tone="solid">Needs fixing</Badge>
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-muted-foreground">{t.body.slice(0, 60)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <NeuButton onClick={() => setEditing(t)}>Edit</NeuButton>
                <ActionButton variant="dnc" className="min-h-10 py-2" onClick={() => handleDelete(t.id)}>
                  ⊘ Delete
                </ActionButton>
              </div>
            </NeuCard>
          ))}

        {!editing && !loading && templates.length === 0 && (
          <NeuCard className="space-y-2 p-6">
            <p className="label">No templates</p>
            <p className="text-base text-foreground">Create a template to send texts from the call screen, the lead page and bulk SMS.</p>
          </NeuCard>
        )}
      </div>
    </AppShell>
  );
}
