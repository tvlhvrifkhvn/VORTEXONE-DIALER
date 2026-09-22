import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { File, Mail, MessageSquare, Paperclip, Phone, X } from 'lucide-react';
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

/** SMS compose section within the lead detail panel — E3, plus Part C's
 * optional media attachment. */
export function SmsCompose({ lead, onSent }) {
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [customText, setCustomText] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [mediaName, setMediaName] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.getSmsTemplates().then(({ templates: t }) => setTemplates(t)).catch(() => {});
  }, []);

  const rawBody = useCustom ? customText : templates.find((t) => String(t.id) === String(templateId))?.body || '';
  const preview = mergePreview(rawBody, lead);
  const canSend = (useCustom ? customText.trim() : templateId) && !sending && !uploading;

  const handleAttachClick = () => fileInputRef.current?.click();

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.uploadSmsMedia(file);
      setMediaUrl(url);
      setMediaName(file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveMedia = () => {
    setMediaUrl(null);
    setMediaName(null);
  };

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      await api.sendSms({
        leadId: lead.id,
        ...(useCustom ? { rawBody: customText } : { templateId }),
        ...(mediaUrl ? { mediaUrl } : {}),
      });
      setSent(true);
      onSent?.();
      setTimeout(() => setSent(false), 2000);
      setCustomText('');
      setTemplateId('');
      handleRemoveMedia();
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={handleFileSelected}
      />

      {mediaUrl && mediaName && (
        <div className="flex items-center gap-2 rounded-input bg-base p-2 text-xs text-text-primary">
          {/\.(png|jpe?g|gif|webp)$/i.test(mediaName) ? (
            <img src={api.resolveMediaUrl(mediaUrl)} alt={mediaName} className="h-10 w-10 rounded object-cover" />
          ) : (
            <File size={16} className="shrink-0 text-text-secondary" />
          )}
          <span className="min-w-0 flex-1 truncate">{mediaName}</span>
          <button type="button" onClick={handleRemoveMedia} className="shrink-0 text-text-secondary hover:text-action-hangup">
            <X size={14} />
          </button>
        </div>
      )}

      {error && <p className="text-xs text-action-hangup">{error}</p>}
      {sent && <p className="text-xs text-action-contacted">Sent</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleAttachClick}
          disabled={uploading || sending}
          title="Attach a file"
          className="flex shrink-0 items-center justify-center rounded-input p-2 text-text-secondary shadow-neu-sm hover:shadow-neu disabled:opacity-50"
        >
          <Paperclip size={16} />
        </button>
        <NeuButton className="flex-1 text-sm" onClick={handleSend} disabled={!canSend}>
          {uploading ? 'Uploading…' : sending ? 'Sending…' : 'Send'}
        </NeuButton>
      </div>
    </div>
  );
}

/** Email compose section — Part C. Same merge-field preview pattern as
 * SmsCompose, minus templates/segments/attachments, none of which the brief
 * asked for on this channel. */
