import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, File, ListTodo, Mail, MessageSquare, Paperclip, Phone, StickyNote, Upload, X } from 'lucide-react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Segmented from '../ui/Segmented';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';
import { pollWhileVisible } from '../../lib/poll';

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
      <p className="border bg-muted p-4 text-sm text-muted-foreground">
        This lead has opted out of SMS messages.
      </p>
    );
  }

  return (
    <div className="space-y-2 border bg-muted p-4">
      <Field
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
        aria-label="SMS template"
        className="w-full text-sm"
      >
        <option value="">Select a template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        <option value="custom">Write custom message</option>
      </Field>

      {useCustom && (
        <Field
          as="textarea"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          className="w-full resize-none"
          style={{ minHeight: 80 }}
          aria-label="Message"
          placeholder="Type a message…"
        />
      )}

      {rawBody && (
        <div className="border bg-background p-2 text-sm text-foreground">{preview}</div>
      )}

      <p className="font-mono text-xs tabular-nums text-muted-foreground">
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
        <div className="flex items-center gap-2 border bg-background p-2 text-sm text-foreground">
          {/\.(png|jpe?g|gif|webp)$/i.test(mediaName) ? (
            <img src={api.resolveMediaUrl(mediaUrl)} alt={mediaName} className="h-10 w-10 object-cover" />
          ) : (
            <File size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{mediaName}</span>
          <button
            type="button"
            onClick={handleRemoveMedia}
            aria-label={`Remove ${mediaName}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-foreground hover:text-background"
          >
            <X size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {sent && <p className="font-mono text-xs uppercase text-foreground">✓ Sent</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleAttachClick}
          disabled={uploading || sending}
          title="Attach a file"
          aria-label="Attach a file"
          className="flex h-10 w-10 shrink-0 items-center justify-center border border-strong text-foreground transition-colors duration-150 hover:bg-foreground hover:text-background disabled:opacity-40"
        >
          <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <Button className="flex-1" onClick={handleSend} disabled={!canSend}>
          {uploading ? 'Uploading…' : sending ? 'Sending…' : 'Send'}
        </Button>
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
      <p className="border bg-muted p-4 text-sm text-muted-foreground">
        No email address on file for this lead.
      </p>
    );
  }

  return (
    <div className="space-y-2 border bg-muted p-4">
      <Field
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        aria-label="Email subject"
        className="w-full text-sm"
      />
      <Field
        as="textarea"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full resize-none"
        style={{ minHeight: 100 }}
        aria-label="Email body"
        placeholder="Write a message… use {{name}}, {{first_name}}, {{brokerage}}, {{state}}, {{city}}"
      />

      {(previewSubject || previewBody) && (
        <div className="border bg-background p-2 text-sm text-foreground">
          {previewSubject && <p className="font-medium">{previewSubject}</p>}
          {previewBody && <p className="mt-1 whitespace-pre-wrap">{previewBody}</p>}
        </div>
      )}

      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {sent && <p className="font-mono text-xs uppercase text-foreground">✓ Sent</p>}

      <Button className="w-full" onClick={handleSend} disabled={!canSend}>
        {sending ? 'Sending…' : 'Send'}
      </Button>
    </div>
  );
}

// C2D: the timeline as a hairline list. One row per event: a type label,
// what happened, then the time. Kinds are told apart by their label, not color.
const DISPOSITION_TEXT = {
  contacted: 'Spoke / Interested',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  no_contact_number: 'Bad number',
  no_contact_person: 'No contact — person',
  dnc: 'DNC',
  callback_scheduled: 'Callback scheduled',
};

// The filter: which entry types each choice shows.
const TIMELINE_FILTERS = [
  { value: 'all', label: 'All', types: null },
  { value: 'calls', label: 'Calls', types: ['call'] },
  { value: 'texts', label: 'Texts', types: ['sms', 'sms_opt'] },
  { value: 'emails', label: 'Emails', types: ['email'] },
  { value: 'notes', label: 'Notes', types: ['note'] },
  { value: 'stages', label: 'Stages', types: ['stage', 'import'] },
];

function describe(entry, leadName) {
  switch (entry.type) {
    case 'call':
      return {
        icon: Phone,
        label: 'Call',
        title: entry.disposition ? DISPOSITION_TEXT[entry.disposition] || entry.disposition : 'No outcome logged',
        body: entry.note,
        extra: entry.was_recorded ? 'Recording' : null,
      };
    case 'sms':
      return {
        icon: MessageSquare,
        label: entry.direction === 'outbound' ? 'Text · you' : `Text · ${leadName || 'lead'}`,
        title: entry.body || '',
        media: entry.media_url,
      };
    case 'sms_opt':
      return {
        icon: MessageSquare,
        label: 'Texts',
        title: `${entry.action === 'opt_out' ? 'Opted out of texts' : 'Opted back in to texts'} ${entry.source === 'inbound_keyword' ? 'by text reply' : 'by the rep'}`,
      };
    case 'email':
      return { icon: Mail, label: entry.direction === 'inbound' ? 'Email · in' : 'Email', title: entry.subject || '(no subject)', body: entry.body };
    case 'note':
      return { icon: StickyNote, label: 'Note', title: entry.body };
    case 'task':
      return {
        icon: ListTodo,
        label: 'Task',
        title: entry.title,
        extra: entry.done_at ? 'Done' : null,
        body: `Due ${formatDateTime(entry.due_at)}${entry.source === 'disposition' ? ' · from an outcome' : ''}`,
      };
    case 'import':
      return { icon: Upload, label: 'Import', title: `Imported into ${entry.to_stage || 'the pipeline'}`, by: entry.user_name };
    case 'stage':
      return {
        icon: ArrowRight,
        label: 'Stage',
        title: entry.from_stage ? `${entry.from_stage} → ${entry.to_stage || 'a deleted stage'}` : `Added in ${entry.to_stage || 'the pipeline'}`,
        extra: entry.source === 'disposition' ? 'by outcome' : entry.source === 'undo' ? 'undo' : entry.source === 'move' ? 'file move' : null,
        by: entry.user_name,
      };
    default:
      return { icon: File, label: entry.type, title: '' };
  }
}

function TimelineEntry({ entry, leadName }) {
  const d = describe(entry, leadName);
  const Icon = d.icon;
  return (
    <li className="flex items-start gap-2 border-b py-2 last:border-b-0">
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          <span className="label">{d.label}</span>
          <span className="min-w-0 break-words font-medium text-foreground">{d.title}</span>
          {d.extra && <span className="border border-strong px-2 py-0.5 font-mono text-xs uppercase text-foreground">{d.extra}</span>}
          {d.by && <span className="text-muted-foreground">by {d.by}</span>}
          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(entry.timestamp)}</span>
        </div>
        {d.body && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{d.body}</p>}
        {d.media &&
          (/\.(png|jpe?g|gif|webp)$/i.test(d.media) ? (
            <a href={api.resolveMediaUrl(d.media)} target="_blank" rel="noreferrer">
              <img src={api.resolveMediaUrl(d.media)} alt="Text attachment" className="mt-1 max-h-40 max-w-full object-cover" />
            </a>
          ) : (
            <a href={api.resolveMediaUrl(d.media)} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-sm underline">
              <File size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
              {d.media.split('/').pop()}
            </a>
          ))}
      </div>
    </li>
  );
}

const TIMELINE_POLL_MS = 8000;

/** Action row + SMS compose + unified timeline — Part E, the lead detail
 * panel's "action hub". */
export default function LeadActionHub({ lead }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [smsOpen, setSmsOpen] = useState(() => searchParams.get('reply') === '1'); // C3B: REPLY from Today
  const [emailOpen, setEmailOpen] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [loadingTimeline, setLoadingTimeline] = useState(true);
  const [filter, setFilter] = useState('all');
  const filterTypes = TIMELINE_FILTERS.find((f) => f.value === filter)?.types;
  const shown = filterTypes ? timeline.filter((e) => filterTypes.includes(e.type)) : timeline;

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
    const load = () =>
      api
        .getLeadTimeline(lead.id)
        .then((data) => setTimeline(data.timeline))
        .catch(() => {});
    return pollWhileVisible(load, TIMELINE_POLL_MS);
  }, [lead.id]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Button variant="primary" onClick={() => navigate(`/call/${lead.id}`)}>
          <Phone size={16} strokeWidth={1.5} aria-hidden="true" />
          Call
        </Button>
        <Button active={smsOpen} aria-pressed={smsOpen} onClick={() => setSmsOpen((v) => !v)}>
          <MessageSquare size={16} strokeWidth={1.5} aria-hidden="true" />
          SMS
        </Button>
        <Button active={emailOpen} aria-pressed={emailOpen} onClick={() => setEmailOpen((v) => !v)}>
          <Mail size={16} strokeWidth={1.5} aria-hidden="true" />
          Email
        </Button>
      </div>

      {smsOpen && <SmsCompose lead={lead} onSent={loadTimeline} />}
      {emailOpen && <EmailCompose lead={lead} onSent={loadTimeline} />}

      <Panel className="space-y-2 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <p className="label">Timeline</p>
          <Segmented
            label="Timeline filter"
            options={TIMELINE_FILTERS.map(({ value, label }) => ({ value, label }))}
            value={filter}
            onChange={setFilter}
          />
        </div>
        {loadingTimeline ? (
          <p className="label pb-2">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="pb-2 text-sm text-muted-foreground">{timeline.length === 0 ? 'Nothing here yet.' : 'Nothing of this kind yet.'}</p>
        ) : (
          <ul className="max-h-[32rem] overflow-y-auto border-t">
            {shown.map((entry) => (
              <TimelineEntry key={`${entry.type}-${entry.id}`} entry={entry} leadName={lead.name} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
