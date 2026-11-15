// Call, Hangup and the six disposition buttons (DESIGN.md section 5).
// One accent: call and hangup are primary; contacted is solid; the rest are
// secondary. Speed comes from fixed positions, labels and hotkeys.
const VARIANT_STYLES = {
  call: 'border border-primary-border bg-primary text-primary-foreground hover:bg-foreground hover:text-background',
  hangup: 'border border-primary-border bg-primary text-primary-foreground hover:bg-foreground hover:text-background',
  contacted: 'border border-foreground bg-foreground text-background hover:bg-transparent hover:text-foreground',
  neutral: 'border border-strong bg-transparent text-foreground hover:bg-foreground hover:text-background',
  warn: 'border border-strong bg-transparent text-foreground hover:bg-foreground hover:text-background',
  dnc: 'border border-strong bg-transparent text-foreground hover:bg-foreground hover:text-background',
};

export default function ActionButton({ variant = 'neutral', children, className = '', disabled = false, ...props }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`
        ${VARIANT_STYLES[variant] || VARIANT_STYLES.neutral}
        min-h-11 px-4 py-3 font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150
        disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
