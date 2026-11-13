import { useEffect, useState } from 'react';

// Calling hours: 8am inclusive to 9pm exclusive, in every zone the lead
// could be in (backend services/callingHours.js; the zones come from
// leads.tz_zones). This is display only — the server decides what dials.
const START = 8;
const END = 21;

function localParts(zone, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).formatToParts(now);
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now)) % 24;
  const text = parts.map((p) => p.value).join('');
  return { hour, text };
}

/** The lead's local time now ("7:30 AM CST", or two times for a lead that
 * may be in either of two zones), and whether it's inside calling hours. */
export function leadLocalTime(lead, now = new Date()) {
  const zones = Array.isArray(lead?.tz_zones) ? lead.tz_zones : null;
  if (!zones) return null;
  if (zones.length === 0) return { text: 'Time zone unknown', open: false, unknown: true };
  const each = zones.map((z) => localParts(z, now));
  const text = [...new Set(each.map((e) => e.text))].join(' / ');
  return { text, open: each.every((e) => e.hour >= START && e.hour < END), unknown: false };
}

function useMinuteTick() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function LeadLocalTime({ lead, className = '' }) {
  const now = useMinuteTick();
  const local = leadLocalTime(lead, now);
  if (!local) return null;
  const title = local.unknown
    ? 'Time zone unknown — set the state first. Not dialed while calling hours are enforced.'
    : local.open
      ? "Lead's local time — inside calling hours (8am–9pm)"
      : "Lead's local time — outside calling hours (8am–9pm)";
  return (
    <span title={title} className={`whitespace-nowrap text-xs tabular-nums ${local.open ? 'text-text-secondary' : 'font-medium text-action-warn'} ${className}`}>
      {local.text}
      {!local.open && !local.unknown && ' · closed'}
    </span>
  );
}
