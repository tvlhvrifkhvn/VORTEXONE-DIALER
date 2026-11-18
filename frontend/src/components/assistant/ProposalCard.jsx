// A proposal from the assistant (C5C): a task or a stage move it suggested.
// Nothing has happened yet. CONFIRM calls the existing tasks or pipeline
// route as the owner; DISMISS just closes it. The outcome stays on the card.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

export default function ProposalCard({ proposal, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const p = proposal;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      if (p.kind === 'task') await api.createTask({ leadId: p.leadId, title: p.title, type: p.type, dueAt: p.dueAt });
      else await api.moveLeadStage(p.leadId, p.stageId);
      onResolved('confirmed');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border border-dashed border-strong px-3 py-2" data-testid="proposal-card">
      <div className="flex items-center justify-between gap-2">
        <p className="label">{p.kind === 'task' ? 'Proposed task' : 'Proposed stage move'}</p>
        {p.status === 'confirmed' && <Badge tone="solid">Done</Badge>}
        {p.status === 'dismissed' && <Badge tone="muted">Dismissed</Badge>}
      </div>
      <p className="text-sm text-foreground">
        {p.kind === 'task' ? (
          <>
            {p.title} <span className="text-muted-foreground">· {p.type} · due</span>{' '}
            <span className="font-mono tabular-nums">{formatDateTime(p.dueAt)}</span>
          </>
        ) : (
          <>
            {p.fromStage || 'Current stage'} → <span className="font-medium">{p.stageName}</span>
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        For{' '}
        <Link to={`/leads/${p.leadId}`} className="underline underline-offset-4">
          {p.leadName}
        </Link>
      </p>
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {!p.status && (
        <div className="flex gap-2">
          <Button variant="primary" onClick={confirm} disabled={busy}>
            {busy ? 'Saving…' : 'Confirm'}
          </Button>
          <Button variant="ghost" onClick={() => onResolved('dismissed')} disabled={busy}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
