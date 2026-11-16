// The campaign switcher (C1E): the header's FileTag as a menu button. Lists
// the files that are not archived, marks the active one, and ends with
// "MANAGE FILES →". Disabled during a call or a dial session, with the
// reason printed in the menu. No key handlers beyond the browser's own
// (Esc already ends calls, DESIGN.md section 5).
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FileTag from '../ui/FileTag';
import Badge from '../ui/Badge';
import { useCampaign } from '../../hooks/useCampaign';

export default function CampaignSwitcher() {
  const navigate = useNavigate();
  const { usable, active, activeId, switchTo, switchBlockedReason } = useCampaign();
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Active file: ${active ? `File ${active.file_number}, ${active.name}` : 'loading'}. Switch file`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 items-center gap-2 px-2 transition-colors duration-150 hover:bg-muted"
      >
        <FileTag number={active?.file_number ?? 1} name={active?.name ?? ''} />
        {active?.status === 'paused' && <Badge tone="muted">Paused</Badge>}
        <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-72 border border-strong bg-card">
          <p className="label border-b px-3 py-2">Files</p>
          {switchBlockedReason && (
            <p className="border-b px-3 py-2 text-sm text-signal">{switchBlockedReason}</p>
          )}
          <ul>
            {usable.map((c) => {
              const isActive = String(c.id) === String(activeId);
              return (
                <li key={c.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    disabled={!!switchBlockedReason && !isActive}
                    aria-current={isActive ? 'true' : undefined}
                    onClick={() => {
                      setOpen(false);
                      switchTo(c.id);
                    }}
                    className={`flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent ${
                      isActive ? 'bg-muted' : ''
                    }`}
                  >
                    <FileTag number={c.file_number} name={c.name} />
                    <span className="flex items-center gap-2">
                      {c.status === 'paused' && <Badge tone="muted">Paused</Badge>}
                      {isActive && (
                        <span className="font-mono text-xs text-foreground">
                          ✓<span className="sr-only"> active</span>
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate('/settings/campaigns');
            }}
            className="flex min-h-10 w-full items-center border-t px-3 font-mono text-sm font-medium uppercase tracking-button text-foreground transition-colors duration-150 hover:bg-muted"
          >
            Manage files →
          </button>
        </div>
      )}
    </div>
  );
}
