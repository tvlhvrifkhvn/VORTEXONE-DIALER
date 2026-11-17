// /pipeline (C2B): the active file's board. One column per stage with its
// count; cards show the name, company, dialer status and last activity.
// Move a card by native drag and drop or by its "MOVE →" menu (keyboard).
// "LOAD MORE" pages one column. Stage moves never touch the dialer status.
// C7E: a search field filters every column (name, company, phone digits or
// tag; CLEAR restores the board); the board scrolls sideways inside its own
// area and each column scrolls on its own; cards also show tags and a CALL link.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Field from '../components/ui/Field';
import AppShell from '../components/layout/AppShell';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import FileTag from '../components/ui/FileTag';
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
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(lead.id));
        e.dataTransfer.setData('text/plain', lead.name);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="cursor-grab space-y-2 border border-strong bg-background p-2 active:cursor-grabbing"
    >
      <button
        type="button"
        onClick={() => navigate(`/leads/${lead.id}`)}
        className="block w-full truncate text-left font-medium text-foreground underline-offset-4 hover:underline"
        title={`Open ${lead.name}`}
      >
        {lead.name}
      </button>
      <p className="truncate text-sm text-muted-foreground" title={lead.brokerage || ''}>
        {lead.brokerage || `No ${companyWord}`}
      </p>
      {lead.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lead.tags.map((t) => (
            <Badge key={t} tone={t.startsWith('list:') ? 'solid' : 'muted'}>
              {t.startsWith('list:') ? `List · ${t.slice(5)}` : t}
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={lead.status} />
        <StageMoveMenu lead={lead} stages={stages} onMove={onMove} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          <span className="sr-only">Last activity </span>
          {formatRelativeToNow(lead.activity_at || lead.updated_at)}
        </p>
        <Link
          to={`/call/${lead.id}`}
          className="inline-flex min-h-10 items-center px-2 font-mono text-xs uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted"
          aria-label={`Call ${lead.name}`}
        >
          Call
        </Link>
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
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = Number(e.dataTransfer.getData(DRAG_TYPE));
        if (id) onDropLead(id, stage);
      }}
      className={`flex w-72 shrink-0 flex-col border bg-card transition-colors duration-150 lg:max-h-full lg:min-h-0 ${over ? 'border-strong bg-muted' : ''}`}
    >
      <header className="flex items-center justify-between gap-2 border-b px-2 py-2">
        <h2 className="label truncate text-foreground">{stage.name}</h2>
        <span className="flex items-center gap-2">
          {stage.kind !== 'open' && <Badge tone={stageTone(stage.kind)}>{stage.kind}</Badge>}
          <span className="font-mono text-sm tabular-nums text-foreground">{stage.count}</span>
        </span>
      </header>
      <ul className="flex-1 space-y-2 p-2 lg:min-h-0 lg:overflow-y-auto">
        {stage.leads.length === 0 && <li className="px-1 py-4 text-sm text-muted-foreground">{searching ? 'No matches' : 'No leads'}</li>}
        {stage.leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} stages={stages} onMove={onMove} companyWord={companyWord} />
        ))}
      </ul>
      {stage.leads.length < stage.count && (
        <div className="border-t p-2">
          <Button className="w-full" onClick={() => onLoadMore(stage)} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Load more (${stage.count - stage.leads.length})`}
          </Button>
        </div>
      )}
    </section>
  );
}

export default function Pipeline() {
  const { active } = useCampaign();
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

  return (
    <AppShell framed>
      <div className="flex flex-col gap-4 px-6 pb-6 pt-6 lg:h-full lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-4 lg:shrink-0">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Pipeline</h1>
          {active && <FileTag number={active.file_number} name={active.name} />}
        </div>
        <div className="flex flex-wrap items-end gap-2 lg:shrink-0">
          <div>
            <label htmlFor="pipeline-search" className="label mb-1 block">
              Search the board
            </label>
            <Field
              id="pipeline-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, company, phone or tag"
              className="w-80 max-w-full"
            />
          </div>
          {query && (
            <Button variant="ghost" onClick={() => setQuery('')}>
              Clear
            </Button>
          )}
          {search && (
            <span className="label pb-3 tabular-nums" role="status">
              {columns.reduce((n, c) => n + c.count, 0)} match{columns.reduce((n, c) => n + c.count, 0) === 1 ? '' : 'es'}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground lg:shrink-0">
          Drag a card to another column, or use MOVE →. Moving a lead here never changes its dialer status.
        </p>
        <p role="status" aria-live="polite" className="sr-only">{announce}</p>
        {error && (
          <p role="alert" className="text-sm text-signal">
            <span className="label mr-2 text-signal">Error</span>
            {error}
          </p>
        )}
        {loading ? (
          <p className="label">Loading…</p>
        ) : (
          // relative: the cards' sr-only labels (absolute) stay inside the scroll box.
          <div className="relative flex items-start gap-4 overflow-x-auto pb-4 lg:min-h-0 lg:flex-1 lg:items-stretch" data-testid="pipeline-board">
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
