// Settings → Files, section 05 (C2D): one file's custom fields. Add (label,
// type, options for a select, show in list), edit label/options/show in
// list, move up/down, delete. Key and type are fixed once a field exists.
import { useCallback, useEffect, useState } from 'react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Badge from '../ui/Badge';
import * as api from '../../lib/api';

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'boolean', label: 'Yes / No' },
];
const splitOptions = (text) => text.split(',').map((o) => o.trim()).filter(Boolean);

function FieldRow({ field, index, count, disabled, onSave, onMove, onDelete }) {
  const [label, setLabel] = useState(field.label);
  const [options, setOptions] = useState(field.options.join(', '));
  const [show, setShow] = useState(field.show_in_list);
  useEffect(() => {
    setLabel(field.label);
    setOptions(field.options.join(', '));
    setShow(field.show_in_list);
  }, [field]);
  const dirty = label.trim() !== field.label || show !== field.show_in_list || (field.type === 'select' && options !== field.options.join(', '));
  return (
    <li className="space-y-2 border-b py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-8 font-mono text-sm tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
        <Field value={label} onChange={(e) => setLabel(e.target.value)} aria-label={`Field ${index + 1} label`} maxLength={60} className="min-w-[12rem] flex-1" disabled={disabled} />
        <Badge>{TYPES.find((t) => t.value === field.type)?.label || field.type}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{field.key}</span>
        <label className="flex min-h-10 items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} disabled={disabled} className="h-4 w-4 accent-primary" />
          In list
        </label>
      </div>
      {field.type === 'select' && (
        <Field value={options} onChange={(e) => setOptions(e.target.value)} aria-label={`${field.label} options, comma separated`} className="ml-10 w-[calc(100%-2.5rem)] text-sm" disabled={disabled} />
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => onSave(field, { label: label.trim(), showInList: show, ...(field.type === 'select' ? { options: splitOptions(options) } : {}) })} disabled={disabled || !dirty || !label.trim()}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => onMove(index, -1)} disabled={disabled || index === 0} aria-label={`Move ${field.label} up`}>↑</Button>
        <Button variant="ghost" onClick={() => onMove(index, 1)} disabled={disabled || index === count - 1} aria-label={`Move ${field.label} down`}>↓</Button>
        <Button onClick={() => onDelete(field)} disabled={disabled} aria-label={`Delete ${field.label}`}>⊘ Delete</Button>
      </div>
    </li>
  );
}

export default function FieldEditor({ campaign, disabled }) {
  const [fields, setFields] = useState([]);
  const [draft, setDraft] = useState({ label: '', type: 'text', options: '', show: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      setFields((await api.getCampaignFields(campaign.id)).fields || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }, [campaign.id]);

  useEffect(() => {
    setMessage(null);
    load();
  }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ type: 'ok', text: ok });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      await load();
      setBusy(false);
    }
  };

  const save = (field, changes) => run(() => api.updateCampaignField(campaign.id, field.id, changes), `"${changes.label}" saved.`);
  const move = (index, dir) => {
    const ids = fields.map((f) => f.id);
    [ids[index], ids[index + dir]] = [ids[index + dir], ids[index]];
    return run(() => api.reorderCampaignFields(campaign.id, ids));
  };
  const remove = (field) => {
    if (!window.confirm(`Delete "${field.label}"? Its values on every lead of this file are deleted too.`)) return;
    run(() => api.deleteCampaignField(campaign.id, field.id), `"${field.label}" deleted.`);
  };
  const add = (e) => {
    e.preventDefault();
    const label = draft.label.trim();
    run(async () => {
      await api.createCampaignField(campaign.id, {
        label,
        type: draft.type,
        showInList: draft.show,
        ...(draft.type === 'select' ? { options: splitOptions(draft.options) } : {}),
      });
      setDraft({ label: '', type: 'text', options: '', show: false });
    }, `"${label}" added.`);
  };

  return (
    <Panel className="space-y-4 p-6">
      {/* C8D: no repeated header inside the Files tab; what fields do is the list's tooltip. */}
      <ul className="border-t" title='Extra fields every lead of this file has: on the lead page, importable from a column; "in list" ones get a column in the leads table.'>
        {fields.length === 0 && <li className="py-2 text-sm text-muted-foreground">No fields yet.</li>}
        {fields.map((f, i) => (
          <FieldRow key={f.id} field={f} index={i} count={fields.length} disabled={disabled || busy} onSave={save} onMove={move} onDelete={remove} />
        ))}
      </ul>
      <form onSubmit={add} className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="new-field-label" className="label mb-2 block">New field</label>
            <Field id="new-field-label" value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} maxLength={60} placeholder="e.g. Team size" className="w-full" disabled={disabled} />
          </div>
          <div>
            <label htmlFor="new-field-type" className="label mb-2 block">Type</label>
            <Field as="select" id="new-field-type" value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))} className="w-40" disabled={disabled}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Field>
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={draft.show} onChange={(e) => setDraft((d) => ({ ...d, show: e.target.checked }))} disabled={disabled} className="h-4 w-4 accent-primary" />
            In list
          </label>
          <Button type="submit" variant="solid" disabled={disabled || busy || !draft.label.trim() || (draft.type === 'select' && splitOptions(draft.options).length === 0)}>
            Add field
          </Button>
        </div>
        {draft.type === 'select' && (
          <div>
            <label htmlFor="new-field-options" className="label mb-2 block">Options, comma separated</label>
            <Field id="new-field-options" value={draft.options} onChange={(e) => setDraft((d) => ({ ...d, options: e.target.value }))} placeholder="Asphalt, Metal, Tile" className="w-full" disabled={disabled} />
          </div>
        )}
      </form>
      {message && (
        <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
          {message.text}
        </p>
      )}
    </Panel>
  );
}
