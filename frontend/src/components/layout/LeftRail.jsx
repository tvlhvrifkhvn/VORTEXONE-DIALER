// The Leads page's left rail (C7C; C8B: Leads only, Today has none):
//   ALL LEADS    clears the filters, with the file's lead count
//   SMART LISTS  your saved views with live counts (one counts request, C7A);
//                "+" saves the current filters as one; the open one has × (delete)
//   LISTS        hand-picked groups: tags that start with "list:", with counts;
//                "+" names a new list
//   STATES       collapsible; one count per state (not contacted in the tooltip)
// "+ LIST" asks for a name: with leads selected they're added at once
// (onNewList); otherwise the name waits here (this browser) until leads are
// added with ADD TO LIST. An empty group says "None yet".
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Field from '../ui/Field';
import Button from '../ui/Button';
import { useCampaign } from '../../hooks/useCampaign';
import { pollWhileVisible } from '../../lib/poll';
import * as api from '../../lib/api';

const POLL_MS = 30000;
const PENDING_KEY = 'vortex.lists.pending.';
const STATES_OPEN_KEY = 'vortex.rail.states.open';

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

/** A group header: the label, and an optional 32px "+" (or ▾) on the right. */
function RailHeading({ children, action = null }) {
  return (
    <div className="mb-1 mt-4 flex min-h-8 items-center justify-between gap-2 pl-3">
      <h2 className="label">{children}</h2>
      {action}
    </div>
  );
}

const plusClass =
  'inline-flex min-h-8 min-w-8 items-center justify-center font-mono text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent';

const Empty = () => <li className="px-3 py-2 text-xs text-muted-foreground">None yet</li>;

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
        <Button type="submit" variant="solid" size="sm" disabled={!name.trim()}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function LeftRail({
  activeViewId = null,
  activeTag = null,
  allCount = null,
  allActive = false,
  onAll,
  onSaveSmartList,
  canSaveSmartList = false,
  nameSmartList = 0,
  onNewList = null,
  refreshKey = 0,
  states = [],
  selectedState = null,
  onSelectState,
}) {
  const navigate = useNavigate();
  const { activeId } = useCampaign();
  const [views, setViews] = useState([]);
  const [lists, setLists] = useState([]);
  const [pending, setPending] = useState(() => readPendingLists(activeId));
  const [naming, setNaming] = useState(null); // 'smart' | 'list' | null
  const [error, setError] = useState(null);
  const [statesOpen, setStatesOpen] = useState(() => {
    try {
      return localStorage.getItem(STATES_OPEN_KEY) !== 'false';
    } catch {
      return true;
    }
  });

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

  // The page's ⋯ → "Save filters as a smart list" opens the same name form.
  useEffect(() => {
    if (nameSmartList) setNaming('smart');
  }, [nameSmartList]);

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

  // From the old saved-views bar (C2E): delete a smart list, with its confirm.
  const removeView = async (view) => {
    if (!window.confirm(`Delete the smart list "${view.name}"?`)) return;
    setError(null);
    try {
      await api.deleteView(view.id);
      if (activeViewId === view.id) onAll?.();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleStates = () =>
    setStatesOpen((o) => {
      try {
        localStorage.setItem(STATES_OPEN_KEY, String(!o));
      } catch {
        /* lasts for this visit */
      }
      return !o;
    });

  return (
    <nav aria-label="Lists and states" className="pb-4 pt-2" data-testid="left-rail">
      <button type="button" className={itemClass(allActive)} aria-current={allActive ? 'true' : undefined} onClick={() => onAll?.()}>
        <span className="font-mono text-xs font-medium uppercase tracking-button">All leads</span>
        <span className="font-mono text-xs tabular-nums">{allCount ?? '…'}</span>
      </button>

      <RailHeading
        action={
          <button
            type="button"
            className={plusClass}
            onClick={() => setNaming('smart')}
            disabled={!canSaveSmartList}
            aria-label="Save the current filters as a smart list"
            title={canSaveSmartList ? 'Save the current filters as a smart list' : 'Set some filters first, then save them as a smart list'}
          >
            +
          </button>
        }
      >
        Smart lists
      </RailHeading>
      {naming === 'smart' && (
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
      )}
      <ul className="space-y-1">
        {views.length === 0 && <Empty />}
        {views.map((v) => (
          <li key={v.id} className="flex">
            <button type="button" className={itemClass(activeViewId === v.id)} onClick={() => navigate(`/leads?view=${v.id}`)}>
              <span className="truncate">{v.name}</span>
              <span className="font-mono text-xs tabular-nums">{v.count ?? '…'}</span>
            </button>
            {activeViewId === v.id && (
              <button type="button" className={plusClass} onClick={() => removeView(v)} aria-label={`Delete smart list ${v.name}`} title="Delete this smart list">
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="px-3 text-xs text-signal">{error}</p>}

      <RailHeading
        action={
          <button type="button" className={plusClass} onClick={() => setNaming('list')} aria-label="New list" title="New list (selected leads are added to it)">
            +
          </button>
        }
      >
        Lists
      </RailHeading>
      {naming === 'list' && (
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
      )}
      <ul className="space-y-1">
        {allLists.length === 0 && <Empty />}
        {allLists.map((l) => (
          <li key={l.tag}>
            <button type="button" className={itemClass(activeTag === l.tag)} onClick={() => navigate(`/leads?tag=${encodeURIComponent(l.tag)}`)}>
              <span className="truncate">{l.name}</span>
              <span className="font-mono text-xs tabular-nums">{l.count}</span>
            </button>
          </li>
        ))}
      </ul>

      <RailHeading
        action={
          <button type="button" className={plusClass} onClick={toggleStates} aria-expanded={statesOpen} aria-controls="rail-states" aria-label={statesOpen ? 'Hide states' : 'Show states'}>
            {statesOpen ? '▾' : '▸'}
          </button>
        }
      >
        States
      </RailHeading>
      {statesOpen && (
        <ul id="rail-states" className="space-y-1">
          {states.length === 0 && <Empty />}
          {states.map((c) => (
            <li key={c.state}>
              <button
                type="button"
                className={itemClass(selectedState === c.state)}
                aria-pressed={selectedState === c.state}
                title={`${c.uncontacted} not contacted`}
                onClick={() => onSelectState?.(selectedState === c.state ? null : c.state)}
              >
                <span className="font-mono text-xs uppercase">{c.state}</span>
                <span className="font-mono text-xs tabular-nums">{c.total}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
