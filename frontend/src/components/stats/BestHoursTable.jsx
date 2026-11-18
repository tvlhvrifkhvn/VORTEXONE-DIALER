// Reports → BEST HOURS (C6C): per state, the connect rate by the lead's
// local hour (8:00 to 21:00) over the last 90 days, and the best hour. A
// state with fewer than 30 calls says "Not enough data yet".
import Panel from '../ui/Panel';
import SectionLabel from '../ui/SectionLabel';

const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i);
const short = (h) => `${h % 12 === 0 ? 12 : h % 12}${h >= 12 ? 'p' : 'a'}`;

export default function BestHoursTable({ data, index = '04' }) {
  const states = data?.states || [];
  return (
    <section data-testid="best-hours">
      <SectionLabel index={index} title="Best hours" meta={data ? `Last ${data.days} days · lead's local time` : undefined} className="mb-2" />
      <Panel className="overflow-x-auto p-4">
        {states.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls in the last 90 days yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="label py-2 pr-2 font-medium">State</th>
                <th className="label py-2 pr-2 text-right font-medium">Calls</th>
                <th className="label py-2 pr-4 font-medium">Best</th>
                {HOURS.map((h) => (
                  <th key={h} className="label py-2 text-right font-medium">
                    {short(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {states.map((s) => (
                <tr key={s.state} className="border-b last:border-b-0">
                  <td className="py-2 pr-2 font-mono text-xs text-foreground">{s.state}</td>
                  <td className="py-2 pr-2 text-right font-mono tabular-nums text-foreground">{s.calls}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-foreground">
                    {s.best ? (
                      <span className="font-mono text-xs tabular-nums">
                        {short(s.best.hour)}–{short(s.best.hour + 1)} · {s.best.rate}%
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not enough data yet</span>
                    )}
                  </td>
                  {s.hours.map((x) => (
                    <td
                      key={x.hour}
                      className={`py-2 pl-1 text-right font-mono text-xs tabular-nums ${s.best && x.hour === s.best.hour ? 'font-medium text-foreground underline underline-offset-4' : 'text-muted-foreground'}`}
                      title={`${x.calls} call${x.calls === 1 ? '' : 's'}, ${x.contacts} contact${x.contacts === 1 ? '' : 's'}`}
                    >
                      {x.rate === null ? '·' : `${x.rate}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Connect rate (%) by hour; the best hour needs 30 calls in the state and 3 in that hour.</p>
      </Panel>
    </section>
  );
}
