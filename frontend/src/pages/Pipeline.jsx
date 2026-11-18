// /pipeline (C2B): the active file's board. One column per stage with its
// count; cards show the name, company, dialer status and last activity.
// Move a card by native drag and drop or by its "MOVE →" menu (keyboard).
// "LOAD MORE" pages one column. Stage moves never touch the dialer status.
// C7E: a search field filters every column (name, company, phone digits or
// tag; CLEAR restores the board); the board scrolls sideways inside its own
// area and each column scrolls on its own; cards also show tags and a CALL link.
// C8D: one header row (Pipeline and the open count; the search field with ×).
// The board fills the height under it and scrolls sideways only (overflow-y
// hidden: overflow-x alone made it scroll vertically too). Columns 280px,
// 12px apart: a header, a card list that scrolls on its own with LOAD MORE at
// its end; an empty column stays a full-height drop zone; the drop target gets
// a 2px outline. Cards share one height: name · company · status and last
// activity, CALL and MOVE → on the right; tags and the drag hint are in the
// card's tooltip.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Field from '../components/ui/Field';
import AppShell from '../components/layout/AppShell';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import StatusBadge from '../components/leads/StatusBadge';
import StageMoveMenu from '../components/pipeline/StageMoveMenu';
import { useCampaign } from '../hooks/useCampaign';
import { stageTone } from '../hooks/useStages';
import { formatRelativeToNow } from '../lib/format';
import * as api from '../lib/api';

const PER_STAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const DRAG_TYPE = 'application/x-vortex-lead';

function LeadCard({ lead, stages, onMove, companyWord }) {
  const navigate = useNavigate();
  const tags = (lead.tags || []).map((t) => (t.startsWith('list:') ? `List · ${t.slice(5)}` : t));
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(lead.id));
        e.dataTransfer.setData('text/plain', lead.name);
        e.dataTransfer.effectAllowed = 'move';
      }}
      title={`Drag to another column, or use MOVE →${tags.length ? `\nTags: ${tags.join(', ')}` : ''}`}
      className="flex h-[6.5rem] cursor-grab gap-2 border border-strong bg-background p-2 active:cursor-grabbing"
      data-testid="pipeline-card"
    >
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <button
          type="button"
          onClick={() => navigate(`/leads/${lead.id}`)}
          className="block w-full truncate text-left font-semibold text-foreground underline-offset-4 hover:underline"
          aria-label={`Open ${lead.name}`}
        >
          {lead.name}
        </button>
        <p className="truncate text-sm text-muted-foreground">{lead.brokerage || `No ${companyWord}`}</p>
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge status={lead.status} />
          <span className="truncate font-mono text-xs tabular-nums text-muted-foreground">
            <span className="sr-only">Last activity </span>
            {formatRelativeToNow(lead.activity_at || lead.updated_at)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between">
        <Link
          to={`/call/${lead.id}`}
          className="inline-flex min-h-8 items-center px-2 font-mono text-xs font-medium uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted"
          aria-label={`Call ${lead.name}`}
        >
          Call
        </Link>
        <StageMoveMenu lead={lead} stages={stages} onMove={onMove} />
      </div>
    </li>
  );
}

