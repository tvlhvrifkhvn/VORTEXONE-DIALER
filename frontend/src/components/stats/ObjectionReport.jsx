import { useEffect, useState } from 'react';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import Badge from '../ui/Badge';
import { US_STATES } from '../../lib/usStates';
import * as api from '../../lib/api';

// Slot 1 of the validated categorical palette (same as StateReport's dials).
// One series, so one hue and no legend — the title names it.
const BAR_COLOR = '#2A78D6';

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
    <li className="flex items-start justify-between gap-3 text-xs" data-testid="suggestion-row">
      <span className="min-w-0 space-y-0.5">
        {label && <span className="block text-[10px] font-semibold text-text-secondary">{label}</span>}
        <span className="block text-text-primary">{item.text}</span>
        <span className="flex flex-wrap gap-1">
          {item.status === 'approved' ? (
            <Badge color="#1A9E6E">approved</Badge>
          ) : (
            <Badge color="#B7791F">pending review</Badge>
          )}
          {item.note && <Badge color="#D64545">{item.note}</Badge>}
        </span>
        {error && <span className="block text-action-hangup">{error}</span>}
      </span>
      {item.status === 'pending' && (
        <span className="flex shrink-0 gap-1.5">
          <NeuButton className="text-[11px]" onClick={() => review('approved')} disabled={busy}>
            Approve
          </NeuButton>
          <NeuButton className="text-[11px]" onClick={() => review('rejected')} disabled={busy}>
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
    <div className="space-y-2 rounded-input bg-surface p-3 shadow-neu-inset" data-testid="pending-review">
      <p className="text-xs font-semibold text-text-primary">
        Waiting for review ({pending.length}) — approved rebuttals show on the call screen and teach the next
        generation
      </p>
      <ul className="space-y-2">
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
  const [show, setShow] = useState(false);

  useEffect(() => {
    api
      .getSetting(RECAL_SETTING_KEY)
      .then(({ value }) => setShow(value !== currentMonth()))
      .catch(() => {});
  }, []);

  const dismiss = () => {
    setShow(false);
    api.putSetting(RECAL_SETTING_KEY, currentMonth()).catch(() => {});
  };

  if (!show) return null;
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-input bg-surface p-3 text-xs text-text-primary shadow-neu-sm"
      data-testid="recalibration-banner"
    >
      <span>It's been a month — worth skimming recently approved rebuttals to confirm they still sound like your team.</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss reminder" className="shrink-0 text-text-secondary hover:text-text-primary">
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

  if (error) return <p className="text-xs text-action-hangup">{error}</p>;
  if (!result) return <p className="text-xs text-text-secondary">Loading…</p>;

  return (
    <div className="space-y-2 rounded-input bg-surface p-3 shadow-neu-inset" data-testid="rebuttal-ideas">
      {result.message && <p className="text-xs text-text-secondary">{result.message}</p>}
      {result.items ? (
        <ul className="space-y-1.5">
          {result.items.map((item) => (
            <SuggestionRow key={item.id} item={item} onReviewed={onReviewed} />
          ))}
        </ul>
      ) : (
        result.suggestions.length > 0 && (
          <ol className="list-decimal space-y-1 pl-5 text-xs text-text-primary">
            {result.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )
      )}
      <div className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
        <span>
          {result.source === 'ai' && `AI suggestions from ${result.basedOnCount} logged calls — only approved ones reach the call screen. `}
          {result.source === 'logged' && 'Rebuttals that worked on past calls. '}
          {result.instanceCount} logged with an outcome, {result.positiveCount} positive.
        </span>
        {result.source !== 'insufficient' && (
          <NeuButton className="shrink-0 text-xs" onClick={handleRegenerate} disabled={regenerating}>
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
    <NeuCard className="space-y-4 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Objections logged</h2>

      <RecalibrationBanner />
      <PendingReview reviewVersion={reviewVersion} onReviewed={bumpReview} />

      <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <NeuInput type="date" value={filters.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} className="w-36" aria-label="From date" />
        <span>–</span>
        <NeuInput type="date" value={filters.dateTo} onChange={(e) => update({ dateTo: e.target.value })} className="w-36" aria-label="To date" />
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

      {error && <p className="text-sm text-action-hangup">{error}</p>}
      {loading && rows.length === 0 && <p className="text-sm text-text-secondary">Loading…</p>}

      <div className="space-y-3">
        {rows.map((r) => {
          const rate = r.positiveRate === null ? '—' : `${r.positiveRate}%`;
          const tooltip = `${r.label}: logged ${r.count}× · ${r.positive} of ${r.dispositioned} with an outcome ended positively (${rate})`;
          return (
            <div key={r.id} data-testid="objection-row">
              <button
                type="button"
                onClick={() => setExpanded((id) => (id === r.id ? null : r.id))}
                aria-expanded={expanded === r.id}
                className="grid w-full grid-cols-[minmax(0,13rem)_1fr_5.5rem] items-center gap-3 text-left text-sm"
                title={tooltip}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium text-text-primary">{r.label}</span>
                  {!r.is_active && <Badge>inactive</Badge>}
                </span>
                <div className="h-2.5 rounded-full bg-shadow/20">
                  <div className="h-2.5 rounded-full" style={{ width: `${(r.count / maxCount) * 100}%`, backgroundColor: BAR_COLOR }} />
                </div>
                <span className="text-right">
                  <span className="block font-medium text-text-primary" data-testid="objection-count">{r.count}</span>
                  <span className="block text-[10px] text-text-secondary" data-testid="objection-rate">
                    {rate} positive
                  </span>
                </span>
              </button>
              {expanded === r.id && (
                <div className="mt-2">
                  <RebuttalIdeas typeId={r.id} reviewVersion={reviewVersion} onReviewed={bumpReview} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-text-secondary">
        Positive = the call ended Spoke / Interested or Callback. Click an objection for rebuttal ideas.
      </p>
    </NeuCard>
  );
}
