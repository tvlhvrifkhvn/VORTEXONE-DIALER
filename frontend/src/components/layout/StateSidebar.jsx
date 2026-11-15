import NeuCard from '../ui/NeuCard';

function RowButton({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-10 w-full items-center justify-between border-l-[3px] px-3 font-mono text-sm transition-colors duration-150 ${
        active
          ? 'border-l-primary bg-muted text-foreground'
          : 'border-l-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      <span className="uppercase">{label}</span>
      <span className="text-right text-xs tabular-nums">{count}</span>
    </button>
  );
}

export default function StateSidebar({ counts = [], selectedState, onSelectState }) {
  const totalLeads = counts.reduce((sum, c) => sum + c.total, 0);

  return (
    <NeuCard className="w-full shrink-0 p-4 lg:w-56">
      <h2 className="label mb-2">States</h2>
      <ul>
        <li>
          <RowButton active={!selectedState} label="All states" count={totalLeads} onClick={() => onSelectState(null)} />
        </li>
        {counts.map((c) => (
          <li key={c.state}>
            <RowButton
              active={selectedState === c.state}
              label={c.state}
              count={`${c.total} / ${c.uncontacted}`}
              onClick={() => onSelectState(c.state)}
            />
          </li>
        ))}
        {counts.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No leads yet</li>}
      </ul>
    </NeuCard>
  );
}
