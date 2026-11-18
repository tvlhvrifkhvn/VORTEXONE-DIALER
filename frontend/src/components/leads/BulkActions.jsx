// Bulk actions in the selection strip (C2E): move to a stage, add or remove a
// tag, move to another file (supervisor). One request per action (500 leads
// at most); leads being dialed are skipped and the result says so.
// C8B: STAGE · TAG · FILE are compact buttons in the strip, each opening its
// fields in a popover; the result line goes to the page (onMessage).
import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { Popover } from '../ui/Menu';
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

export default function BulkActions({ selectedIds, onDone, onMessage }) {
  const { stages } = useStages();
  const { usable, activeId } = useCampaign();
  const { user } = useAuth();
  const [stageId, setStageId] = useState('');
  const [tag, setTag] = useState('');
  const [fileId, setFileId] = useState('');
  const [busy, setBusy] = useState(false);
  const setMessage = (m) => onMessage?.(m);

  const ids = Array.from(selectedIds);
  const tooMany = ids.length > MAX;

  const run = async (fn, verb, close) => {
    close?.();
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

  const tooManyText = tooMany ? `Bulk actions take ${MAX} leads at a time. Narrow the selection.` : null;
  const pop = 'p-3 space-y-2';
  return (
    <>
      <Popover label="Stage ▾" ariaLabel="Move the selected leads to a stage" variant="secondary" size="sm" align="left" panelClassName={`w-72 ${pop}`}>
        {({ close }) => (
          <>
            <Field as="select" value={stageId} onChange={(e) => setStageId(e.target.value)} aria-label="Stage for the selected leads" className="w-full text-sm">
              <option value="">Move to stage…</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Field>
            {tooManyText && <p className="text-xs text-signal">{tooManyText}</p>}
            <Button variant="solid" size="sm" onClick={() => run(() => api.bulkMoveStage(ids, Number(stageId)), 'Moved', close)} disabled={busy || !stageId || tooMany}>
              Move {ids.length}
            </Button>
          </>
        )}
      </Popover>

      <Popover label="Tag ▾" ariaLabel="Tag the selected leads" variant="secondary" size="sm" align="left" panelClassName={`w-72 ${pop}`}>
        {({ close }) => (
          <>
            <Field value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} placeholder="Tag" aria-label="Tag for the selected leads" className="w-full text-sm" autoFocus />
            {tooManyText && <p className="text-xs text-signal">{tooManyText}</p>}
            <div className="flex gap-2">
              <Button variant="solid" size="sm" onClick={() => run(() => api.bulkTag(ids, tag.trim(), 'add'), 'Tagged', close)} disabled={busy || !tag.trim() || tooMany}>
                + Tag
              </Button>
              <Button size="sm" onClick={() => run(() => api.bulkTag(ids, tag.trim(), 'remove'), 'Untagged', close)} disabled={busy || !tag.trim() || tooMany}>
                − Tag
              </Button>
            </div>
          </>
        )}
      </Popover>

      {user?.role === 'supervisor' && otherFiles.length > 0 && (
        <Popover label="File ▾" ariaLabel="Move the selected leads to another file" variant="secondary" size="sm" align="left" panelClassName={`w-80 ${pop}`}>
          {({ close }) => (
            <>
              <Field as="select" value={fileId} onChange={(e) => setFileId(e.target.value)} aria-label="File to move the selected leads to" className="w-full text-sm">
                <option value="">Move to file…</option>
                {otherFiles.map((c) => (
                  <option key={c.id} value={c.id}>{fileLabel(c)}</option>
                ))}
              </Field>
              {tooManyText && <p className="text-xs text-signal">{tooManyText}</p>}
              <Button
                variant="solid"
                size="sm"
                onClick={() => {
                  const target = otherFiles.find((c) => String(c.id) === fileId);
                  if (window.confirm(`Move ${ids.length} lead${ids.length === 1 ? '' : 's'} to ${fileLabel(target)}? They start in its first stage.`)) {
                    run(() => api.bulkMoveCampaign(ids, Number(fileId)), 'Moved', close);
                  }
                }}
                disabled={busy || !fileId || tooMany}
              >
                Move to file
              </Button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}
