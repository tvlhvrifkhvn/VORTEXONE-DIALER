import NeuCard from '../ui/NeuCard';

// Fixed categorical order, validated against the app's neumorphic surface
// with scripts/validate_palette.js from the dataviz skill (slot 1 blue,
// slot 2 orange) — never reassign or cycle these per series.
const SERIES = {
  dials: '#2A78D6',
  contacts: '#EB6834',
};

export default function StateReport({ states = [] }) {
  const maxDials = Math.max(1, ...states.map((s) => s.dials));

  return (
    <NeuCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Per-state performance</h2>
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERIES.dials }} />
            Dials
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERIES.contacts }} />
            Contacts
          </span>
        </div>
      </div>

      {states.length === 0 && <p className="text-sm text-text-secondary">No calls recorded yet.</p>}

      <div className="space-y-4">
        {states.map((s) => (
          <div key={s.state} className="grid grid-cols-[2.5rem_1fr_4.5rem] items-center gap-3 text-sm">
            <span className="font-medium text-text-primary">{s.state}</span>
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-shadow/20">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${(s.dials / maxDials) * 100}%`, backgroundColor: SERIES.dials }}
                />
              </div>
              <div className="h-2 rounded-full bg-shadow/20">
                <div
                  className="h-2 rounded-full"
                  style={{ width: `${(s.contacts / maxDials) * 100}%`, backgroundColor: SERIES.contacts }}
                />
              </div>
            </div>
            <div className="text-right">
              <div className="font-medium text-text-primary">{s.connectRate}%</div>
              <div className="text-[10px] text-text-secondary">
                {s.dials}d / {s.contacts}c
              </div>
            </div>
          </div>
        ))}
      </div>
    </NeuCard>
  );
}
