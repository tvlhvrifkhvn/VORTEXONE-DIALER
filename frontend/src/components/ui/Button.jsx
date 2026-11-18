// Button (DESIGN.md section 5). `variant`: 'secondary' (default) | 'primary' | 'ghost'
// | 'solid' (C8A: submits a form inside a panel; never orange).
// `size` (C8A, DESIGN.md section 9): 'md' 40px (default) | 'sm' 32px compact | 'lg' 44px page header.
// `active` is the pressed/toggled look.
const BASE =
  'inline-flex items-center justify-center gap-2 font-mono text-sm font-medium uppercase tracking-button transition-colors duration-150';

const SIZES = {
  sm: 'min-h-8 px-3 py-1',
  md: 'min-h-10 px-4 py-2',
  lg: 'min-h-11 px-4 py-2',
};

const VARIANTS = {
  primary: 'border border-primary-border bg-primary text-primary-foreground hover:bg-foreground hover:text-background',
  secondary: 'border border-strong bg-transparent text-foreground hover:bg-foreground hover:text-background',
  ghost: 'border border-transparent bg-transparent text-foreground hover:bg-muted',
  solid: 'border border-foreground bg-foreground text-background hover:bg-transparent hover:text-foreground',
};

const ACTIVE = 'border border-foreground bg-foreground text-background';

export default function Button({
  children,
  className = '',
  active = false,
  disabled = false,
  variant = 'secondary',
  size = 'md',
  ...props
}) {
  const look = active ? ACTIVE : VARIANTS[variant] || VARIANTS.secondary;
  return (
    <button
      type="button"
      disabled={disabled}
      className={`
        ${BASE} ${SIZES[size] || SIZES.md} ${look}
        ${disabled ? 'cursor-not-allowed opacity-40 pointer-events-none' : 'cursor-pointer'}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}
