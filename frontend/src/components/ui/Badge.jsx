// Tag (DESIGN.md section 5). `tone`: outline (default) | solid | dashed | muted | signal.
const TONES = {
  outline: 'border border-strong text-foreground',
  solid: 'border border-foreground bg-foreground text-background',
  dashed: 'border border-dashed border-strong text-foreground',
  muted: 'border border-muted bg-muted text-muted-foreground',
  signal: 'border border-primary bg-primary text-primary-foreground',
};

export default function Badge({ children, tone = 'outline', color, className = '' }) {
  if (color !== undefined) {
    // Legacy prop from the neumorphic Badge: ignored. R6 converts the last caller.
    console.debug('[Badge] `color` is ignored; use `tone`.', color);
  }
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap px-2 py-0.5 font-mono text-xs font-medium uppercase ${TONES[tone] || TONES.outline} ${className}`}
    >
      {children}
    </span>
  );
}
