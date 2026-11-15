// An 8px dot that is always followed by its text label (DESIGN.md section 5).
// `tone`: 'live' (connected) | 'signal' (ringing, active) | 'muted'.
// The text inherits its color, so it reads on solid surfaces too.
const TONES = {
  live: 'bg-live',
  signal: 'bg-primary',
  muted: 'bg-muted-foreground',
};

export default function StatusDot({ tone = 'muted', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-xs font-medium uppercase ${className}`}>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${TONES[tone] || TONES.muted}`} />
      {children}
    </span>
  );
}
