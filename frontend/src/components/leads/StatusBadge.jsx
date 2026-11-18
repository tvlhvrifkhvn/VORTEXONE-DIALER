import Badge from '../ui/Badge';
import { STATUS_TAGS, STATUS_LABELS } from '../../styles/theme';

export default function StatusBadge({ status }) {
  const label = STATUS_LABELS[status] || status;
  return <Badge tone={STATUS_TAGS[status] || 'outline'}>{status === 'dnc' ? `⊘ ${label}` : label}</Badge>;
}
