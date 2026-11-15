// Panel (DESIGN.md section 5): bg-card with a 1px hairline; `inset` is bg-muted.
export default function Panel({ children, className = '', inset = false, ...props }) {
  return (
    <div className={`border ${inset ? 'bg-muted' : 'bg-card'} ${className}`} {...props}>
      {children}
    </div>
  );
}
