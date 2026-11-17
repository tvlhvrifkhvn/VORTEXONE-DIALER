// The leads page's DUPLICATES view (C6B): likely duplicate pairs side by
// side with their reasons; pick which lead to keep, then REVIEW MERGE opens a
// Dialog to choose field values and see everything that will move. There is
// no undo, so MERGE is only in that Dialog.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import FileTag from '../ui/FileTag';
import Segmented from '../ui/Segmented';
import Dialog from '../ui/Dialog';
import StatusBadge from './StatusBadge';
import { formatPhone } from '../../lib/format';
import { showToast } from '../../hooks/useCampaign';
import * as api from '../../lib/api';

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'brokerage', label: 'Company' },
  { key: 'state', label: 'State' },
];

const empty = (v) => v === null || v === undefined || String(v).trim() === '';
const show = (v) => (empty(v) ? '—' : String(v));

function LeadSide({ lead, primary, onPick, pairKey }) {
  const id = `keep-${pairKey}-${lead.id}`;
  return (
    <div className={`space-y-2 border p-4 ${primary ? 'border-strong' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FileTag number={lead.file_number} name={lead.file_name} />
        <label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-2 font-mono text-xs uppercase tracking-button text-foreground">
          <input id={id} type="radio" name={`keep-${pairKey}`} checked={primary} onChange={onPick} className="h-4 w-4 accent-current" />
          Keep this one
        </label>
      </div>
      <Link to={`/leads/${lead.id}`} className="block text-base font-medium text-foreground underline underline-offset-4 hover:bg-muted">
        {lead.name}
      </Link>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1 text-sm">
        <dt className="label">Phone</dt>
        <dd className="font-mono tabular-nums text-foreground">{lead.phone ? formatPhone(lead.phone) : '—'}</dd>
        <dt className="label">Email</dt>
        <dd className="truncate text-foreground">{show(lead.email)}</dd>
        <dt className="label">{lead.company_label || 'Company'}</dt>
        <dd className="text-foreground">{show(lead.brokerage)}</dd>
        <dt className="label">State</dt>
        <dd className="text-foreground">{show(lead.state)}</dd>
        <dt className="label">Stage</dt>
        <dd className="text-foreground">{show(lead.stage_name)}</dd>
        <dt className="label">Attempts</dt>
        <dd className="font-mono tabular-nums text-foreground">
          {lead.attempts} / {lead.max_attempts}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={lead.status} />
        {(lead.tags || []).map((t) => (
          <Badge key={t} tone="muted">
            {t}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function MergeDialog({ primaryId, secondaryId, onClose, onMerged }) {
  const [preview, setPreview] = useState(null);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getMergePreview(primaryId, secondaryId)
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, [primaryId, secondaryId]);

  const rows = preview
    ? [
        ...FIELDS.map((f) => ({ key: f.key, label: f.key === 'brokerage' ? preview.primary.company_label || f.label : f.label, p: preview.primary[f.key], s: preview.secondary[f.key] })),
        ...preview.customFields.map((f) => ({ key: `custom.${f.key}`, label: f.label, p: preview.primary.custom?.[f.key], s: preview.secondary.custom?.[f.key] })),
      ].filter((r) => !empty(r.s) && String(r.p ?? '') !== String(r.s))
    : [];
  // An empty primary value takes the secondary's (the server's rule); otherwise the primary's unless chosen.
  const chosen = (r) => choices[r.key] || (empty(r.p) ? 'secondary' : 'primary');

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const fieldChoices = Object.fromEntries(rows.map((r) => [r.key, chosen(r)]));
      await api.mergeLeads({ primaryId, secondaryId, fieldChoices });
      showToast(`Merged into ${preview.primary.name}`);
      onMerged();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Merge leads" onClose={busy ? undefined : onClose} className="max-w-2xl">
      {!preview ? (
        error ? <p role="alert" className="text-sm text-signal">{error}</p> : <p className="label">Loading…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            <span className="font-medium">{preview.secondary.name}</span> will be merged into{' '}
            <span className="font-medium">{preview.primary.name}</span> and removed from every list. There is no undo.
          </p>
          {rows.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="label mb-2">Values that differ: pick one</legend>
              <table className="w-full text-sm">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b align-top">
                      <th scope="row" className="label w-28 py-2 pr-2 text-left font-medium">{r.label}</th>
                      {['primary', 'secondary'].map((side) => {
                        const id = `choice-${r.key}-${side}`;
                        return (
                          <td key={side} className="py-2 pr-2">
                            <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-foreground">
                              <input
                                id={id}
                                type="radio"
                                name={`choice-${r.key}`}
                                checked={chosen(r) === side}
                                onChange={() => setChoices((c) => ({ ...c, [r.key]: side }))}
                                className="mt-1 h-4 w-4 accent-current"
                              />
                              <span className="break-words">{show(side === 'primary' ? r.p : r.s)}</span>
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </fieldset>
          )}
          <div>
            <p className="label mb-1">What moves to {preview.primary.name}</p>
            {preview.moves.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history on the other lead.</p>
            ) : (
              <ul className="list-inside list-disc text-sm text-foreground">
                {preview.moves.map((m) => (
                  <li key={m.table}>
                    <span className="font-mono tabular-nums">{m.count}</span> {m.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-sm text-muted-foreground">
              Tags are joined, attempts take the higher count, and a note records the merge
              {preview.secondary.phone ? ` and the other lead's phone, ${formatPhone(preview.secondary.phone)}` : ''}.
            </p>
          </div>
          {preview.dncWins && (
            <p className="border-l-[3px] border-l-primary bg-muted px-4 py-2 text-sm text-foreground">
              One of these leads is Do Not Call: the kept lead becomes DNC and both numbers go on the DNC list.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-signal">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={merge} disabled={busy}>
              {busy ? 'Merging…' : 'Merge'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function DuplicatesView({ onMerged }) {
  const [scope, setScope] = useState('file');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [keep, setKeep] = useState({}); // pair key → primary id
  const [merging, setMerging] = useState(null); // { primaryId, secondaryId }

  const load = useCallback(async () => {
    try {
      setData(await api.getDuplicates(scope === 'all' ? 'ALL' : undefined));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4" data-testid="duplicates">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Segmented
          label="Which files"
          options={[
            { value: 'file', label: 'This file' },
            { value: 'all', label: 'All files' },
          ]}
          value={scope}
          onChange={setScope}
        />
        {data && (
          <span className="label tabular-nums">
            {data.total} likely duplicate pair{data.total === 1 ? '' : 's'}
            {data.total > data.pairs.length ? ` · showing ${data.pairs.length}` : ''}
          </span>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {!data ? (
        <p className="label">Loading…</p>
      ) : data.pairs.length === 0 ? (
        <Panel className="p-4">
          <p className="text-sm text-muted-foreground">No likely duplicates: no shared email, name and company, or name, state and office.</p>
        </Panel>
      ) : (
        data.pairs.map((pair) => {
          const [a, b] = pair.leads;
          const primaryId = keep[pair.key] || a.id;
          const secondaryId = primaryId === a.id ? b.id : a.id;
          return (
            <Panel key={pair.key} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {pair.reasons.map((r) => (
                  <Badge key={r} tone="solid">
                    {r}
                  </Badge>
                ))}
                {pair.crossFile && <Badge tone="dashed">Different files</Badge>}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {[a, b].map((lead) => (
                  <LeadSide
                    key={lead.id}
                    lead={lead}
                    pairKey={pair.key}
                    primary={lead.id === primaryId}
                    onPick={() => setKeep((k) => ({ ...k, [pair.key]: lead.id }))}
                  />
                ))}
              </div>
              <div className="flex justify-end">
                <Button onClick={() => setMerging({ primaryId, secondaryId })}>Review merge</Button>
              </div>
            </Panel>
          );
        })
      )}
      {merging && (
        <MergeDialog
          {...merging}
          onClose={() => setMerging(null)}
          onMerged={() => {
            setMerging(null);
            load();
            onMerged?.();
          }}
        />
      )}
    </div>
  );
}
