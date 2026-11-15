import { useEffect, useState } from 'react';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import Badge from '../ui/Badge';
import SectionLabel from '../ui/SectionLabel';
import { US_STATES } from '../../lib/usStates';
import * as api from '../../lib/api';
import { useUserSettings } from '../../hooks/useUserSettings';

// One series: a foreground bar on a muted track (docs/DESIGN.md), the
// same as StateReport's dials. The title names it, so no legend.
const BAR_CLASS = 'bg-foreground';

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const RECAL_SETTING_KEY = 'rebuttal-recalibration-dismissed-month';

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/** One suggestion with its review state, plus Approve / Reject while pending. */
function SuggestionRow({ item, label, onReviewed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const review = async (status) => {
    setBusy(true);
    setError(null);
    try {
      await api.reviewSuggestion(item.id, status);
      onReviewed?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <li className="flex items-start justify-between gap-4 border-b py-2 text-sm last:border-b-0" data-testid="suggestion-row">
      <span className="min-w-0 space-y-1">
        {label && <span className="label block">{label}</span>}
        <span className="block text-foreground">{item.text}</span>
        <span className="flex flex-wrap gap-2">
          {item.status === 'approved' ? <Badge tone="solid">approved</Badge> : <Badge>pending review</Badge>}
          {item.note && <Badge tone="dashed">{item.note}</Badge>}
        </span>
        {error && <span role="alert" className="block text-signal">{error}</span>}
      </span>
      {item.status === 'pending' && (
        <span className="flex shrink-0 gap-2">
          <NeuButton onClick={() => review('approved')} disabled={busy}>
            Approve
          </NeuButton>
          <NeuButton onClick={() => review('rejected')} disabled={busy}>
            Reject
          </NeuButton>
        </span>
      )}
    </li>
  );
}

/** Every suggestion still waiting on a person, across objection types. */
function PendingReview({ reviewVersion, onReviewed }) {
  const [pending, setPending] = useState([]);

  useEffect(() => {
    api
      .listPendingSuggestions()
      .then(({ suggestions }) => setPending(suggestions))
      .catch(() => {});
  }, [reviewVersion]);

  if (pending.length === 0) return null;
  return (
    <div className="space-y-2 border border-l-[3px] border-strong border-l-primary bg-card p-4" data-testid="pending-review">
      <p className="text-sm font-semibold text-foreground">
        Waiting for review ({pending.length}) — approved rebuttals show on the call screen and teach the next
        generation
      </p>
      <ul>
        {pending.map((p) => (
          <SuggestionRow
            key={p.id}
            label={p.label}
            item={{ id: p.id, text: p.suggestion, status: 'pending', note: p.review_note }}
            onReviewed={onReviewed}
          />
        ))}
      </ul>
    </div>
  );
}

/** A monthly manual nudge — deliberately not automated drift detection. */
function RecalibrationBanner() {
  // Dismissed per user (a per-user server setting, F-48).
  const { settings, save } = useUserSettings();
  const [hidden, setHidden] = useState(false);
  const show = settings !== null && !hidden && settings[RECAL_SETTING_KEY] !== currentMonth();

  const dismiss = () => {
    setHidden(true);
    save(RECAL_SETTING_KEY, currentMonth()).catch(() => {});
  };

  if (!show) return null;
  return (
    <div
      className="flex items-start justify-between gap-4 border border-strong bg-muted p-4 text-sm text-foreground"
      data-testid="recalibration-banner"
    >
      <span>It's been a month — worth skimming recently approved rebuttals to confirm they still sound like your team.</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss reminder"
        className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-foreground hover:text-background"
      >
        ×
      </button>
    </div>
  );
}

function RebuttalIdeas({ typeId, reviewVersion, onReviewed }) {
  const [result, setResult] = useState(null);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getRebuttalSuggestions(typeId)
      .then(setResult)
      .catch((err) => setError(err.message));
  }, [typeId, reviewVersion]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      setResult(await api.regenerateRebuttals(typeId));
      onReviewed?.(); // new pending suggestions appear in the review list
    } catch (err) {
      setError(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  if (error) return <p role="alert" className="text-sm text-signal">{error}</p>;
  if (!result) return <p className="label">Loading…</p>;

  return (
    <div className="space-y-2 border bg-muted p-4" data-testid="rebuttal-ideas">
      {result.message && <p className="text-sm text-muted-foreground">{result.message}</p>}
      {result.items ? (
        <ul>
          {result.items.map((item) => (
            <SuggestionRow key={item.id} item={item} onReviewed={onReviewed} />
          ))}
        </ul>
      ) : (
        result.suggestions.length > 0 && (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
            {result.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )
      )}
      <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <span>
          {result.source === 'ai' && `AI suggestions from ${result.basedOnCount} logged calls — only approved ones reach the call screen. `}
          {result.source === 'logged' && 'Rebuttals that worked on past calls. '}
          {result.instanceCount} logged with an outcome, {result.positiveCount} positive.
        </span>
        {result.source !== 'insufficient' && (
          <NeuButton className="shrink-0" onClick={handleRegenerate} disabled={regenerating}>
            {regenerating ? 'Generating…' : 'Regenerate'}
          </NeuButton>
        )}
      </div>
    </div>
  );
}

/**
 * Which objections come up most, and how often a call still ended positively
 * (interested or callback) despite one. Positive % is shown as text, not a
 * second bar — it's a different scale from the count.
 */
export default function ObjectionReport() {
  const [filters, setFilters] = useState(() => ({ dateFrom: isoDaysAgo(30), dateTo: isoDaysAgo(0), state: '', officeKey: '' }));
  const [offices, setOffices] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [reviewVersion, setReviewVersion] = useState(0);
  const bumpReview = () => setReviewVersion((v) => v + 1);

  useEffect(() => {
    api.getObjectionOffices().then(({ offices: o }) => setOffices(o)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getObjectionReport(filters)
      .then(({ objections }) => setRows(objections))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters]);

  const update = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const maxCount = Math.max(1, ...rows.map((r) => r.count));

  return (
    <section>
    <SectionLabel index="02" title="Objections logged" className="mb-2" />
    <NeuCard className="space-y-4 p-4">

      <RecalibrationBanner />
      <PendingReview reviewVersion={reviewVersion} onReviewed={bumpReview} />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="label">Filter</span>
        <NeuInput type="date" value={filters.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} className="w-40 font-mono text-sm" aria-label="From date" />
        <span>–</span>
        <NeuInput type="date" value={filters.dateTo} onChange={(e) => update({ dateTo: e.target.value })} className="w-40 font-mono text-sm" aria-label="To date" />
        <NeuInput as="select" value={filters.state} onChange={(e) => update({ state: e.target.value })} className="w-28" aria-label="State">
          <option value="">All states</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NeuInput>
        <NeuInput as="select" value={filters.officeKey} onChange={(e) => update({ officeKey: e.target.value })} className="min-w-0 flex-1" aria-label="Office">
          <option value="">All offices</option>
          {offices.map((o) => (
            <option key={o.officeKey} value={o.officeKey}>
              {o.label}
            </option>
          ))}
        </NeuInput>
      </div>

      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {loading && rows.length === 0 && <p className="label">Loading…</p>}

      {/* A table of objections: label, count bar, count and positive rate. */}
      <div className="border-t">
        {rows.length > 0 && (
          <div className="grid grid-cols-[minmax(0,13rem)_1fr_9rem] gap-4 border-b py-2">
            <span className="label">Objection</span>
            <span className="label">Times logged</span>
            <span className="label whitespace-nowrap text-right">Count · positive</span>
          </div>
        )}
        {rows.map((r) => {
          const rate = r.positiveRate === null ? '—' : `${r.positiveRate}%`;
          const tooltip = `${r.label}: logged ${r.count}× · ${r.positive} of ${r.dispositioned} with an outcome ended positively (${rate})`;
          return (
            <div key={r.id} data-testid="objection-row" className="border-b">
              <button
                type="button"
                onClick={() => setExpanded((id) => (id === r.id ? null : r.id))}
                aria-expanded={expanded === r.id}
                className="grid min-h-12 w-full grid-cols-[minmax(0,13rem)_1fr_9rem] items-center gap-4 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted"
                title={tooltip}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-foreground">{r.label}</span>
                  {!r.is_active && <Badge tone="muted">inactive</Badge>}
                </span>
                <div className="h-2 bg-muted">
                  <div className={`h-2 ${BAR_CLASS}`} style={{ width: `${(r.count / maxCount) * 100}%` }} />
                </div>
                <span className="text-right font-mono tabular-nums">
                  <span className="block font-medium text-foreground" data-testid="objection-count">{r.count}</span>
                  <span className="block text-xs text-muted-foreground" data-testid="objection-rate">
                    {rate} positive
                  </span>
                </span>
              </button>
              {expanded === r.id && (
                <div className="pb-2">
                  <RebuttalIdeas typeId={r.id} reviewVersion={reviewVersion} onReviewed={bumpReview} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        Positive = the call ended Spoke / Interested or Callback. Click an objection for rebuttal ideas.
      </p>
    </NeuCard>
    </section>
  );
}
