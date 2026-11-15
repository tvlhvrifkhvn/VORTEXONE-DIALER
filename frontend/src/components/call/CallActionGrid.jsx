import { useState } from 'react';
import { FileText, MessageSquare, MessageSquareWarning, MicOff, PauseCircle, Tag, User } from 'lucide-react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Field from '../ui/Field';
import Badge from '../ui/Badge';
import Keycap from '../ui/Keycap';
import { SmsCompose } from '../leads/LeadActionHub';
import ObjectionPanel from './ObjectionPanel';
import * as api from '../../lib/api';
import { sendWithRetry } from '../../lib/retry';

// Read by colleagueIntel.js when summarizing an office — keep in sync with
// CLIENT_TAG / INTERESTED_TAG there.
const SUGGESTED_TAGS = ['interested', 'client'];

// Square secondary tile; solid with aria-pressed when toggled on.
// `toggle={false}` for plain actions (View lead), `hotkey` shows its keycap.
function GridButton({ icon: Icon, label, onClick, active = false, disabled = false, title, toggle = true, hotkey }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-pressed={toggle ? active : undefined}
      className={`flex min-h-11 items-center justify-center gap-2 border px-2 py-2 font-mono text-xs font-medium uppercase tracking-button transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-foreground bg-foreground text-background' : 'border-strong text-foreground hover:bg-muted'
      }`}
    >
      <Icon size={20} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      <span className="flex items-center gap-2">
        {hotkey && <Keycap>{hotkey}</Keycap>}
        {label}
      </span>
    </button>
  );
}

/**
 * The six mid-call actions. Everything here works without submitting a
 * disposition first, so a rep can tag, note and text while still talking.
 * Deliberately no call-transfer button — there is no second rep to transfer to.
 */
export default function CallActionGrid({ lead, callId, onLeadUpdated, muted = false, onToggleMute }) {
  const [openPanel, setOpenPanel] = useState(null); // 'tag' | 'note' | 'sms' | 'objection' | null
  const [tagText, setTagText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [onHold, setOnHold] = useState(false);

  const toggle = (panel) => {
    setError(null);
    setOpenPanel((current) => (current === panel ? null : panel));
  };

  const showFlash = (message) => {
    setFlash(message);
    setTimeout(() => setFlash(null), 2000);
  };

  const handleAddTag = async (explicitTag) => {
    const tag = (explicitTag ?? tagText).trim();
    if (!tag) return;
    setBusy(true);
    setError(null);
    try {
      const { lead: updated } = await api.addLeadTag(lead.id, tag);
      onLeadUpdated?.(updated);
      setTagText('');
      showFlash('Tag added');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveTag = async (tag) => {
    setError(null);
    try {
      const { lead: updated } = await api.removeLeadTag(lead.id, tag);
      onLeadUpdated?.(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    setError(null);
    const body = noteText;
    const startedAt = Date.now();
    // Before a resend, look for the note: an earlier try may have been saved.
    const alreadySaved = async () => {
      const { notes } = await api.getLeadNotes(lead.id);
      const found = notes.find((n) => n.body === body.trim() && new Date(n.created_at).getTime() >= startedAt - 60_000);
      return found ? { note: found } : null;
    };
    try {
      await sendWithRetry(() => api.addLeadNote(lead.id, body, callId), {
        alreadySaved,
        onRetrying: (attempt, max) => setError(`Note not saved yet — retrying (${attempt + 1} of ${max})…`),
      });
      setError(null);
      setNoteText('');
      showFlash('Note saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Opened in a new tab rather than navigated to: this screen placing the call
  // is mounted, and leaving it would unmount the call (and re-dial on return).
  const handleViewLead = () => window.open(`/leads/${lead.id}`, '_blank', 'noopener');

  // Mute and Hold are UI state only — the mock adapter has no audio path.
  // Phase 2 wires these to Twilio's real mute/hold on the live call leg.
  // Mute is controlled by the page so the M keyboard shortcut stays in sync.
  const handleHold = () => setOnHold((h) => !h);

  return (
    <Panel className="space-y-2 p-2">
      <div className="grid grid-cols-3 gap-2">
        <GridButton icon={Tag} label="Add tag" onClick={() => toggle('tag')} active={openPanel === 'tag'} />
        <GridButton icon={FileText} label="Add note" onClick={() => toggle('note')} active={openPanel === 'note'} />
        <GridButton icon={User} label="View lead ↗" onClick={handleViewLead} title="Open this lead in a new tab" toggle={false} />
        <GridButton
          icon={MessageSquare}
          label="Quick SMS"
          onClick={() => toggle('sms')}
          active={openPanel === 'sms'}
        />
        <GridButton
          icon={MicOff}
          label={muted ? 'Unmute' : 'Mute'}
          onClick={onToggleMute}
          active={muted}
          hotkey="M"
          title="Mute (audio muting arrives with Twilio in phase 2)"
        />
        <GridButton
          icon={PauseCircle}
          label={onHold ? 'Resume' : 'Hold'}
          onClick={handleHold}
          active={onHold}
          title="Hold (real hold arrives with Twilio in phase 2)"
        />
      </div>

      {/* Own full-width row so the 2x3 grid above keeps its layout (and the
          rep's muscle memory). */}
      <button
        type="button"
        onClick={() => toggle('objection')}
        disabled={!callId}
        aria-pressed={openPanel === 'objection'}
        className={`flex min-h-11 w-full items-center justify-center gap-2 border px-2 font-mono text-xs font-medium uppercase tracking-button transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${
          openPanel === 'objection' ? 'border-foreground bg-foreground text-background' : 'border-strong text-foreground hover:bg-muted'
        }`}
      >
        <MessageSquareWarning size={20} strokeWidth={1.5} aria-hidden="true" />
        Objection
      </button>

      {(muted || onHold) && (
        <Badge tone="solid">{[muted && 'Muted', onHold && 'On hold'].filter(Boolean).join(' · ')}</Badge>
      )}

      {lead.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lead.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-2 border border-strong py-0.5 pl-2 pr-1 font-mono text-xs uppercase text-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="px-1 text-muted-foreground hover:bg-foreground hover:text-background"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {openPanel === 'tag' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Field
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
              placeholder="e.g. interested, callback, gatekeeper"
              aria-label="New tag"
              className="flex-1 text-sm"
              autoFocus
            />
            <Button onClick={() => handleAddTag()} disabled={busy || !tagText.trim()}>
              Add
            </Button>
          </div>
          {/* `client` and `interested` are the two tags colleagueIntel reads
              to build an office's social proof, so they get one-tap entry
              rather than relying on the rep spelling them the same way. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">Quick</span>
            {SUGGESTED_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleAddTag(tag)}
                disabled={busy || lead.tags?.includes(tag)}
                className="min-h-8 border border-strong px-2 font-mono text-xs uppercase text-foreground transition-colors duration-150 hover:bg-muted disabled:opacity-40"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {openPanel === 'note' && (
        <div className="space-y-2">
          <Field
            as="textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Note saves on its own — you don't need to submit a disposition."
            aria-label="Note"
            className="w-full resize-none text-sm"
            style={{ minHeight: 70 }}
            autoFocus
          />
          <Button className="w-full" onClick={handleAddNote} disabled={busy || !noteText.trim()}>
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      )}

      {openPanel === 'sms' && <SmsCompose lead={lead} />}

      {openPanel === 'objection' && <ObjectionPanel callId={callId} />}

      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      {flash && <p className="font-mono text-xs uppercase text-foreground">✓ {flash}</p>}
    </Panel>
  );
}
