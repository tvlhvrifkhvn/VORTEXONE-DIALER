import NeuCard from '../ui/NeuCard';
import { formatPhone } from '../../lib/format';

export default function ContactCard({ lead }) {
  if (!lead) return null;

  return (
    <NeuCard className="p-5">
      <h2 className="text-lg font-semibold text-text-primary">{lead.name}</h2>
      <p className="mt-1 text-sm text-text-secondary">{lead.brokerage || 'No brokerage on file'}</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Phone</dt>
          <dd className="font-medium text-text-primary">{formatPhone(lead.phone)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Address</dt>
          <dd className="text-right text-text-primary">{lead.address || '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">State</dt>
          <dd className="text-text-primary">{lead.state}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-secondary">Attempt</dt>
          <dd className="text-text-primary">
            {lead.attempts} / {lead.max_attempts}
          </dd>
        </div>
      </dl>
    </NeuCard>
  );
}
