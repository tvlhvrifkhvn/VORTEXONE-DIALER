// "ADD TO LIST" on the Leads page's selection strip (C7C): pick an existing
// list or type a new name; the selected leads get the tag list:<name>.
import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import * as api from '../../lib/api';
import { readPendingLists } from '../layout/LeftRail';
import { useCampaign } from '../../hooks/useCampaign';

export default function AddToList({ selectedIds, onDone }) {
  const { activeId } = useCampaign();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [lists, setLists] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!open) return;
    api
      .getLists()
      .then((r) => setLists([...new Set([...(r.lists || []).map((l) => l.name), ...readPendingLists(activeId)])].sort()))
      .catch(() => {});
  }, [open, activeId]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.addToList([...selectedIds], name.trim());
      setMessage({ ok: true, text: `Added ${Array.isArray(res.updated) ? res.updated.length : res.updated ?? selectedIds.size} to ${name.trim()}.` });
      setName('');
      setOpen(false);
      onDone?.();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      {!open ? (
        <Button onClick={() => setOpen(true)}>Add to list</Button>
      ) : (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="add-to-list-name" className="label mb-1 block">
              List
            </label>
            <Field id="add-to-list-name" list="add-to-list-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pick or type a name" maxLength={35} className="text-sm" autoFocus />
            <datalist id="add-to-list-names">
              {lists.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : `Add ${selectedIds.size}`}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
        </form>
      )}
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-foreground' : 'text-signal'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