function Column({ stage, stages, onMove, onDropLead, onLoadMore, loadingMore, companyWord, searching }) {
  const [over, setOver] = useState(false);
  return (
    <section
      aria-label={`${stage.name}, ${stage.count} lead${stage.count === 1 ? '' : 's'}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = Number(e.dataTransfer.getData(DRAG_TYPE));
        if (id) onDropLead(id, stage);
      }}
      className={`flex w-[280px] shrink-0 flex-col border bg-card lg:h-full lg:min-h-0 ${over ? 'outline outline-2 -outline-offset-2 outline-foreground' : ''}`}
      data-testid="pipeline-column"
    >
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b px-2">
        <h2 className="label truncate text-foreground">{stage.name}</h2>
        <span className="flex items-center gap-2">
          {stage.kind !== 'open' && <Badge tone={stageTone(stage.kind)}>{stage.kind}</Badge>}
          <span className="font-mono text-sm tabular-nums text-foreground">{stage.count}</span>
        </span>
      </header>
      <ul className="relative flex-1 space-y-2 p-2 lg:min-h-0 lg:overflow-y-auto">
        {stage.leads.length === 0 && <li className="px-1 py-4 text-sm text-muted-foreground">{searching ? 'No matches' : 'No leads'}</li>}
        {stage.leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} stages={stages} onMove={onMove} companyWord={companyWord} />
        ))}
        {stage.leads.length < stage.count && (
          <li>
            <Button size="sm" className="w-full" onClick={() => onLoadMore(stage)} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : `Load more (${stage.count - stage.leads.length})`}
            </Button>
          </li>
        )}
      </ul>
    </section>
  );
}

export default function Pipeline() {
  const { active } = useCampaign(); // the company word only (the file shows in the header switcher)
  const companyWord = (active?.company_label || 'Brokerage').toLowerCase();
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState(null);
  const [error, setError] = useState(null);
  const [announce, setAnnounce] = useState('');
  // C7E: what's typed, and the search in use (debounced).
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    try {
      const board = await api.getPipelineBoard({ perStage: PER_STAGE, search: search || undefined });
      setColumns(board.stages);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  const stages = columns.map(({ leads: _leads, ...s }) => s);

  const move = async (lead, stage) => {
    if (lead.pipeline_stage_id === stage.id) return;
    setError(null);
    try {
      await api.moveLeadStage(lead.id, stage.id);
      setAnnounce(`Moved ${lead.name} to ${stage.name}.`);
      await load();
    } catch (err) {
      setError(`Couldn't move ${lead.name}: ${err.message}`);
    }
  };

  const dropLead = (leadId, stage) => {
    const lead = columns.flatMap((c) => c.leads).find((l) => l.id === leadId);
    if (lead) move(lead, stage);
  };

  const loadMore = async (stage) => {
    setLoadingStage(stage.id);
    try {
      const page = await api.getPipelineBoard({ perStage: PER_STAGE, stageId: stage.id, offset: stage.leads.length, search: search || undefined });
      const more = page.stages[0]?.leads || [];
      setColumns((cols) =>
        cols.map((c) => {
          if (c.id !== stage.id) return c;
          const seen = new Set(c.leads.map((l) => l.id));
          return { ...c, count: page.stages[0]?.count ?? c.count, leads: [...c.leads, ...more.filter((l) => !seen.has(l.id))] };
        })
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingStage(null);
    }
  };

  const openCount = columns.filter((c) => c.kind === 'open').reduce((n, c) => n + c.count, 0);
  const matches = columns.reduce((n, c) => n + c.count, 0);

  return (
    <AppShell framed>
      <div className="flex flex-col gap-4 px-6 pb-6 pt-6 lg:h-full lg:min-h-0">
        {/* Header row: title and the open count; the search field with × on the right. */}
        <div className="flex min-h-11 items-center justify-between gap-4 lg:shrink-0">
          <h1 className="flex items-baseline gap-4">
            <span className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Pipeline</span>
            <span className="font-mono text-sm tabular-nums text-muted-foreground" title={search ? 'Matches on the board' : 'Leads in open stages'}>
              {search ? `${matches} match${matches === 1 ? '' : 'es'}` : openCount}
            </span>
          </h1>
          <div className="relative w-[320px] max-w-full">
            <Field
              id="pipeline-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, company, phone or tag"
              aria-label="Search the board"
              className="w-full pr-10"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear the search"
                className="absolute right-1 top-1/2 inline-flex min-h-8 min-w-8 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
              >
                ×
              </button>
            )}
          </div>
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
          {search ? ` ${matches} matches.` : ''}
        </p>
        {error && (
          <p role="alert" className="text-sm text-signal lg:shrink-0">
            <span className="label mr-2 text-signal">Error</span>
            {error}
          </p>
        )}
        {loading ? (
          <p className="label">Loading…</p>
        ) : (
          // relative: the cards' sr-only labels (absolute) stay inside the scroll box.
          // Sideways only: overflow-y hidden, so the page never runs past the board.
          <div className="relative flex items-start gap-3 overflow-x-auto overflow-y-hidden lg:min-h-0 lg:flex-1 lg:items-stretch" data-testid="pipeline-board">
            {columns.map((stage) => (
              <Column
                key={stage.id}
                stage={stage}
                stages={stages}
                onMove={move}
                onDropLead={dropLead}
                onLoadMore={loadMore}
                loadingMore={loadingStage === stage.id}
                companyWord={companyWord}
                searching={Boolean(search)}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
