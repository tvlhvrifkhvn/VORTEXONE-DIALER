import Panel from '../ui/Panel';

// Stat (DESIGN.md section 5). `size`: '2xl' (default) | 'display'.
export default function StatCard({ label, value, hint, size = '2xl' }) {
  return (
    <Panel className="min-w-[140px] flex-1 p-4">
      <div className="label">{label}</div>
      <div className={`mt-2 font-mono font-medium tabular-nums text-foreground ${size === 'display' ? 'text-display' : 'text-2xl'}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Panel>
  );
}
