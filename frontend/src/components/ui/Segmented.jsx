// Segmented control (DESIGN.md section 5): buttons inside a border-strong frame;
// the active one is solid, with aria-pressed.
export default function Segmented({ label, options, value, onChange, className = '' }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex border border-strong ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(opt.value)}
            className={`min-h-10 px-3 font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150 ${
              active ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
