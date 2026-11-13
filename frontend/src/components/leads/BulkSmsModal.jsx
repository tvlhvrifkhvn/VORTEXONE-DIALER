import { useEffect, useState } from 'react';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import * as api from '../../lib/api';

function mergePreview(body, lead) {
  return body
    .replace(/\{\{name\}\}/g, lead.name || '')
    .replace(/\{\{brokerage\}\}/g, lead.brokerage || '')
    .replace(/\{\{state\}\}/g, lead.state || '')
    .replace(/  +/g, ' ')
    .trim();
}

/** Part F2 — bulk SMS send confirmation modal from the dashboard's
 * selection sticky bar. `leads` are the already-loaded lead rows for the
 * current selection (carries dnc_flag/sms_opt_out already). */
export default function BulkSmsModal({ leads, onClose, onSent }) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    api.getSmsTemplates().then(({ templates: t }) => setTemplates(t)).catch(() => {});
  }, []);

  const template = templates.find((t) => String(t.id) === String(templateId));
  const eligible = leads.filter((l) => !l.dnc_flag && !l.sms_opt_out);
  const dncCount = leads.filter((l) => l.dnc_flag).length;
  const optOutCount = leads.filter((l) => !l.dnc_flag && l.sms_opt_out).length;

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      const result = await api.sendBulkSms(leads.map((l) => l.id), templateId);
      setSummary(result);
      onSent?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <NeuCard className="w-full max-w-md space-y-4 p-6">
        <h2 className="text-lg font-semibold text-text-primary">Send bulk SMS</h2>

        {summary ? (
          <>
            <p className="text-sm text-text-primary">
              {summary.sent} of {summary.total} sent
            </p>
            <ul className="space-y-0.5 text-xs text-text-secondary" data-testid="bulk-sms-summary">
              {[
                ['opted_out', 'Opted out of texts'],
                ['dnc', 'On the DNC list'],
                ['outside_hours', 'Waiting for their hours (8am–9pm their time) — can be sent later'],
                ['missing_field', 'Missing a field the template uses'],
                ['invalid_number', 'No valid phone number'],
                ['not_found', 'Lead no longer exists'],
                ['failed', 'Failed to send'],
              ]
                .filter(([key]) => summary[key] > 0)
                .map(([key, label]) => (
                  <li key={key}>
                    {label}: {summary[key]}
                  </li>
                ))}
            </ul>
            <NeuButton className="w-full" onClick={onClose}>
              Close
            </NeuButton>
          </>
        ) : (
          <>
            <NeuInput
              as="select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full text-sm"
            >
              <option value="">Select a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NeuInput>

            {template && (
              <div className="space-y-1 rounded-input bg-surface p-3 text-xs text-text-primary shadow-neu-inset">
                <p className="font-medium text-text-secondary">Preview</p>
                {eligible.slice(0, 3).map((l) => (
                  <p key={l.id}>
                    <span className="font-medium">{l.name}:</span> {mergePreview(template.body, l)}
                  </p>
                ))}
              </div>
            )}

            <p className="text-sm text-text-secondary">
              {leads.length} lead{leads.length === 1 ? '' : 's'} selected · {eligible.length} will receive this
              {optOutCount > 0 ? ` · ${optOutCount} opted out of SMS` : ''}
              {dncCount > 0 ? ` · ${dncCount} on Do Not Call` : ''}
            </p>

            {error && <p className="text-sm text-action-hangup">{error}</p>}
            {sending && <p className="text-sm text-text-secondary">Sending to {eligible.length} leads, this may take a moment…</p>}

            <div className="flex gap-2">
              <NeuButton className="flex-1" onClick={handleSend} disabled={!templateId || eligible.length === 0 || sending}>
                {sending ? 'Sending…' : `Send to ${eligible.length} leads`}
              </NeuButton>
              <NeuButton className="flex-1" onClick={onClose} disabled={sending}>
                Cancel
              </NeuButton>
            </div>
          </>
        )}
      </NeuCard>
    </div>
  );
}
