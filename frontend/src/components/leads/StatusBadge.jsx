import Badge from '../ui/Badge';
import { STATUS_COLORS, STATUS_LABELS } from '../../styles/theme';

export default function StatusBadge({ status }) {
  return <Badge color={STATUS_COLORS[status] || '#6A7A94'}>{STATUS_LABELS[status] || status}</Badge>;
}
