import { useEffect, useRef, useState } from 'react';
import NotesField from './NotesField';
import DispositionButtons from './DispositionButtons';
import StatusBadge from '../leads/StatusBadge';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import ActionButton from '../ui/ActionButton';
import Badge from '../ui/Badge';
import Dialog from '../ui/Dialog';
import Keycap from '../ui/Keycap';
import SectionLabel from '../ui/SectionLabel';
import { useAuth } from '../../hooks/useAuth';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';
import { useCampaign } from '../../hooks/useCampaign';
import { useStages } from '../../hooks/useStages';
import Field from '../ui/Field';
import { defaultDue } from '../tasks/TaskForm';

const DEFAULT_PITCH_SCRIPT = (repName) =>
  `Hi, I'm ${repName} from Vortexone Agency. We offer virtual assistant services for real ` +
  'estate agents — lead follow-up, appointment setting, and admin support. Do you currently ' +
  'have VA support on your team?';

/** C1E: the active file's script ({name} = the rep), or the default for a
 * real estate file; another kind of file without a script says so. */
function PitchScriptText({ repName }) {
  const { active } = useCampaign();
  const script = active?.pitch_script?.trim();
  if (script) return <>{script.replaceAll('{name}', repName)}</>;
  if (!active || active.kind === 'real_estate') return <>{DEFAULT_PITCH_SCRIPT(repName)}</>;
  return <>No pitch script for this file yet. Add one under Settings → Files.</>;
}

/** Collapsible sidebar section — arrow toggle, collapsed by default. */
function CollapsibleSection({ title, defaultOpen = false, children, bodyClassName = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel className="px-4 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center justify-between text-left font-mono text-sm font-medium uppercase tracking-button text-foreground"
      >
        <span>{title}</span>
        <span aria-hidden="true" className={open ? 'rotate-90' : ''}>
          ▶
        </span>
      </button>
      {open && <div className={`pb-2 pt-2 ${bodyClassName}`}>{children}</div>}
    </Panel>
  );
}

/**
 * Everything previously noted about this lead, newest first: logged calls
 * (outcome + the note typed with it) and the standalone notes added with
 * "Add note" during a call. Both come from the lead timeline
 * (GET /api/leads/:id/timeline); the call in progress is left out.
 */
