import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import Panel from '../ui/Panel';
import Badge from '../ui/Badge';

function AiLine({ text }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <p
      className={`mt-2 flex items-start gap-2 text-sm text-foreground transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0'}`}
      data-testid="brief-ai"
    >
      <Badge className="shrink-0">AI</Badge>
      <span>{text}</span>
    </p>
  );
}

/**
 * Pre-call brief. Full while dialing/ringing; once the call connects it
 * collapses to its one-line headline (tap to expand) so it stops taking space.
 * `brief` is { instant, ai } from GET /api/leads/:id/brief.
 */
export default function BriefCard({ brief, collapsed = false, className = '' }) {
  const [open, setOpen] = useState(!collapsed);
  useEffect(() => setOpen(!collapsed), [collapsed]);

  const { instant, ai } = brief || {};
  if (!instant) {
    return (
      <Panel className={`p-4 ${className}`}>
        <div className="h-3 w-2/3 bg-muted" />
      </Panel>
    );
  }

  const d = instant.details;

  return (
    <Panel className={`p-4 ${className}`} data-testid="brief-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="label mr-2">Brief</span>
          <span className={`text-sm font-medium text-foreground ${open ? '' : 'line-clamp-1'}`} data-testid="brief-headline">
            {instant.headline}
          </span>
        </span>
        {open ? (
          <ChevronUp size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Fades in whenever it lands; never blocks the instant line. */}
      {ai && open && <AiLine text={ai.text} />}

      {open && (
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>
            {[d.name, d.brokerage, [d.city, d.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
          </p>
          {instant.opener && (
            <p className="text-foreground">
              <span className="font-semibold">Opener: </span>
              {instant.opener}
            </p>
          )}
          {d.recent.length > 0 && (
            <ul className="space-y-0.5">
              {d.recent.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {d.objections.map((o) => (
            <p key={o.label}>
              <span className="font-semibold text-foreground">{o.label}</span>
              {o.rebuttal ? ` — try: ${o.rebuttal}` : ''}
            </p>
          ))}
          {d.tags.length > 0 && <p>Tags: {d.tags.join(', ')}</p>}
          {/* C6C: the best local hour, same line style. */}
          {d.bestTime && <p data-testid="brief-best-time">Best time: {d.bestTime}</p>}
        </div>
      )}
    </Panel>
  );
}
