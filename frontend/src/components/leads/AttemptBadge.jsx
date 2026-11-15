import Badge from '../ui/Badge';

// DESIGN.md section 6: outline; the last attempt before cold is solid "· LAST";
// at the limit it is muted "· MAX".
export default function AttemptBadge({ attempts, maxAttempts }) {
  const atMax = attempts >= maxAttempts;
  const last = !atMax && attempts >= maxAttempts - 1;
  return (
    <Badge tone={atMax ? 'muted' : last ? 'solid' : 'outline'} className="tabular-nums">
      {attempts}/{maxAttempts}
      {atMax ? ' · MAX' : last ? ' · LAST' : ''}
    </Badge>
  );
}
