// Button (DESIGN.md section 5). `variant`: 'secondary' (default) | 'primary' | 'ghost'.
// `active` is the pressed/toggled look.
const BASE =
  'inline-flex min-h-10 items-center justify-center gap-2 px-4 py-2 font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150';

const VARIANTS = {
  primary: 'border border-primary-border bg-primary text-primary-foreground hover:bg-foreground hover:text-background',
  secondary: 'border border-strong bg-transparent text-foreground hover:bg-foreground hover:text-background',
  ghost: 'border border-transparent bg-transparent text-foreground hover:bg-muted',
};

const ACTIVE = 'border border-foreground bg-foreground text-background';

export default function Button({
  children,
  className = '',
  active = false,
  disabled = false,
  variant = 'secondary',
  ...props
}) {
  const look = active ? ACTIVE : VARIANTS[variant] || VARIANTS.secondary;
  return (
    <button
      type="button"
      disabled={disabled}
      className={`
        ${BASE} ${look}
        ${disabled ? 'cursor-not-allowed opacity-40 pointer-events-none' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
