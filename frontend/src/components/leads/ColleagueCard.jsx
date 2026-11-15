import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import NeuCard from '../ui/NeuCard';
import SectionLabel from '../ui/SectionLabel';
import * as api from '../../lib/api';

/** "Sep 18" — short enough to sit inside a chip. */
function shortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The brand half of "Keller Williams · Boise, ID" — reads better spoken
 * aloud in the opener than the full label with the city tacked on. */
function brandOf(officeLabel) {
  return (officeLabel || '').split(' · ')[0] || 'their office';
}

function openerFor(summary) {
  if (summary.clients > 0) return `I'm already supporting agents at ${brandOf(summary.officeLabel)}`;
  if (summary.interested > 0) return `I've been speaking with a few agents at ${brandOf(summary.officeLabel)}`;
  return null;
}

/**
 * Social proof for a cold open: what has already happened with other agents
 * at this lead's office. Renders nothing at all when there are no
 * colleagues — an empty card is just noise on the call screen.
 */
// `index` numbers the section label ("03" on the call screen). The label
// lives here because the card renders nothing when there are no colleagues.
export default function ColleagueCard({ leadId, index }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getLeadColleagues(leadId)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (!summary || !summary.totalColleagues) return null;

  const opener = openerFor(summary);
  // Spec table: mono keys, tabular values.
  const stats = [
    ['Colleagues', summary.totalColleagues],
    ['Contacted', summary.contacted],
    ['Interested', summary.interested],
    ['Clients', summary.clients],
  ];

  return (
    <section>
      <SectionLabel index={index} title="Office" className="mb-4" />
      <NeuCard className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Building2 size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          <p className="truncate text-base font-semibold text-foreground">{summary.officeLabel}</p>
        </div>

        <dl className="grid grid-cols-2 border-t sm:grid-cols-4">
          {stats.map(([key, value]) => (
            <div key={key} className="border-b py-2 pr-4">
              <dt className="label">{key}</dt>
              <dd className="mt-1 font-mono text-lg font-medium tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>

        {summary.recentPositive?.length > 0 && (
          <ul>
            {summary.recentPositive.map((c) => (
              <li key={`${c.name}-${c.date}`} className="border-b last:border-b-0">
                <a
                  href={`/leads/${c.leadId}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${c.name} in a new tab`}
                  className="flex items-center justify-between gap-4 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-muted"
                >
                  <span className="truncate">
                    {c.name} ↗ <span className="text-muted-foreground">— {c.outcome}</span>
                  </span>
                  {c.date && <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{shortDate(c.date)}</span>}
                </a>
              </li>
            ))}
          </ul>
        )}

        {opener && <p className="border-l-[3px] border-strong bg-muted p-2 text-sm italic text-foreground">“{opener}”</p>}
      </NeuCard>
    </section>
  );
}
