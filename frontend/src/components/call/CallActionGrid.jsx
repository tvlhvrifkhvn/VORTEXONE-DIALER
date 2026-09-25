import { useState } from 'react';
import { FileText, MessageSquare, MicOff, PauseCircle, Tag, User } from 'lucide-react';
import NeuCard from '../ui/NeuCard';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';
import { SmsCompose } from '../leads/LeadActionHub';
import * as api from '../../lib/api';

function GridButton({ icon: Icon, label, onClick, active = false, disabled = false, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-input px-2 py-3 text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'text-action-call shadow-neu-pressed'
          : 'text-text-primary shadow-neu-sm hover:shadow-neu'
      }`}
    >
      <Icon size={18} />
      {label}
    </button>
  );
}

/**
 * The six mid-call actions. Everything here works without submitting a
 * disposition first, so a rep can tag, note and text while still talking.
 * Deliberately no call-transfer button — there is no second rep to transfer to.
 */
export default function CallActionGrid({ lead, callId, onLeadUpdated, muted = false, onToggleMute }) {
  const [openPanel, setOpenPanel] = useState(null); // 'tag' | 'note' | 'sms' | null
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

  const handleAddTag = async () => {
    if (!tagText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { lead: updated } = await api.addLeadTag(lead.id, tagText);
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
    try {
      await api.addLeadNote(lead.id, noteText, callId);
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
    <NeuCard className="space-y-3 p-4">
      <div className="grid grid-cols-3 gap-2">
        <GridButton icon={Tag} label="Add tag" onClick={() => toggle('tag')} active={openPanel === 'tag'} />
        <GridButton icon={FileText} label="Add note" onClick={() => toggle('note')} active={openPanel === 'note'} />
        <GridButton icon={User} label="View lead" onClick={handleViewLead} title="Open this lead in a new tab" />
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

      {(muted || onHold) && (
        <p className="text-xs font-semibold text-action-warn">
          {[muted && 'Muted', onHold && 'On hold'].filter(Boolean).join(' · ')}
        </p>
      )}

      {lead.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lead.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] text-text-primary shadow-neu-sm"
            >
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                aria-label={`Remove tag ${tag}`}
                className="text-text-secondary hover:text-action-hangup"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {openPanel === 'tag' && (
        <div className="flex gap-2">
          <NeuInput
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            placeholder="e.g. interested, callback, gatekeeper"
            className="flex-1 text-sm"
            autoFocus
          />
          <NeuButton className="text-sm" onClick={handleAddTag} disabled={busy || !tagText.trim()}>
            Add
          </NeuButton>
        </div>
      )}

      {openPanel === 'note' && (
        <div className="space-y-2">
          <NeuInput
            as="textarea"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Note saves on its own — you don't need to submit a disposition."
            className="w-full resize-none text-sm"
            style={{ minHeight: 70 }}
            autoFocus
          />
          <NeuButton className="w-full text-sm" onClick={handleAddNote} disabled={busy || !noteText.trim()}>
            {busy ? 'Saving…' : 'Save note'}
          </NeuButton>
        </div>
      )}

      {openPanel === 'sms' && <SmsCompose lead={lead} />}

      {error && <p className="text-xs text-action-hangup">{error}</p>}
      {flash && <p className="text-xs text-action-contacted">{flash}</p>}
    </NeuCard>
  );
}
