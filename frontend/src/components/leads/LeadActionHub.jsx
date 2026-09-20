import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';

const SEGMENT_SIZE = 160;

function segmentCount(len) {
  return Math.max(1, Math.ceil(len / SEGMENT_SIZE));
}

function mergePreview(body, lead) {
  return body
    .replace(/\{\{name\}\}/g, lead.name || '')
    .replace(/\{\{brokerage\}\}/g, lead.brokerage || '')
    .replace(/\{\{state\}\}/g, lead.state || '')
    .replace(/  +/g, ' ')
    .trim();
}

/** SMS compose section within the lead detail panel — E3. */
function SmsCompose({ lead, onSent }) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [customText, setCustomText] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api.getSmsTemplates().then(({ templates: t }) => setTemplates(t)).catch(() => {});
  }, []);

  const rawBody = useCustom ? customText : templates.find((t) => String(t.id) === String(templateId))?.body || '';
  const preview = mergePreview(rawBody, lead);
  const canSend = (useCustom ? customText.trim() : templateId) && !sending;

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      await api.sendSms({ leadId: lead.id, ...(useCustom ? { rawBody: customText } : { templateId }) });
      setSent(true);
      onSent?.();
      setTimeout(() => setSent(false), 2000);
      setCustomText('');
      setTemplateId('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (lead.sms_opt_out) {
    return (
      <p className="rounded-input bg-surface p-3 text-xs text-text-secondary shadow-neu-inset">
        This lead has opted out of SMS messages.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-input bg-surface p-3 shadow-neu-inset">
      <NeuInput
        as="select"
        value={useCustom ? 'custom' : templateId}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setUseCustom(true);
            setTemplateId('');
          } else {
            setUseCustom(false);
            setTemplateId(e.target.value);
          }
        }}
        className="w-full text-sm"
      >
        <option value="">Select a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        <option value="custom">Write custom message</option>
      </NeuInput>

      {useCustom && (
        <NeuInput
          as="textarea"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          className="w-full resize-none"
          style={{ minHeight: 80 }}
          placeholder="Type a message…"
        />
      )}

      {rawBody && (
        <div className="rounded-input bg-base p-2 text-xs text-text-primary">{preview}</div>
      )}

      <p className="text-xs text-text-secondary">
        {preview.length} / {SEGMENT_SIZE} characters ({segmentCount(preview.length)} segment
        {segmentCount(preview.length) === 1 ? '' : 's'})
      </p>

      {error && <p className="text-xs text-action-hangup">{error}</p>}
      {sent && <p className="text-xs text-action-contacted">Sent</p>}

      <NeuButton className="w-full text-sm" onClick={handleSend} disabled={!canSend}>
        {sending ? 'Sending…' : 'Send'}
      </NeuButton>
    </div>
  );
}

function TimelineEntry({ entry }) {
  if (entry.type === 'call') {
    return (
      <div className="flex items-start gap-2 border-b border-shadow/20 py-2 last:border-0">
        <Phone size={14} className="mt-0.5 shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-text-primary">{entry.disposition || 'No disposition'}</span>
            {entry.was_recorded && (
              <span className="rounded-full bg-action-hangup/10 px-1.5 py-0.5 text-[10px] font-medium text-action-hangup">
                Recording
              </span>
            )}
            <span className="text-text-secondary">{formatDateTime(entry.timestamp)}</span>
          </div>
          {entry.note && <p className="mt-0.5 text-xs text-text-secondary">{entry.note}</p>}
        </div>
      </div>
    );
  }
  const isOutbound = entry.direction === 'outbound';
  return (
    <div className={`flex py-2 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-input px-3 py-2 text-xs ${
          isOutbound ? 'bg-action-call/10 text-text-primary' : 'bg-surface text-text-primary shadow-neu-sm'
        }`}
      >
        <p>{entry.body}</p>
        <p className="mt-1 text-[10px] text-text-secondary">{formatDateTime(entry.timestamp)}</p>
      </div>
    </div>
  );
}

/** Action row + SMS compose + unified timeline — Part E, the lead detail
 * panel's "action hub". */
export default function LeadActionHub({ lead }) {
  const navigate = useNavigate();
  const [smsOpen, setSmsOpen] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [loadingTimeline, setLoadingTimeline] = useState(true);

  const loadTimeline = () => {
    setLoadingTimeline(true);
    api
      .getLeadTimeline(lead.id)
      .then((data) => setTimeline(data.timeline))
      .catch(() => {})
      .finally(() => setLoadingTimeline(false));
  };

  useEffect(loadTimeline, [lead.id]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => navigate(`/call/${lead.id}`)}
          className="flex flex-1 flex-col items-center gap-1 rounded-input px-2 py-2 text-xs font-medium text-text-primary shadow-neu-sm hover:shadow-neu"
        >
          <Phone size={16} />
          Call
        </button>
        <button
          type="button"
          onClick={() => setSmsOpen((v) => !v)}
          className="flex flex-1 flex-col items-center gap-1 rounded-input px-2 py-2 text-xs font-medium text-text-primary shadow-neu-sm hover:shadow-neu"
        >
          <MessageSquare size={16} />
          Send SMS
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex flex-1 cursor-not-allowed flex-col items-center gap-1 rounded-input px-2 py-2 text-xs font-medium text-text-secondary opacity-50 shadow-neu-sm"
        >
          <Mail size={16} />
          Send Email
        </button>
      </div>

      {smsOpen && <SmsCompose lead={lead} onSent={() => { setSmsOpen(false); loadTimeline(); }} />}

      <NeuCard inset className="max-h-64 space-y-1 overflow-y-auto p-3">
        <p className="mb-1 text-xs font-semibold text-text-secondary">History</p>
        {loadingTimeline ? (
          <p className="text-xs text-text-secondary">Loading…</p>
        ) : timeline.length === 0 ? (
          <p className="text-xs text-text-secondary">No calls or messages yet.</p>
        ) : (
          timeline.map((entry) => <TimelineEntry key={`${entry.type}-${entry.id}`} entry={entry} />)
        )}
      </NeuCard>
    </div>
  );
}
