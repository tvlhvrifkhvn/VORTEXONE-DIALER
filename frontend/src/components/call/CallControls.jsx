import { useState } from 'react';
import ActionButton from '../ui/ActionButton';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';

export default function CallControls({ onHangup, onScheduleCallback, disabled, hangupDisabled }) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [when, setWhen] = useState('');

  const submit = () => {
    if (!when) return;
    onScheduleCallback(new Date(when).toISOString());
    setShowSchedule(false);
    setWhen('');
  };

  return (
    <div className="flex flex-col gap-3">
      <ActionButton variant="hangup" disabled={hangupDisabled ?? disabled} onClick={onHangup} className="w-full">
        Hang Up
      </ActionButton>

      {!showSchedule ? (
        <NeuButton onClick={() => setShowSchedule(true)} disabled={disabled} className="w-full text-sm">
          Schedule callback
        </NeuButton>
      ) : (
        <div className="flex items-center gap-2">
          <NeuInput
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="flex-1 text-sm"
          />
          <NeuButton onClick={submit} className="text-sm">
            Set
          </NeuButton>
          <NeuButton onClick={() => setShowSchedule(false)} className="text-sm">
            Cancel
          </NeuButton>
        </div>
      )}
    </div>
  );
}
