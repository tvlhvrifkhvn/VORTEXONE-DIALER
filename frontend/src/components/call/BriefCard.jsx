import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import NeuCard from '../ui/NeuCard';

function AiLine({ text }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <p
      className={`mt-1.5 flex gap-1.5 text-xs text-text-primary transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}
      data-testid="brief-ai"
    >
      <Sparkles size={12} className="mt-0.5 shrink-0 text-action-call" />
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
      <NeuCard className={`p-3 ${className}`}>
        <div className="h-3 w-2/3 animate-pulse rounded bg-shadow/30" />
      </NeuCard>
    );
  }

  const d = instant.details;

  return (
    <NeuCard className={`p-3 ${className}`} data-testid="brief-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Brief</span>
          <span className={`text-xs font-medium text-text-primary ${open ? '' : 'line-clamp-1'}`} data-testid="brief-headline">
            {instant.headline}
          </span>
        </span>
        {open ? <ChevronUp size={14} className="shrink-0 text-text-secondary" /> : <ChevronDown size={14} className="shrink-0 text-text-secondary" />}
      </button>

      {/* Fades in whenever it lands; never blocks the instant line. */}
      {ai && open && <AiLine text={ai.text} />}

      {open && (
        <div className="mt-2 space-y-1.5 text-[11px] text-text-secondary">
          <p>
            {[d.name, d.brokerage, [d.city, d.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
          </p>
          {instant.opener && (
            <p className="text-text-primary">
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
              <span className="font-semibold text-text-primary">{o.label}</span>
              {o.rebuttal ? ` — try: ${o.rebuttal}` : ''}
            </p>
          ))}
          {d.tags.length > 0 && <p>Tags: {d.tags.join(', ')}</p>}
        </div>
      )}
    </NeuCard>
  );
}
