// Tags on the lead page (C2D): each tag with a remove button, and a field to
// add one (Enter or ADD). The same tag endpoints the call screen uses.
// C8C: "TAGS & LISTS" in PROFILE; "+ ADD" in the header opens the field.
import { useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Field from '../ui/Field';
import * as api from '../../lib/api';

export default function TagEditor({ lead, onChange }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);

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
    <section className="space-y-2" data-testid="lead-tags">
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <h2 className="label">Tags &amp; lists</h2>
        <Button variant="ghost" size="sm" active={adding} aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          + Add
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {(lead.tags || []).length === 0 && <li className="text-sm text-muted-foreground">None yet</li>}
        {(lead.tags || []).map((tag) => (
          <li key={tag} className="flex items-center">
            {/* C7C: list:<name> tags are lists. */}
            <Badge tone={tag.startsWith('list:') ? 'solid' : 'outline'}>{tag.startsWith('list:') ? `List · ${tag.slice(5)}` : tag}</Badge>
            <button
              type="button"
              onClick={() => run(() => api.removeLeadTag(lead.id, tag))}
              disabled={busy}
              aria-label={`Remove tag ${tag}`}
              className="min-h-8 px-2 font-mono text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {adding && (
        <form onSubmit={add} className="flex gap-2">
          <Field value={text} onChange={(e) => setText(e.target.value)} maxLength={40} placeholder="Tag, or list:Name" aria-label="New tag" className="min-w-0 flex-1 text-sm" autoFocus />
          <Button type="submit" variant="solid" disabled={busy || !text.trim()}>
            Add
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
    </section>
  );
}
