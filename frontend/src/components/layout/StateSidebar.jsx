import NeuCard from '../ui/NeuCard';

function RowButton({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-input px-3 py-2 text-sm transition-shadow duration-150 ${
        active ? 'shadow-neu-pressed text-text-primary' : 'text-text-secondary hover:shadow-neu-sm'
      }`}
    >
      <span>{label}</span>
      <span className="text-xs">{count}</span>
    </button>
  );
}

export default function StateSidebar({ counts = [], selectedState, onSelectState }) {
  const totalLeads = counts.reduce((sum, c) => sum + c.total, 0);

  return (
    <NeuCard className="w-full shrink-0 p-4 lg:w-56">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">States</h2>
      <ul className="space-y-1">
        <li>
          <RowButton active={!selectedState} label="All states" count={totalLeads} onClick={() => onSelectState(null)} />
        </li>
        {counts.map((c) => (
          <li key={c.state}>
            <RowButton
              active={selectedState === c.state}
              label={c.state}
              count={`${c.dialable}/${c.total}`}
              onClick={() => onSelectState(c.state)}
            />
          </li>
        ))}
        {counts.length === 0 && <li className="px-3 py-2 text-xs text-text-secondary">No leads yet</li>}
      </ul>
    </NeuCard>
  );
}
