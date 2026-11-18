// "MOVE →" (C2B): the keyboard path for moving a lead between stages, next
// to drag and drop on the board. A menu button listing the other stages;
// Tab reaches every item, Enter/Space picks one. No Esc or arrow handlers
// (Esc ends calls, DESIGN.md section 5); an outside click closes it.
// C8D: a 32px text button on the board's cards.
import { useEffect, useRef, useState } from 'react';
import Badge from '../ui/Badge';
import { stageTone } from '../../hooks/useStages';

export default function StageMoveMenu({ lead, stages, onMove, disabled = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const targets = stages.filter((s) => s.id !== lead.pipeline_stage_id);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Move ${lead.name} to another stage`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="min-h-8 px-2 font-mono text-xs font-medium uppercase tracking-button text-foreground transition-colors duration-150 hover:bg-muted disabled:opacity-40"
      >
        Move →
      </button>
      {open && (
        <ul className="absolute right-0 z-40 mt-1 w-56 border border-strong bg-card">
          {targets.map((s) => (
            <li key={s.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onMove(lead, s);
                }}
                className="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors duration-150 hover:bg-muted"
              >
                <span className="truncate">{s.name}</span>
                {s.kind !== 'open' && <Badge tone={stageTone(s.kind)}>{s.kind}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
