import Panel from '../ui/Panel';
import { formatPhone } from '../../lib/format';

export default function ContactCard({ lead }) {
  if (!lead) return null;

  return (
    <Panel className="p-5">
      <h2 className="truncate text-lg font-semibold text-foreground" title={lead.name}>{lead.name}</h2>
      <p className="mt-1 truncate text-sm text-muted-foreground" title={lead.brokerage || ''}>{lead.brokerage || 'No brokerage on file'}</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="font-medium text-foreground">{formatPhone(lead.phone)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Address</dt>
          <dd className="text-right text-foreground">{lead.address || '—'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">State</dt>
          <dd className="text-foreground">{lead.state}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Attempt</dt>
          <dd className="text-foreground">
            {lead.attempts} / {lead.max_attempts}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}
