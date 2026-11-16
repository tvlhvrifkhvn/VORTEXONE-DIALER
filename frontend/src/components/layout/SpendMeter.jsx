// The header's spend meter (C4B, DESIGN.md section 5 Meter, budget tone):
// today's spend, then "month / budget · %" on an 8px bar for whichever budget
// (the file's or the global one) is closer to its limit, with the 80 % and
// 100 % texts. "RATES NOT SET" until the owner enters rates. A click opens
// a panel with the per-file split. No key handlers beyond the browser's own.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../ui/Badge';
import Meter from '../ui/Meter';
import { useSpend, shownBudget } from '../../hooks/useSpend';
import { formatCents } from '../../lib/format';

function SplitPanel({ spend }) {
  const global = spend.budgets?.global;
  return (
    <div className="absolute right-0 z-40 mt-1 w-[28rem] max-w-[90vw] space-y-2 border border-strong bg-card p-4">
      <p className="label">Spend by file · {spend.month.label}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="label py-2 font-medium">File</th>
            <th className="label py-2 text-right font-medium">Today</th>
            <th className="label py-2 text-right font-medium">Month</th>
            <th className="label py-2 text-right font-medium">Budget</th>
          </tr>
        </thead>
        <tbody>
          {spend.perCampaign.map((c) => (
            <tr key={c.campaignId} className="border-b">
              <td className="py-2 font-mono text-xs uppercase">
                FILE {String(c.fileNumber).padStart(2, '0')} · {c.name}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">{formatCents(c.today)}</td>
              <td className="py-2 text-right font-mono tabular-nums">{formatCents(c.month)}</td>
              <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">{c.budget === null ? '—' : formatCents(c.budget)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 font-mono text-xs uppercase text-foreground">All files</td>
            <td className="py-2" />
            <td className="py-2 text-right font-mono tabular-nums">{formatCents(global?.spent ?? 0)}</td>
            <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
              {global?.budget === null || global?.budget === undefined ? '—' : formatCents(global.budget)}
            </td>
          </tr>
        </tbody>
      </table>
      <Link to="/settings#spend-limits" className="inline-flex min-h-10 items-center font-mono text-sm uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted">
        Rates and budgets →
      </Link>
    </div>
  );
}

export default function SpendMeter() {
  const spend = useSpend();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!spend) return null;
  const budget = shownBudget(spend);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="block w-56 px-2 py-1 text-left transition-colors duration-150 hover:bg-muted"
        aria-label={`Spend: ${spend.ratesSet ? `${formatCents(spend.today.cents)} today, ${formatCents(spend.month.cents)} this month` : 'rates not set'}. Show the split by file`}
      >
        {!spend.ratesSet ? (
          <span className="flex items-center justify-between gap-2">
            <span className="label">Spend</span>
            <Badge tone="muted">Rates not set</Badge>
          </span>
        ) : (
          <>
            <span className="flex items-baseline justify-between gap-2">
              <span className="label">Today</span>
              <span className="font-mono text-xs tabular-nums text-foreground">{formatCents(spend.today.cents)}</span>
            </span>
            {budget ? (
              <Meter tone="budget" value={budget.spent} max={budget.budget} format={(c) => formatCents(c)} className="mt-1" />
            ) : (
              <span className="flex items-baseline justify-between gap-2">
                <span className="label">Month</span>
                <span className="font-mono text-xs tabular-nums text-foreground">{formatCents(spend.month.cents)} · no budget</span>
              </span>
            )}
          </>
        )}
      </button>
      {open && <SplitPanel spend={spend} />}
    </div>
  );
}
