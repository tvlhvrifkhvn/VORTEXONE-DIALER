import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import ContactCard from '../components/call/ContactCard';
import CallHeader from '../components/call/CallHeader';
import NotesField from '../components/call/NotesField';
import DispositionButtons from '../components/call/DispositionButtons';
import CallControls from '../components/call/CallControls';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import { useCall } from '../hooks/useCall';

const DISPOSITION_LABELS = {
  contacted: 'Spoke / Interested',
  voicemail: 'Voicemail',
  no_answer: 'No Answer',
  no_contact_number: 'No Contact — Number',
  no_contact_person: 'No Contact — Person',
  dnc: 'DNC',
  callback_scheduled: 'Callback Scheduled',
};

function CallScreenInner({ leadId }) {
  const navigate = useNavigate();
  const { call, lead, error, starting, undoInfo, hangup, submitDisposition, undo } = useCall(leadId);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [lastDisposition, setLastDisposition] = useState(null);
  const [hungUp, setHungUp] = useState(false);

  const isFinalized = !!lastDisposition;
  const ended = isFinalized || call?.telephony_state === 'ended';

  const handleSelect = async (disposition) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await submitDisposition({ disposition, note });
      setLastDisposition(disposition);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleScheduleCallback = async (scheduledAt) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await submitDisposition({ disposition: 'callback_scheduled', note, scheduledAt });
      setLastDisposition('callback_scheduled');
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleHangup = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      await hangup();
      setHungUp(true);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUndo = async () => {
    try {
      await undo();
      setLastDisposition(null);
      setHungUp(false);
    } catch (err) {
      setActionError(err.message);
    }
  };

  if (error) {
    return (
      <NeuCard className="mx-auto mt-12 max-w-md p-6 text-center">
        <p className="font-medium text-text-primary">Couldn't start this call</p>
        <p className="mt-2 text-sm text-text-secondary">{error}</p>
        <NeuButton className="mt-4" onClick={() => navigate('/')}>
          Back to Dashboard
        </NeuButton>
      </NeuCard>
    );
  }

  if (starting || !lead) {
    return <p className="mt-12 text-center text-text-secondary">Connecting…</p>;
  }

  return (
    <div className="mx-auto mt-6 grid max-w-3xl grid-cols-1 gap-6 md:grid-cols-[1fr_260px]">
      <div className="space-y-6">
        <NeuCard className="p-5">
          <CallHeader call={call} ended={ended} />
        </NeuCard>

        <ContactCard lead={lead} />

        <NeuCard className="space-y-4 p-5">
          <NotesField value={note} onChange={setNote} />
          <DispositionButtons onSelect={handleSelect} disabled={submitting || isFinalized} />
          {actionError && <p className="text-sm text-action-hangup">{actionError}</p>}
        </NeuCard>
      </div>

      <div className="space-y-4">
        <CallControls
          onHangup={handleHangup}
          onScheduleCallback={handleScheduleCallback}
          disabled={submitting || isFinalized}
          hangupDisabled={submitting || isFinalized || hungUp}
        />

        {hungUp && !isFinalized && (
          <NeuCard className="p-4 text-sm text-text-secondary">
            Call ended without a disposition — this lead returns to the queue in 30s unless you log an
            outcome now.
          </NeuCard>
        )}

        {isFinalized && (
          <NeuCard className="space-y-3 p-4">
            <p className="text-sm text-text-primary">
              Logged as <strong>{DISPOSITION_LABELS[lastDisposition] || lastDisposition}</strong>.
            </p>
            {undoInfo && (
              <NeuButton className="w-full text-sm" onClick={handleUndo}>
                Undo
              </NeuButton>
            )}
            <NeuButton className="w-full text-sm" onClick={() => navigate('/call/next')}>
              Next Lead
            </NeuButton>
            <NeuButton className="w-full text-sm" onClick={() => navigate('/')}>
              Back to Dashboard
            </NeuButton>
          </NeuCard>
        )}
      </div>
    </div>
  );
}

export default function CallScreen() {
  const { leadId: leadIdParam } = useParams();
  const location = useLocation();
  const leadId = leadIdParam === 'next' ? undefined : leadIdParam;

  return (
    <AppShell>
      {/* location.key forces a remount for repeated "Next Lead" visits to /call/next */}
      <CallScreenInner key={location.key} leadId={leadId} />
    </AppShell>
  );
}
