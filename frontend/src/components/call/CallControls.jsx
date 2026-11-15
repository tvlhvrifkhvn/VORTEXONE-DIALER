import { useState } from 'react';
import NeuButton from '../ui/NeuButton';
import NeuInput from '../ui/NeuInput';

// Hanging up moved to the call page's own prominent "End call" button, below
// the action grid — two hangup controls on one screen invited misclicks.
export default function CallControls({ onScheduleCallback, disabled }) {
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
      {!showSchedule ? (
        <NeuButton onClick={() => setShowSchedule(true)} disabled={disabled} className="w-full">
          Schedule callback
        </NeuButton>
      ) : (
        <div className="space-y-2">
          <label htmlFor="callback-when" className="label block">
            Callback time
          </label>
          <NeuInput
            id="callback-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full font-mono text-sm"
          />
          <div className="flex gap-2">
            <NeuButton variant="primary" onClick={submit} className="flex-1">
              Set
            </NeuButton>
            <NeuButton onClick={() => setShowSchedule(false)} className="flex-1">
              Cancel
            </NeuButton>
          </div>
        </div>
      )}
    </div>
  );
}
