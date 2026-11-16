// Settings → Files, section 04 (C2B): one file's pipeline stages. Rename,
// add (lands before the won/lost stages), delete an empty open stage, and
// move up/down with buttons (keyboard-friendly, no drag). The server keeps
// the rules: one won, one lost, an open first stage.
import { useCallback, useEffect, useState } from 'react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Badge from '../ui/Badge';
import SectionLabel from '../ui/SectionLabel';
import { stageTone } from '../../hooks/useStages';
import { fileLabel } from '../../hooks/useCampaign';
import * as api from '../../lib/api';

function StageRow({ stage, index, count, disabled, onRename, onMove, onDelete }) {
  const [name, setName] = useState(stage.name);
  useEffect(() => setName(stage.name), [stage.name]);
  const closed = stage.kind !== 'open';
  return (
    <li className="flex min-h-12 flex-wrap items-center gap-2 border-b py-2">
      <span className="w-8 font-mono text-sm tabular-nums text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
      <Field
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label={`Stage ${index + 1} name`}
        maxLength={40}
        className="min-w-[12rem] flex-1"
        disabled={disabled}
      />
      {closed && <Badge tone={stageTone(stage.kind)}>{stage.kind}</Badge>}
      {stage.auto_on && <Badge tone="dashed">Auto · contacted</Badge>}
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{stage.lead_count ?? 0} lead{(stage.lead_count ?? 0) === 1 ? '' : 's'}</span>
      <Button variant="ghost" onClick={() => onRename(stage, name)} disabled={disabled || !name.trim() || name.trim() === stage.name}>
        Save
      </Button>
      <Button variant="ghost" onClick={() => onMove(index, -1)} disabled={disabled || index === 0} aria-label={`Move ${stage.name} up`}>
        ↑
      </Button>
      <Button variant="ghost" onClick={() => onMove(index, 1)} disabled={disabled || index === count - 1} aria-label={`Move ${stage.name} down`}>
        ↓
      </Button>
      <Button onClick={() => onDelete(stage)} disabled={disabled || closed || (stage.lead_count ?? 0) > 0} aria-label={`Delete ${stage.name}`}>
        ⊘ Delete
      </Button>
    </li>
  );
}

export default function StageEditor({ campaign, disabled }) {
  const [stages, setStages] = useState([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const { stages: list } = await api.getPipelineStages(campaign.id);
      setStages(list || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  }, [campaign.id]);

  useEffect(() => {
    setMessage(null);
    load();
  }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await load();
      if (ok) setMessage({ type: 'ok', text: ok });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const rename = (stage, name) => run(() => api.renamePipelineStage(stage.id, name.trim()), 'Stage renamed.');
  const move = (index, dir) => {
    const ids = stages.map((s) => s.id);
    const j = index + dir;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    return run(() => api.reorderPipelineStages(ids, campaign.id));
  };
  const remove = (stage) => {
    if (!window.confirm(`Delete the stage "${stage.name}"?`)) return;
    run(() => api.deletePipelineStage(stage.id), `"${stage.name}" deleted.`);
  };
  const add = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      await api.createPipelineStage(name, campaign.id);
      setNewName('');
    }, `"${name}" added.`);
  };

  return (
    <Panel className="space-y-4 p-6">
      <SectionLabel index="04" title="Pipeline stages" meta={fileLabel(campaign)} />
      <p className="text-sm text-muted-foreground">
        New leads start in the first stage. A file keeps one won and one lost stage; only an empty open stage can be deleted.
      </p>
      <ul className="border-t">
        {stages.map((s, i) => (
          <StageRow
            key={s.id}
            stage={s}
            index={i}
            count={stages.length}
            disabled={disabled || busy}
            onRename={rename}
            onMove={move}
            onDelete={remove}
          />
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <label htmlFor="new-stage-name" className="label mb-2 block">New stage</label>
          <Field
            id="new-stage-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Demo booked"
            className="w-full"
            disabled={disabled}
          />
        </div>
        <Button type="submit" variant="primary" disabled={disabled || busy || !newName.trim()}>
          Add stage
        </Button>
      </form>
      {message && (
        <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
          {message.text}
        </p>
      )}
    </Panel>
  );
}
