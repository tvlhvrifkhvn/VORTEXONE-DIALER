// The header's calling-hours chip (C8A): "ET 6:26 AM · CLOSED" (or "· OPEN"),
// and a popover with the four US zones, each with its time and OPEN or
// CLOSED. Same rule as the old header clocks it replaces (8am–9pm local, the
// dialer's calling hours; display only, the server decides what dials).
// No strikethrough: the word says it.
import { useEffect, useState } from 'react';
import { Popover } from '../ui/Menu';

const START = 8;
const END = 21;

const ZONES = [
  { label: 'ET', name: 'Eastern', tz: 'America/New_York' },
  { label: 'CT', name: 'Central', tz: 'America/Chicago' },
  { label: 'MT', name: 'Mountain', tz: 'America/Denver' },
  { label: 'PT', name: 'Pacific', tz: 'America/Los_Angeles' },
];

function zoneNow(now, tz) {
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now)) % 24;
  return { time, open: hour >= START && hour < END };
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function CallingHoursChip() {
  const now = useClock();
  const et = zoneNow(now, ZONES[0].tz);
  const word = et.open ? 'Open' : 'Closed';
  return (
    <Popover
      ariaLabel={`Calling hours: Eastern ${et.time}, ${word.toLowerCase()}. Show every zone`}
      title="Calling hours are 8 AM to 9 PM in the lead's time zone"
      size="chip"
      className="whitespace-nowrap tabular-nums"
      panelClassName="w-64"
      label={
        <>
          <span className="text-muted-foreground">ET</span>
          <span>{et.time}</span>
          <span className={et.open ? 'text-foreground' : 'text-muted-foreground'}>· {word}</span>
        </>
      }
    >
      <p className="label border-b px-3 py-2">Calling hours · 8 AM–9 PM</p>
      <ul>
        {ZONES.map((z) => {
          const { time, open } = zoneNow(now, z.tz);
          return (
            <li key={z.label} className="flex min-h-10 items-center justify-between gap-4 border-b px-3 last:border-b-0">
              <span className="font-mono text-sm uppercase">
                <span className="text-muted-foreground">{z.label}</span> <span className="tabular-nums text-foreground">{time}</span>
              </span>
              <span className={`font-mono text-xs font-medium uppercase ${open ? 'text-foreground' : 'text-muted-foreground'}`}>
                {open ? 'Open' : 'Closed'}
              </span>
            </li>
          );
        })}
      </ul>
    </Popover>
  );
}