// C8E: exported for the call screen's LEAD column (RECENT: `limit` 5, `compact`).
export function PreviousNotes({ leadId, currentCallId, limit = null, compact = false }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId) return undefined;
    let cancelled = false;
    setLoading(true);
    api
      .getLeadTimeline(leadId)
      .then(({ timeline }) => {
        if (cancelled) return;
        setEntries(
          (timeline || []).filter(
            (e) => (e.type === 'call' && e.disposition && e.id !== currentCallId) || (e.type === 'note' && e.body)
          )
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, currentCallId]);

  if (loading) return <p className="label">Loading…</p>;
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{compact ? 'Nothing yet.' : 'No previous calls or notes.'}</p>;
  const shown = limit ? entries.slice(0, limit) : entries;

  return (
    <ul>
      {shown.map((e) => (
        <li key={`${e.type}-${e.id}`} className={`border-b last:border-b-0 ${compact ? 'py-1' : 'py-2'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Badge tone="muted">{e.type === 'call' ? 'Call' : 'Note'}</Badge>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(e.timestamp)}</span>
            </span>
            {e.type === 'call' && <StatusBadge status={e.disposition} />}
          </div>
          {e.type === 'call' && e.note && <p className={`mt-1 text-sm text-foreground ${compact ? 'line-clamp-2' : ''}`}>{e.note}</p>}
          {e.type === 'note' && <p className={`mt-1 text-sm text-foreground ${compact ? 'line-clamp-2' : ''}`}>{e.body}</p>}
        </li>
      ))}
    </ul>
  );
}

/** The pitch script panel on its own, for layouts (the call screen) that
 * place it in a sidebar rather than inline under the disposition buttons. */
// C8E: `defaultOpen` and a scrolling body on the call screen's HELP column.
export function ScriptPanel({ defaultOpen = false }) {
  const { user } = useAuth();
  return (
    <CollapsibleSection title="Pitch script" defaultOpen={defaultOpen} bodyClassName={defaultOpen ? 'max-h-[40vh] overflow-y-auto' : ''}>
      <p className="text-sm leading-relaxed text-foreground"><PitchScriptText repName={user?.name || 'the rep'} /></p>
    </CollapsibleSection>
  );
}

/**
 * The notes field, Expand note, pitch script, previous-notes history and the six
 * disposition buttons — shared so the single-line call screen and an
 * answered multi-line card present exactly the same UI.
 *
 * The parent owns how a disposition is actually submitted (useCall on the
 * call screen, a direct API call in the multi-line panel) and receives it via
 * onDispositionSubmit({ disposition, note }).
 */
export default function DispositionPanel({
  lead,
  callId,
  onDispositionSubmit,
  disabled = false,
  showScript = true,
  // Section numbers for the labels, e.g. { notes: '05', outcome: '06' } on
  // the call screen. Unnumbered elsewhere (a multi-line card).
  sections = {},
  // C8E: the call screen's layout: NOTES 4 rows with a 32px EXPAND NOTE, MOVE
  // TO STAGE and FOLLOW-UP TASK in one row, the six outcomes 3×2 at 48px, and
  // no PREVIOUS NOTES (they're RECENT in the LEAD column). Logic unchanged.
  compact = false,
}) {
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [retrying, setRetrying] = useState(null);
  const [expanding, setExpanding] = useState(false);
  const [showDncConfirm, setShowDncConfirm] = useState(false);
  const [highlight, setHighlight] = useState(false);
  const dispositionRef = useRef(null);
  // C2B: optional stage for this outcome; '' = Auto (the server's rules).
  const { stages } = useStages();
  const [stageId, setStageId] = useState('');
  // C3A: an optional follow-up task sent with the outcome.
  const [followUp, setFollowUp] = useState(false);
  const [followTitle, setFollowTitle] = useState('');
  const [followDue, setFollowDue] = useState(defaultDue);

  const locked = disabled || submitting;

  // A multi-line slot reuses this panel for the next lead it answers — clear
  // the previous call's note so it can't be attached to the wrong lead.
  useEffect(() => {
    setNote('');
    setError(null);
    setStageId('');
    setFollowUp(false);
    setFollowTitle('');
    setFollowDue(defaultDue());
  }, [callId]);

  const submitOutcome = async (disposition) => {
    setSubmitting(true);
    setError(null);
    setRetrying(null);
    // A 429 or a dropped connection is retried automatically (lib/retry.js);
    // the panel stays open and says so until it is saved or gives up.
    const onRetrying = (attempt, max) => setRetrying(`Not saved yet — retrying (${attempt + 1} of ${max})…`);
    try {
      const task = followUp && followTitle.trim() && followDue
        ? { title: followTitle.trim(), due_at: new Date(followDue).toISOString(), type: 'call' }
        : null;
      await onDispositionSubmit({ disposition, note, onRetrying, ...(stageId ? { stageId: Number(stageId) } : {}), ...(task ? { task } : {}) });
    } catch (err) {
      setError(`Couldn't save this outcome: ${err.message} Click it again to retry.`);
    } finally {
      setRetrying(null);
      setSubmitting(false);
    }
  };

  // DNC is permanent — confirm before it actually fires. Every other
  // disposition button submits immediately.
  const handleSelect = (disposition) => {
    if (disposition === 'dnc') {
      setShowDncConfirm(true);
      return;
    }
    submitOutcome(disposition);
  };

  const handleExpandNote = async () => {
    if (!note.trim() || expanding) return;
    setExpanding(true);
    setError(null);
    try {
      const { note: expanded } = await api.expandNote(note);
      setNote(expanded);
    } catch (err) {
      setError(err.message);
    } finally {
      setExpanding(false);
    }
  };

  // V / N / D shortcuts live here now that this component owns the
  // disposition buttons; CallScreen keeps M (mute) and Esc (hang up).
  useEffect(() => {
    const handler = (e) => {
      const tag = e.target?.tagName;
      // SELECT too (C2B): typing in the stage picker must never pick an outcome.
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (locked) return;

      if (e.key === 'v' || e.key === 'V') handleSelect('voicemail');
      else if (e.key === 'n' || e.key === 'N') handleSelect('no_answer');
      else if (e.key === 'd' || e.key === 'D') {
        dispositionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlight(true);
        setTimeout(() => setHighlight(false), 800);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, note, stageId, followUp, followTitle, followDue]);

  return (
    <div className="space-y-4">
      <section>
        <SectionLabel
          index={sections.notes}
          title="Notes"
          className="mb-2 items-center"
          meta={
            <Button variant="ghost" size={compact ? 'sm' : 'md'} className="-my-2" onClick={handleExpandNote} disabled={!note.trim() || expanding}>
              {expanding ? 'Expanding…' : 'Expand note'}
            </Button>
          }
        />
        <NotesField value={note} onChange={setNote} rows={compact ? 4 : 3} />
      </section>

      <section className="space-y-2">
        <SectionLabel
          index={sections.outcome}
          title="Outcome"
          meta={
            <span className="flex items-center gap-2">
              <Keycap>D</Keycap> Jump here
            </span>
          }
        />
        <div className={compact ? 'flex flex-wrap items-center gap-x-6 gap-y-2' : 'space-y-2'}>
        {/* C2B: optional stage move with the outcome (Auto = the file's rules). */}
        {stages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`outcome-stage-${callId || 'none'}`} className="label">
              Move to stage
            </label>
            <Field
              as="select"
              id={`outcome-stage-${callId || 'none'}`}
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              disabled={locked}
              className={`${compact ? 'w-44' : 'w-56'} text-sm`}
            >
              <option value="">Auto</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Field>
          </div>
        )}
        {/* C3A: an optional follow-up task, created only when the outcome saves. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-10 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} disabled={locked} className="h-4 w-4 accent-primary" />
            Follow-up task
          </label>
          {followUp && (
            <>
              <Field
                value={followTitle}
                onChange={(e) => setFollowTitle(e.target.value)}
                maxLength={200}
                placeholder="e.g. Call back with pricing"
                aria-label="Follow-up task"
                className="min-w-[12rem] flex-1 text-sm"
                disabled={locked}
              />
              <Field
                type="datetime-local"
                value={followDue}
                onChange={(e) => setFollowDue(e.target.value)}
                aria-label="Follow-up due"
                className="font-mono text-sm"
                disabled={locked}
              />
            </>
          )}
        </div>
        </div>
        {/* D highlight: a 2px primary outline, no animation. */}
        <div ref={dispositionRef} className={highlight ? 'outline outline-2 outline-offset-4 outline-primary' : ''}>
          <DispositionButtons onSelect={handleSelect} disabled={locked} columns={compact ? 3 : 2} />
        </div>

        {retrying && <p className="font-mono text-sm uppercase text-foreground">{retrying}</p>}
        {error && (
          <p role="alert" className="text-sm text-signal">
            <span className="label mr-2 text-signal">Error</span>
            {error}
          </p>
        )}

        {!compact && (
          <CollapsibleSection title="Previous Notes">
            <PreviousNotes leadId={lead?.id} currentCallId={callId} />
          </CollapsibleSection>
        )}
      </section>

      {showScript && (
        <CollapsibleSection title="Pitch script">
          <p className="text-sm leading-relaxed text-foreground"><PitchScriptText repName={user?.name || 'the rep'} /></p>
        </CollapsibleSection>
      )}

      {showDncConfirm && (
        <Dialog title="Mark as DNC?" onClose={() => setShowDncConfirm(false)} className="max-w-sm">
          <p className="text-sm text-foreground">
            Permanently block {lead?.name}'s number from all future dialing? This cannot be undone.
          </p>
          <div className="mt-6 flex gap-4">
            <ActionButton
              variant="dnc"
              className="flex-1"
              onClick={() => {
                setShowDncConfirm(false);
                submitOutcome('dnc');
              }}
            >
              ⊘ Confirm DNC
            </ActionButton>
            <Button className="flex-1" onClick={() => setShowDncConfirm(false)}>
              Cancel
            </Button>
          </div>
        </Dialog>
      )}

    </div>
  );
}
