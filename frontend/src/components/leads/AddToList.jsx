// "ADD TO LIST" on the Leads page's selection strip (C7C): pick an existing
// list or type a new name; the selected leads get the tag list:<name>.
// C8B: a compact button opening the form in a popover; the result line goes
// to the page (onMessage).
import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { Popover } from '../ui/Menu';
import * as api from '../../lib/api';
import { readPendingLists } from '../layout/LeftRail';
import { useCampaign } from '../../hooks/useCampaign';

export default function AddToList({ selectedIds, onDone, onMessage }) {
  const { activeId } = useCampaign();
  const [open, setOpen] = useState(false); // lists load when the popover first opens
  const [name, setName] = useState('');
  const [lists, setLists] = useState([]);
  const [busy, setBusy] = useState(false);
  const setMessage = (m) => onMessage?.(m && { type: m.ok ? 'ok' : 'error', text: m.text });

  useEffect(() => {
    if (!open) return;
    api
      .getLists()
      .then((r) => setLists([...new Set([...(r.lists || []).map((l) => l.name), ...readPendingLists(activeId)])].sort()))
      .catch(() => {});
  }, [open, activeId]);

  const add = async (e, close) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.addToList([...selectedIds], name.trim());
      setMessage({ ok: true, text: `Added ${Array.isArray(res.updated) ? res.updated.length : res.updated ?? selectedIds.size} to ${name.trim()}.` });
      setName('');
      close();
      onDone?.();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover label="Add to list ▾" ariaLabel="Add the selected leads to a list" variant="secondary" size="sm" align="left" panelClassName="w-72 p-3">
      {({ close }) => (
        <form onSubmit={(e) => add(e, close)} className="space-y-2" onFocus={() => setOpen(true)}>
          <label htmlFor="add-to-list-name" className="label block">
            List
          </label>
          <Field id="add-to-list-name" list="add-to-list-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pick or type a name" maxLength={35} className="w-full text-sm" autoFocus />
          <datalist id="add-to-list-names">
            {lists.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <Button type="submit" variant="solid" size="sm" disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : `Add ${selectedIds.size}`}
          </Button>
        </form>
      )}
    </Popover>
  );
}
