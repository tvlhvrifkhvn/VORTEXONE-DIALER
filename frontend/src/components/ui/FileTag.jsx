// Campaign "file" tag (DESIGN.md section 4): an outlined "FILE 01" plus the name.
export default function FileTag({ number, name, className = '' }) {
  const num = String(number).padStart(2, '0');
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-xs font-medium uppercase ${className}`}>
      <span className="border border-strong px-2 py-0.5 tabular-nums text-foreground">FILE {num}</span>
      {name && <span className="text-muted-foreground">{name}</span>}
    </span>
  );
}