export function EmailCompose({ lead, onSent }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const previewSubject = mergePreview(subject, lead);
  const previewBody = mergePreview(body, lead);
  const canSend = body.trim() && !sending;

  const handleSend = async () => {
    setSending(true);
    setError(null);
    try {
      await api.sendEmail({ leadId: lead.id, subject, body });
      setSent(true);
      onSent?.();
      setTimeout(() => setSent(false), 2000);
      setSubject('');
      setBody('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  if (!lead.email) {
    return (
      <p className="rounded-input bg-surface p-3 text-xs text-text-secondary shadow-neu-inset">
        No email address on file for this lead.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-input bg-surface p-3 shadow-neu-inset">
      <NeuInput
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full text-sm"
      />
      <NeuInput
        as="textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full resize-none"
        style={{ minHeight: 100 }}
        placeholder="Write a message… use {{name}}, {{brokerage}}, {{state}}"
      />

      {(previewSubject || previewBody) && (
        <div className="rounded-input bg-base p-2 text-xs text-text-primary">
          {previewSubject && <p className="font-medium">{previewSubject}</p>}
          {previewBody && <p className="mt-1 whitespace-pre-wrap">{previewBody}</p>}
        </div>
      )}

      {error && <p className="text-xs text-action-hangup">{error}</p>}
      {sent && <p className="text-xs text-action-contacted">Sent</p>}

      <NeuButton className="w-full text-sm" onClick={handleSend} disabled={!canSend}>
        {sending ? 'Sending…' : 'Send'}
      </NeuButton>
    </div>
  );
}

function TimelineEntry({ entry }) {
  if (entry.type === 'email') {
    return (
      <div className="flex items-start gap-2 border-b border-shadow/20 py-2 last:border-0">
        <Mail size={14} className="mt-0.5 shrink-0 text-text-secondary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-text-primary">{entry.subject || '(no subject)'}</span>
            <span className="text-text-secondary">{formatDateTime(entry.timestamp)}</span>
          </div>
          {entry.body && <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-secondary">{entry.body}</p>}
        </div>
      </div>
    );
  }
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
        {entry.body && <p>{entry.body}</p>}
        {entry.media_url && (
          /\.(png|jpe?g|gif|webp)$/i.test(entry.media_url) ? (
            <a href={api.resolveMediaUrl(entry.media_url)} target="_blank" rel="noreferrer">
              <img
                src={api.resolveMediaUrl(entry.media_url)}
                alt="attachment"
                className="mt-1 max-h-40 max-w-full rounded-input object-cover"
              />
            </a>
          ) : (
            <a
              href={api.resolveMediaUrl(entry.media_url)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-1 text-[11px] underline"
            >
              <File size={12} className="shrink-0" />
              {entry.media_url.split('/').pop()}
            </a>
          )
        )}
        <p className="mt-1 text-[10px] text-text-secondary">{formatDateTime(entry.timestamp)}</p>
      </div>
    </div>
  );
}

const TIMELINE_POLL_MS = 8000;

/** Action row + SMS compose + unified timeline — Part E, the lead detail
 * panel's "action hub". */
export default function LeadActionHub({ lead }) {
  const navigate = useNavigate();
  const [smsOpen, setSmsOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
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

  // Opening a lead's panel from anywhere (Dashboard row, Inbox row, global
  // search) mounts this component, so this is the one place that needs to
  // clear unread state — not every call site that can open a panel.
  useEffect(() => {
    api.markSmsRead(lead.id).catch(() => {});
  }, [lead.id]);

  // Poll for a new inbound reply while the panel stays open, so it shows up
  // without closing and reopening. Stopped (interval cleared) on unmount —
  // i.e. when the panel closes.
  useEffect(() => {
    const id = setInterval(() => {
      api
        .getLeadTimeline(lead.id)
        .then((data) => setTimeline(data.timeline))
        .catch(() => {});
    }, TIMELINE_POLL_MS);
    return () => clearInterval(id);
  }, [lead.id]);

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
          onClick={() => setEmailOpen((v) => !v)}
          className="flex flex-1 flex-col items-center gap-1 rounded-input px-2 py-2 text-xs font-medium text-text-primary shadow-neu-sm hover:shadow-neu"
        >
          <Mail size={16} />
          Send Email
        </button>
      </div>

      {smsOpen && <SmsCompose lead={lead} onSent={loadTimeline} />}
      {emailOpen && <EmailCompose lead={lead} onSent={loadTimeline} />}

      <NeuCard inset className="max-h-64 space-y-1 overflow-y-auto p-3">
        <p className="mb-1 text-xs font-semibold text-text-secondary">History</p>
        {loadingTimeline ? (
          <p className="text-xs text-text-secondary">Loading…</p>
        ) : timeline.length === 0 ? (
          <p className="text-xs text-text-secondary">No calls, messages, or emails yet.</p>
        ) : (
          timeline.map((entry) => <TimelineEntry key={`${entry.type}-${entry.id}`} entry={entry} />)
        )}
      </NeuCard>
    </div>
  );
}
