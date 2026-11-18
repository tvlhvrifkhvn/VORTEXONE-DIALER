// The header's spend chip (C4B meter, C8A chip): "$3.40 TODAY", in signal
// colors at 80 % or more of whichever budget (the file's or the global one)
// is closer to its limit; hidden until the owner enters rates. A click opens
// a panel with the per-file split. No key handlers beyond the browser's own.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
      <Link to="/settings/spend-limits" className="inline-flex min-h-10 items-center font-mono text-sm uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted">
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

  // C8A: a chip in the one-row header, only once call rates are set (Settings →
  // Spend limits says when they aren't). Signal colors at 80 % or more of the
  // closer budget; the click still opens the split by file.
  if (!spend || !spend.ratesSet) return null;
  const budget = shownBudget(spend);
  const pct = budget && budget.budget > 0 ? Math.round((budget.spent / budget.budget) * 100) : 0;
  const warn = pct >= 80;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={budget ? `${formatCents(budget.spent)} of ${formatCents(budget.budget)} (${budget.scope}) · ${pct}%` : `${formatCents(spend.month.cents)} this month · no budget`}
        className={`inline-flex min-h-10 items-center gap-2 whitespace-nowrap border px-3 font-mono text-sm font-medium uppercase tabular-nums tracking-button transition-colors duration-150 ${
          warn ? 'border-primary bg-primary text-primary-foreground hover:bg-foreground hover:text-background' : 'border-transparent text-foreground hover:bg-muted'
        }`}
        aria-label={`Spend: ${formatCents(spend.today.cents)} today, ${formatCents(spend.month.cents)} this month${warn ? `, ${pct}% of budget used` : ''}. Show the split by file`}
      >
        {formatCents(spend.today.cents)} <span className={`hidden 2xl:inline ${warn ? '' : 'text-muted-foreground'}`}>Today</span>
      </button>
      {open && <SplitPanel spend={spend} />}
    </div>
  );
}
