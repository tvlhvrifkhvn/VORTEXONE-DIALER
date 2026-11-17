// "DRAFT WITH AI" (C5C), above the SMS and email composers: an optional
// intent, then the draft goes into the composer's own fields. Nothing is
// sent: the owner edits it and uses the composer's existing SEND.
import { useState } from 'react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import { NotConfiguredText } from './AssistantPanel';
import * as api from '../../lib/api';

export default function DraftWithAi({ leadId, channel, onDraft }) {
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);

  const run = async () => {
    setLoading(true);
    setProblem(null);
    try {
      onDraft(await api.draftMessage(leadId, channel, intent.trim() || undefined));
    } catch (err) {
      setProblem({ notConfigured: err.status === 503 && err.code === 'assistant_not_configured', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const id = `draft-intent-${channel}`;
  return (
    <div className="space-y-2" data-testid={`draft-${channel}`}>
      <label htmlFor={id} className="label block">
        Draft with AI · optional: what it's about
      </label>
      <div className="flex flex-wrap gap-2">
        <Field
          id={id}
          value={intent}
          maxLength={300}
          onChange={(e) => setIntent(e.target.value)}
          placeholder={channel === 'sms' ? 'e.g. follow up on pricing' : 'e.g. send the trial offer'}
          className="min-w-0 flex-1 text-sm"
        />
        <Button onClick={run} disabled={loading}>
          {loading ? 'Drafting…' : 'Draft with AI'}
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-foreground">
          {problem.notConfigured ? <NotConfiguredText message={problem.message} /> : problem.message}
        </p>
      )}
    </div>
  );
}
