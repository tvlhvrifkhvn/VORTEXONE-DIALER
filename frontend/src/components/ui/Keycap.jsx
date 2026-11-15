// Keycap (DESIGN.md section 5). Real hotkeys only: M, Esc, V, N, D.
export default function Keycap({ children, className = '' }) {
  return (
    <kbd
      className={`inline-flex min-w-5 items-center justify-center border border-strong bg-muted px-1 font-mono text-xs font-medium uppercase leading-4 text-foreground ${className}`}
    >
      {children}
    </kbd>
  );
}
