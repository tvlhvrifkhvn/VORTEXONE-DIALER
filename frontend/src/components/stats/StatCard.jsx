import NeuCard from '../ui/NeuCard';

export default function StatCard({ label, value, hint }) {
  return (
    <NeuCard className="min-w-[140px] flex-1 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-text-primary">{value}</div>
      {hint && <div className="mt-1 text-xs text-text-secondary">{hint}</div>}
    </NeuCard>
  );
}
