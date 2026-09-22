import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import NeuCard from '../ui/NeuCard';
import * as api from '../../lib/api';

/** "Sep 18" — short enough to sit inside a chip. */
function shortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
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
export default function ColleagueCard({ leadId }) {
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
  const stats = [
    plural(summary.totalColleagues, 'colleague'),
    `${summary.contacted} contacted`,
    `${summary.interested} interested`,
    plural(summary.clients, 'client'),
  ].join(' · ');

  return (
    <NeuCard className="space-y-2 p-4">
      <div className="flex items-center gap-2">
        <Building2 size={14} className="shrink-0 text-text-secondary" />
        <p className="truncate text-sm font-semibold text-text-primary">{summary.officeLabel}</p>
      </div>

      <p className="text-xs text-text-secondary">{stats}</p>

      {summary.recentPositive?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {summary.recentPositive.map((c) => (
            <a
              key={`${c.name}-${c.date}`}
              href={`/leads/${c.leadId}`}
              target="_blank"
              rel="noreferrer"
              title={`Open ${c.name} in a new tab`}
              className="rounded-full px-2 py-0.5 text-[11px] text-text-primary shadow-neu-sm hover:shadow-neu"
            >
              {c.name} — {c.outcome}
              {c.date ? `, ${shortDate(c.date)}` : ''}
            </a>
          ))}
        </div>
      )}

      {opener && (
        <p className="rounded-input bg-base p-2 text-xs italic text-text-primary">“{opener}”</p>
      )}
    </NeuCard>
  );
}
