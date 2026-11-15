import NeuCard from '../ui/NeuCard';
import SectionLabel from '../ui/SectionLabel';

// Two series, told apart by shade, order and the legend, never by hue
// (docs/DESIGN.md: monochrome bars on a muted track). Dials is the
// foreground bar on top; contacts the muted-foreground bar under it. Both
// clear 3:1 against the track in both themes (npm run contrast).
const SERIES = {
  dials: 'bg-foreground',
  contacts: 'bg-muted-foreground',
};

export default function StateReport({ states = [] }) {
  const maxDials = Math.max(1, ...states.map((s) => s.dials));

  return (
    <section>
      <SectionLabel
        index="01"
        title="Per-state performance"
        className="mb-2"
        meta={
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-2 w-4 ${SERIES.dials}`} />
              Dials
            </span>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-2 w-4 ${SERIES.contacts}`} />
              Contacts
            </span>
          </span>
        }
      />
      <NeuCard className="p-4">
        {states.length === 0 && <p className="text-sm text-muted-foreground">No calls recorded yet.</p>}

        <div className="divide-y">
          {states.map((s) => (
            <div key={s.state} className="grid grid-cols-[3rem_1fr_11rem] items-center gap-4 py-2 text-sm">
              <span className="font-mono font-medium text-foreground">{s.state}</span>
              <div className="space-y-1">
                <div className="h-2 bg-muted">
                  <div className={`h-2 ${SERIES.dials}`} style={{ width: `${(s.dials / maxDials) * 100}%` }} />
                </div>
                <div className="h-2 bg-muted">
                  <div className={`h-2 ${SERIES.contacts}`} style={{ width: `${(s.contacts / maxDials) * 100}%` }} />
                </div>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="font-medium text-foreground">{s.connectRate}%</div>
                <div className="whitespace-nowrap text-xs text-muted-foreground">
                  {s.dials} dials / {s.contacts} contacts
                </div>
              </div>
            </div>
          ))}
        </div>
      </NeuCard>
    </section>
  );
}
