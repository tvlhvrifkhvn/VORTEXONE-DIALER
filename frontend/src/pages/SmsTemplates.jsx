import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import * as api from '../lib/api';

const MERGE_FIELDS = ['{{name}}', '{{brokerage}}', '{{state}}'];
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
    <NeuCard className="space-y-4 p-5">
      <form onSubmit={handleSave} className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
          <NeuInput value={name} onChange={(e) => setName(e.target.value)} className="w-full" required />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Message</label>
          <NeuInput
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
          <span className="text-xs text-text-secondary">Insert:</span>
          {MERGE_FIELDS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => insertChip(chip)}
              className="rounded-input px-2 py-1 text-xs font-medium text-text-primary shadow-neu-sm hover:shadow-neu"
            >
              {chip}
            </button>
          ))}
        </div>
        <p className={`text-xs font-medium ${segments > 1 ? 'text-action-warn' : 'text-text-secondary'}`}>
          {body.length} / {SEGMENT_SIZE} characters ({segments} segment{segments === 1 ? '' : 's'}
          {segments > 1 ? ' — costs 2x to send' : ''})
        </p>
        {missingStop && (
          <p className="rounded-input bg-action-warn/10 px-3 py-2 text-xs font-medium text-action-warn">
            Consider adding "Reply STOP to opt out" — most carriers expect this on marketing texts.
          </p>
        )}
        {body && (
          <div className="rounded-input bg-surface p-3 text-sm text-text-primary shadow-neu-inset">
            <p className="mb-1 text-xs font-medium text-text-secondary">Preview (sample lead)</p>
            {preview}
          </div>
        )}
        {error && <p className="text-sm text-action-hangup">{error}</p>}
        <div className="flex gap-2">
          <NeuButton type="submit" disabled={saving}>
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
      <div className="mx-auto mt-4 max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text-primary">SMS templates</h1>
          {!editing && <NeuButton onClick={() => setEditing('new')}>New template</NeuButton>}
        </div>

        {error && <p className="text-sm text-action-hangup">{error}</p>}

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

        {!editing && loading && <p className="text-sm text-text-secondary">Loading…</p>}

        {!editing &&
          !loading &&
          templates.map((t) => (
            <NeuCard key={t.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-medium text-text-primary">{t.name}</p>
                <p className="truncate text-xs text-text-secondary">{t.body.slice(0, 60)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <NeuButton className="text-xs" onClick={() => setEditing(t)}>
                  Edit
                </NeuButton>
                <ActionButton variant="hangup" className="text-xs" onClick={() => handleDelete(t.id)}>
                  Delete
                </ActionButton>
              </div>
            </NeuCard>
          ))}

        {!editing && !loading && templates.length === 0 && (
          <p className="text-sm text-text-secondary">No templates yet.</p>
        )}
      </div>
    </AppShell>
  );
}
