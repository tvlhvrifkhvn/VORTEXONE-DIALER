import StatCard from './StatCard';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** Dashboard: of the leads due for a call, how many can be dialed right
 * now and how many are waiting for their local calling hours (8am–9pm) to
 * open — from the per-state counts (GET /api/leads/state-counts). */
export default function QueueHoursCards({ counts }) {
  if (!counts.some((c) => 'dialable_now' in c)) return null;
  const sum = (key) => counts.reduce((total, c) => total + Number(c[key] || 0), 0);
  const nextOpens = counts.map((c) => c.next_opens_at).filter(Boolean).sort()[0];
  const unknown = sum('unknown_zone');
  const waitingHint = [
    nextOpens ? `Next opens at ${timeFormat.format(new Date(nextOpens))}` : null,
    unknown ? `${unknown} with unknown time zone (set the state)` : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <StatCard label="Dialable now" value={sum('dialable_now')} hint="Inside 8am–9pm their time" />
      <StatCard label="Waiting for their hours" value={sum('waiting_for_hours') + unknown} hint={waitingHint || undefined} />
    </>
  );
}
