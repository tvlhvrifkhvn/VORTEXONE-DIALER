import { useEffect, useState } from 'react';
import Dialog from '../ui/Dialog';
import Button from '../ui/Button';
import Field from '../ui/Field';
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
    // No CLOSE × while sending: Cancel is disabled then too.
    <Dialog title="Send bulk SMS" onClose={sending ? undefined : onClose} className="max-w-md">
      <div className="space-y-4">
        {summary ? (
          <>
            <p className="text-base text-foreground">
              <span className="font-mono font-medium tabular-nums">
                {summary.sent} / {summary.total}
              </span>{' '}
              sent
            </p>
            <ul className="text-sm text-muted-foreground" data-testid="bulk-sms-summary">
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
                  <li key={key} className="flex justify-between gap-4 border-b py-2 last:border-b-0">
                    <span>{label}</span>
                    <span className="font-mono tabular-nums text-foreground">{summary[key]}</span>
                  </li>
                ))}
            </ul>
            <Button className="w-full" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <>
            <label htmlFor="bulk-sms-template" className="label -mb-2 block">
              Template
            </label>
            <Field
              as="select"
              id="bulk-sms-template"
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
            </Field>

            {template && (
              <div className="space-y-2 border bg-muted p-4 text-sm text-foreground">
                <p className="label">Preview</p>
                {eligible.slice(0, 3).map((l) => (
                  <p key={l.id}>
                    <span className="font-medium">{l.name}:</span> {mergePreview(template.body, l)}
                  </p>
                ))}
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              {leads.length} lead{leads.length === 1 ? '' : 's'} selected · {eligible.length} will receive this
              {optOutCount > 0 ? ` · ${optOutCount} opted out of SMS` : ''}
              {dncCount > 0 ? ` · ${dncCount} on Do Not Call` : ''}
            </p>

            {error && (
              <p role="alert" className="text-sm text-signal">
                <span className="label mr-2 text-signal">Error</span>
                {error}
              </p>
            )}
            {sending && <p className="text-sm text-muted-foreground">Sending to {eligible.length} leads, this may take a moment…</p>}

            <div className="flex gap-2">
              <Button
                variant="primary"
                className="flex-1"
                onClick={handleSend}
                disabled={!templateId || eligible.length === 0 || sending}
              >
                {sending ? 'Sending…' : `Send to ${eligible.length} leads`}
              </Button>
              <Button className="flex-1" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
