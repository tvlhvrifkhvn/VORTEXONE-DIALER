// The left rail on Today and the Leads page (C7C, docs/CRM_PLAN.md):
//   SMART LISTS  your saved views with live counts (one counts request, C7A);
//                a click opens the Leads page with that view
//   LISTS        hand-picked groups: tags that start with "list:", with counts;
//                a click opens the Leads page filtered by that tag
//   FILES        switch the active file
// "+ NEW SMART LIST" saves the Leads page's current filters (onSaveSmartList,
// given by the Leads page; elsewhere it opens the Leads page). "+ NEW LIST"
// asks for a name: with leads selected on the Leads page they're added at once
// (onNewList); otherwise the name waits here (this browser) until leads are
// added with ADD TO LIST.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Field from '../ui/Field';
import Button from '../ui/Button';
import { useCampaign, fileLabel } from '../../hooks/useCampaign';
import { pollWhileVisible } from '../../lib/poll';
import * as api from '../../lib/api';

const POLL_MS = 30000;
const PENDING_KEY = 'vortex.lists.pending.';

export function readPendingLists(campaignId) {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY + campaignId) || '[]');
  } catch {
    return [];
  }
}
function writePendingLists(campaignId, names) {
  try {
    localStorage.setItem(PENDING_KEY + campaignId, JSON.stringify(names));
  } catch {
    /* the name lasts for this visit */
  }
}

const itemClass = (active) =>
  `flex min-h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm transition-colors duration-150 ${
    active ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
  }`;

function RailHeading({ children }) {
  return <p className="label mb-1 mt-4 px-3 first:mt-0">{children}</p>;
}

function NameForm({ id, label, placeholder, onSubmit, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  return (
    <form
      className="space-y-2 px-3 py-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await onSubmit(name.trim());
        } catch (err) {
          setError(err.message);
        }
      }}
    >
      <label htmlFor={id} className="label block">
        {label}
      </label>
      <Field id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={35} className="w-full text-sm" autoFocus />
      {error && <p role="alert" className="text-xs text-signal">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="px-3" disabled={!name.trim()}>
          Save
        </Button>
        <Button variant="ghost" className="px-3" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function LeftRail({ activeViewId = null, activeTag = null, onSaveSmartList = null, onNewList = null, refreshKey = 0 }) {
  const navigate = useNavigate();
  const { usable, activeId, switchTo, switchBlockedReason } = useCampaign();
  const [views, setViews] = useState([]);
  const [lists, setLists] = useState([]);
  const [pending, setPending] = useState(() => readPendingLists(activeId));
  const [naming, setNaming] = useState(null); // 'smart' | 'list' | null

  const loadCounts = useCallback(async () => {
    try {
      const [counts, l] = await Promise.all([api.getViewCounts(), api.getLists()]);
      const byId = new Map((counts.counts || []).map((c) => [c.id, c.count]));
      setViews((vs) => vs.map((v) => ({ ...v, count: byId.get(v.id) ?? v.count })));
      setLists(l.lists || []);
    } catch {
      /* the rail keeps what it shows */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setViews((await api.listViews()).views || []);
    } catch {
      /* the rail keeps what it shows */
    }
    await loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    load();
    return pollWhileVisible(loadCounts, POLL_MS);
  }, [load, loadCounts, refreshKey]);

  // A pending name disappears once the list really exists.
  useEffect(() => {
    const real = new Set(lists.map((l) => l.name.toLowerCase()));
    const left = readPendingLists(activeId).filter((n) => !real.has(n.toLowerCase()));
    writePendingLists(activeId, left);
    setPending(left);
  }, [lists, activeId]);

  const allLists = [...lists, ...pending.filter((n) => !lists.some((l) => l.name.toLowerCase() === n.toLowerCase())).map((n) => ({ name: n, tag: `list:${n}`, count: 0, pending: true }))].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return (
    <nav aria-label="Lists and files" className="pb-4 pt-2" data-testid="left-rail">
      <RailHeading>Smart lists</RailHeading>
      <ul className="space-y-1">
        {views.length === 0 && <li className="px-3 text-xs text-muted-foreground">Save the Leads filters you use as a smart list.</li>}
        {views.map((v) => (
          <li key={v.id}>
            <button type="button" className={itemClass(activeViewId === v.id)} onClick={() => navigate(`/leads?view=${v.id}`)}>
              <span className="truncate">{v.name}</span>
              <span className="font-mono text-xs tabular-nums">{v.count ?? '…'}</span>
            </button>
          </li>
        ))}
      </ul>
      {naming === 'smart' ? (
        <NameForm
          id="new-smart-list"
          label="Name the current filters"
          placeholder="e.g. Texas callbacks"
          onSubmit={async (name) => {
            await onSaveSmartList(name);
            setNaming(null);
            load();
          }}
          onCancel={() => setNaming(null)}
        />
      ) : (
        <button
          type="button"
          className="min-h-10 px-3 font-mono text-xs uppercase tracking-button text-muted-foreground hover:text-foreground"
          onClick={() => (onSaveSmartList ? setNaming('smart') : navigate('/leads'))}
        >
          + New smart list
        </button>
      )}

      <RailHeading>Lists</RailHeading>
      <ul className="space-y-1">
        {allLists.length === 0 && <li className="px-3 text-xs text-muted-foreground">Hand-picked people: select leads, then ADD TO LIST.</li>}
        {allLists.map((l) => (
          <li key={l.tag}>
            <button type="button" className={itemClass(activeTag === l.tag)} onClick={() => navigate(`/leads?tag=${encodeURIComponent(l.tag)}`)}>
              <span className="truncate">{l.name}</span>
              <span className="font-mono text-xs tabular-nums">{l.count}</span>
            </button>
          </li>
        ))}
      </ul>
      {naming === 'list' ? (
        <NameForm
          id="new-list"
          label="List name"
          placeholder="e.g. Open house follow-ups"
          onSubmit={async (name) => {
            const added = onNewList ? await onNewList(name) : false;
            if (!added) {
              const next = [...new Set([...readPendingLists(activeId), name])];
              writePendingLists(activeId, next);
              setPending(next);
            }
            setNaming(null);
            loadCounts();
          }}
          onCancel={() => setNaming(null)}
        />
      ) : (
        <button
          type="button"
          className="min-h-10 px-3 font-mono text-xs uppercase tracking-button text-muted-foreground hover:text-foreground"
          onClick={() => setNaming('list')}
        >
          + New list
        </button>
      )}

      <RailHeading>Files</RailHeading>
      {switchBlockedReason && <p className="px-3 pb-1 text-xs text-muted-foreground">{switchBlockedReason}</p>}
      <ul className="space-y-1">
        {usable.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={itemClass(String(c.id) === String(activeId))}
              aria-current={String(c.id) === String(activeId) ? 'true' : undefined}
              disabled={!!switchBlockedReason && String(c.id) !== String(activeId)}
              title={switchBlockedReason || undefined}
              onClick={() => String(c.id) !== String(activeId) && switchTo(c.id)}
            >
              <span className="truncate font-mono text-xs uppercase">{fileLabel(c)}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
