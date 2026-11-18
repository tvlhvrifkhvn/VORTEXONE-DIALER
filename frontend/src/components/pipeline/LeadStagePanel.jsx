// The lead page's pipeline block (C2B): the stage picker, a lost reason when
// the stage is the lost one, and the deal value. Saving the stage writes a
// history row (source manual); neither save touches the dialer status.
// C8C: the WORK rail's PIPELINE: stage and deal value stacked, and one SAVE
// (solid) that appears only after a change; it saves whichever changed.
import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import SectionLabel from '../ui/SectionLabel';
import { useStages } from '../../hooks/useStages';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

const toDollars = (cents) => (cents === null || cents === undefined ? '' : (Number(cents) / 100).toFixed(2).replace(/\.00$/, ''));

export default function LeadStagePanel({ lead, onChange }) {
  const { stages } = useStages();
  const [stageId, setStageId] = useState(String(lead.pipeline_stage_id || ''));
  const [lostReason, setLostReason] = useState(lead.lost_reason || '');
  const [deal, setDeal] = useState(toDollars(lead.deal_value_cents));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setStageId(String(lead.pipeline_stage_id || ''));
    setLostReason(lead.lost_reason || '');
    setDeal(toDollars(lead.deal_value_cents));
  }, [lead.pipeline_stage_id, lead.lost_reason, lead.deal_value_cents]);

  const picked = stages.find((s) => String(s.id) === stageId);
  const stageChanged = picked && (picked.id !== lead.pipeline_stage_id || (picked.kind === 'lost' && lostReason.trim() !== (lead.lost_reason || '')));

  const run = async (fn, ok) => {
    setBusy(true);
    setMessage(null);
    try {
      const updated = await fn();
      onChange(updated);
      setMessage({ type: 'ok', text: ok });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const saveStage = () =>
    run(async () => {
      const { lead: updated } = await api.moveLeadStage(lead.id, picked.id, picked.kind === 'lost' ? lostReason : undefined);
      return updated;
    }, `Moved to ${picked.name}.`);

  const dealChanged = deal !== toDollars(lead.deal_value_cents);
  const saveDeal = () => {
    const trimmed = deal.trim().replace(/[$,]/g, '');
    if (trimmed !== '' && !/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      setMessage({ type: 'error', text: 'Enter the deal value in dollars, like 1500 or 1500.50.' });
      return;
    }
    const cents = trimmed === '' ? null : Math.round(Number(trimmed) * 100);
    run(async () => (await api.setLeadDealValue(lead.id, cents)).lead, cents === null ? 'Deal value cleared.' : 'Deal value saved.');
  };

  const save = async () => {
    if (stageChanged) await saveStage();
    if (dealChanged) saveDeal();
  };
  const cancel = () => {
    setStageId(String(lead.pipeline_stage_id || ''));
    setLostReason(lead.lost_reason || '');
    setDeal(toDollars(lead.deal_value_cents));
    setMessage(null);
  };

  return (
    <section className="space-y-2" data-testid="lead-pipeline">
      <SectionLabel title="Pipeline" meta={lead.won_at ? `Won ${formatDateTime(lead.won_at)}` : undefined} />
      <div className="space-y-3">
        <div>
          <label htmlFor="lead-stage" className="label mb-1 block">Stage</label>
          <Field as="select" id="lead-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} className="w-full">
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind !== 'open' ? ` (${s.kind})` : ''}
              </option>
            ))}
          </Field>
        </div>
        {picked?.kind === 'lost' && (
          <div>
            <label htmlFor="lead-lost-reason" className="label mb-1 block">Lost reason</label>
            <Field id="lead-lost-reason" value={lostReason} onChange={(e) => setLostReason(e.target.value)} maxLength={200} placeholder="e.g. Went with another VA" className="w-full" />
          </div>
        )}
        <div>
          <label htmlFor="lead-deal-value" className="label mb-1 block">Deal value · USD</label>
          <Field id="lead-deal-value" inputMode="decimal" value={deal} onChange={(e) => setDeal(e.target.value)} placeholder="0" className="w-full font-mono tabular-nums" />
        </div>
        {(stageChanged || dealChanged) && (
          <div className="flex gap-2">
            <Button variant="solid" size="sm" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      {message && (
        <p role={message.type === 'ok' ? 'status' : 'alert'} className={`text-sm ${message.type === 'ok' ? 'text-foreground' : 'text-signal'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
