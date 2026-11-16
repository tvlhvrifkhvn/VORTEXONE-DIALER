// Bulk actions in the selection strip (C2E): move to a stage, add or remove a
// tag, move to another file (supervisor). One request per action (500 leads
// at most); leads being dialed are skipped and the result says so.
import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { useStages } from '../../hooks/useStages';
import { useCampaign, fileLabel } from '../../hooks/useCampaign';
import { useAuth } from '../../hooks/useAuth';
import * as api from '../../lib/api';

const MAX = 500;

function summary(verb, { updated, skipped }) {
  const reasons = {};
  for (const s of skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  const skippedText = Object.entries(reasons).map(([r, n]) => `${n} ${r}`).join(', ');
  return `${verb} ${updated.length} lead${updated.length === 1 ? '' : 's'}${skipped.length ? `; skipped ${skipped.length} (${skippedText})` : ''}.`;
}

export default function BulkActions({ selectedIds, onDone }) {
  const { stages } = useStages();
  const { usable, activeId } = useCampaign();
  const { user } = useAuth();
  const [stageId, setStageId] = useState('');
  const [tag, setTag] = useState('');
  const [fileId, setFileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const ids = Array.from(selectedIds);
  const tooMany = ids.length > MAX;

  const run = async (fn, verb) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage({ type: 'ok', text: summary(verb, result) });
      onDone(result);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const otherFiles = usable.filter((c) => String(c.id) !== String(activeId));

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Field as="select" value={stageId} onChange={(e) => setStageId(e.target.value)} aria-label="Stage for the selected leads" className="w-48 text-sm">
          <option value="">Move to stage…</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Field>
        <Button onClick={() => run(() => api.bulkMoveStage(ids, Number(stageId)), 'Moved')} disabled={busy || !stageId || tooMany}>
          Move
        </Button>

        <Field value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} placeholder="Tag" aria-label="Tag for the selected leads" className="ml-2 w-36 text-sm" />
        <Button onClick={() => run(() => api.bulkTag(ids, tag.trim(), 'add'), 'Tagged')} disabled={busy || !tag.trim() || tooMany}>
          + Tag
        </Button>
        <Button onClick={() => run(() => api.bulkTag(ids, tag.trim(), 'remove'), 'Untagged')} disabled={busy || !tag.trim() || tooMany}>
          − Tag
        </Button>

        {user?.role === 'supervisor' && otherFiles.length > 0 && (
          <>
            <Field as="select" value={fileId} onChange={(e) => setFileId(e.target.value)} aria-label="File to move the selected leads to" className="ml-2 w-56 text-sm">
              <option value="">Move to file…</option>
              {otherFiles.map((c) => (
                <option key={c.id} value={c.id}>{fileLabel(c)}</option>
              ))}
            </Field>
            <Button
              onClick={() => {
                const target = otherFiles.find((c) => String(c.id) === fileId);
                if (window.confirm(`Move ${ids.length} lead${ids.length === 1 ? '' : 's'} to ${fileLabel(target)}? They start in its first stage.`)) {
                  run(() => api.bulkMoveCampaign(ids, Number(fileId)), 'Moved');
                }
              }}
              disabled={busy || !fileId || tooMany}
            >
              Move to file
            </Button>
          </>
        )}
      </div>
      {tooMany && <p className="text-sm text-signal">Bulk actions take {MAX} leads at a time. Narrow the selection.</p>}
      {message && (
        <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
