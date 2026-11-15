import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';

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
        <Button onClick={() => setShowSchedule(true)} disabled={disabled} className="w-full">
          Schedule callback
        </Button>
      ) : (
        <div className="space-y-2">
          <label htmlFor="callback-when" className="label block">
            Callback time
          </label>
          <Field
            id="callback-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="w-full font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={submit} className="flex-1">
              Set
            </Button>
            <Button onClick={() => setShowSchedule(false)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
