// The lead page's file fields (C2D): one input per field of the active file,
// by type. Saving sends only what changed as `custom` (an emptied field is
// sent as null, which clears it). The server checks every value.
// C8C: in PROFILE as FIELDS: read-only rows; EDIT turns them into the inputs
// with SAVE (solid) and CANCEL.
import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { useCustomFields } from '../../hooks/useCustomFields';
import * as api from '../../lib/api';

/** Stored value → the string an input holds. */
function toInput(field, value) {
  if (value === undefined || value === null) return '';
  if (field.type === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Input string → the value sent (null clears). */
function fromInput(field, text) {
  if (text === '') return null;
  if (field.type === 'boolean') return text === 'true';
  if (field.type === 'number') return Number(text);
  return text;
}

function FieldInput({ field, value, onChange }) {
  const id = `custom-${field.key}`;
  const common = { id, value, onChange: (e) => onChange(e.target.value) };
  if (field.type === 'select') {
    return (
      <Field as="select" className="w-full" {...common}>
        <option value="">—</option>
        {field.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Field>
    );
  }
  if (field.type === 'boolean') {
    return (
      <Field as="select" className="w-full" {...common}>
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Field>
    );
  }
  if (field.type === 'date') return <Field type="date" className="w-full font-mono text-sm" {...common} />;
  if (field.type === 'number') return <Field type="number" step="any" className="w-full font-mono tabular-nums" {...common} />;
  return <Field className="w-full" maxLength={1000} {...common} />;
}

export default function CustomFieldsPanel({ lead, onChange }) {
  const { fields } = useCustomFields();
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, toInput(f, lead.custom?.[f.key])])));
  }, [fields, lead.custom]);

  if (fields.length === 0) return null;

  const changed = fields.filter((f) => draft[f.key] !== toInput(f, lead.custom?.[f.key]));

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const custom = Object.fromEntries(changed.map((f) => [f.key, fromInput(f, draft[f.key])]));
      const { lead: updated } = await api.updateLead(lead.id, { custom });
      onChange(updated);
      setEditing(false);
      setMessage({ type: 'ok', text: 'Fields saved.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const shown = (f) => {
    const v = lead.custom?.[f.key];
    if (v === undefined || v === null || v === '') return '—';
    if (f.type === 'boolean') return v ? 'Yes' : 'No';
    return String(v);
  };

  return (
    <section className="space-y-2" data-testid="lead-fields">
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <h2 className="label">Fields</h2>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => { setMessage(null); setEditing(true); }} aria-label="Edit fields">
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="space-y-3">
          {fields.map((f) => (
            <div key={f.key}>
              <label htmlFor={`custom-${f.key}`} className="label mb-1 block">
                {f.label}
              </label>
              <FieldInput field={f} value={draft[f.key] ?? ''} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="solid" size="sm" onClick={save} disabled={busy || changed.length === 0}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(Object.fromEntries(fields.map((f) => [f.key, toInput(f, lead.custom?.[f.key])])));
                setEditing(false);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <dl className="space-y-1">
          {fields.map((f) => (
            <div key={f.key} className="flex items-baseline justify-between gap-2 text-sm">
              <dt className="label shrink-0">{f.label}</dt>
              <dd className="min-w-0 truncate text-right text-foreground" title={shown(f)}>{shown(f)}</dd>
            </div>
          ))}
        </dl>
      )}
      {message && (
        <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
