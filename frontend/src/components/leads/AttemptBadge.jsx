import Badge from '../ui/Badge';

// Goes amber on the last attempt before a lead would go cold.
export default function AttemptBadge({ attempts, maxAttempts }) {
  const color = attempts >= maxAttempts ? '#DC2626' : attempts >= maxAttempts - 1 ? '#F59E0B' : '#6A7A94';
  return (
    <Badge color={color}>
      {attempts}/{maxAttempts}
    </Badge>
  );
}
