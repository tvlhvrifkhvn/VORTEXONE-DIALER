// C8B: the DIALABLE NOW and WAITING tiles are gone from the Leads page; their
// numbers are the line in the DIAL menu ("592 dialable now · 0 waiting for
// their hours"). Of the leads due for a call, how many can be dialed right
// now and how many wait for their local calling hours (8am–9pm) to open —
// from the per-state counts (GET /api/leads/state-counts).
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** { dialable, waiting, hint } or null before the counts carry these fields. */
export function queueHours(counts) {
  if (!counts.some((c) => 'dialable_now' in c)) return null;
  const sum = (key) => counts.reduce((total, c) => total + Number(c[key] || 0), 0);
  const nextOpens = counts.map((c) => c.next_opens_at).filter(Boolean).sort()[0];
  const unknown = sum('unknown_zone');
  const hint = [
    nextOpens ? `Next opens at ${timeFormat.format(new Date(nextOpens))}` : null,
    unknown ? `${unknown} with unknown time zone (set the state)` : null,
  ].filter(Boolean).join(' · ');
  return { dialable: sum('dialable_now'), waiting: sum('waiting_for_hours') + unknown, hint };
}
