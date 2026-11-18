// Section header (DESIGN.md section 4): hairline on top, then one mono row:
// "01 — ACTIVE CALL" on the left, optional meta ("LINE 02") on the right.
export default function SectionLabel({ index, title, meta, className = '' }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 border-t pt-2 ${className}`}>
      <h2 className="label">
        {index && <span className="tabular-nums">{index} — </span>}
        {title}
      </h2>
      {meta && <span className="label tabular-nums">{meta}</span>}
    </div>
  );
}
