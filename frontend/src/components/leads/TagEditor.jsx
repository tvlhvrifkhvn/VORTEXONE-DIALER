// Tags on the lead page (C2D): each tag with a remove button, and a field to
// add one (Enter or ADD). The same tag endpoints the call screen uses.
import { useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import * as api from '../../lib/api';

export default function TagEditor({ lead, onChange }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const { lead: updated } = await fn();
      onChange(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e) => {
    e.preventDefault();
    const tag = text.trim();
    if (!tag) return;
    run(async () => {
      const res = await api.addLeadTag(lead.id, tag);
      setText('');
      return res;
    });
  };

  return (
    <div className="space-y-2">
      <p className="label">Tags</p>
      <ul className="flex flex-wrap gap-2">
        {(lead.tags || []).length === 0 && <li className="text-sm text-muted-foreground">No tags</li>}
        {(lead.tags || []).map((tag) => (
          <li key={tag} className="flex items-center">
            {/* C7C: list:<name> tags are lists. */}
            <Badge tone={tag.startsWith('list:') ? 'solid' : 'outline'}>{tag.startsWith('list:') ? `List · ${tag.slice(5)}` : tag}</Badge>
            <button
              type="button"
              onClick={() => run(() => api.removeLeadTag(lead.id, tag))}
              disabled={busy}
              aria-label={`Remove tag ${tag}`}
              className="min-h-10 px-2 font-mono text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Field value={text} onChange={(e) => setText(e.target.value)} maxLength={40} placeholder="Add a tag" aria-label="New tag" className="w-56 text-sm" />
        <Button type="submit" disabled={busy || !text.trim()}>
          Add
        </Button>
      </form>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </div>
  );
}
