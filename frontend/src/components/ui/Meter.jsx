import Badge from './Badge';

// Meter (DESIGN.md section 5): an 8px bar with its value printed in mono.
// `tone`: 'goal' (foreground fill on a muted track) | 'budget' (signal fill on
// the meter track, with 80% / 100% warnings). A goal fill can't use the meter
// track: in paper both are ink.
// `format` turns a number into display text (default: the number itself).
export default function Meter({ value, max, tone = 'goal', label, format = (n) => n, className = '' }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  const budget = tone === 'budget';
  const warning = budget && pct >= 100 ? 'BUDGET REACHED — DIALING STOPPED' : budget && pct >= 80 ? '80% OF BUDGET USED' : null;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4">
        {label && <span className="label">{label}</span>}
        <span className="font-mono text-sm tabular-nums text-foreground">
          {format(value)} / {format(max)} · {pct}%
        </span>
      </div>
      <div
        className={`mt-2 h-2 w-full ${budget ? 'bg-meter-track' : 'bg-muted'}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className={`h-2 ${budget ? 'bg-primary' : 'bg-foreground'}`} style={{ width: `${pct}%` }} />
      </div>
      {warning && (
        <Badge tone="signal" className="mt-2">
          {warning}
        </Badge>
      )}
    </div>
  );
}
