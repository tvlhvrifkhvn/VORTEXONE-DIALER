// The lead page's AI SUMMARY (C5B): nothing runs until GENERATE; REFRESH
// asks again past the server's 10-minute cache. Shows the summary, the next
// step, any objections and when it was made.
import { useState } from 'react';
import Panel from '../ui/Panel';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import SectionLabel from '../ui/SectionLabel';
import { formatDateTime } from '../../lib/format';
import * as api from '../../lib/api';
import { NotConfiguredText } from './AssistantPanel';

export default function LeadSummaryPanel({ leadId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);

  const run = async (refresh) => {
    setLoading(true);
    setProblem(null);
    try {
      setSummary(await api.getLeadSummary(leadId, { refresh }));
    } catch (err) {
      setProblem({
        notConfigured: err.status === 503 && err.code === 'assistant_not_configured',
        message: err.status === 429 ? 'Too many assistant requests this minute. Try again shortly.' : err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel className="space-y-4 p-6" data-testid="lead-summary">
      <SectionLabel title="AI summary" meta={summary ? `Generated ${formatDateTime(summary.generatedAt)}` : null} />
      {summary ? (
        <div className="space-y-3">
          <p className="text-sm text-foreground">{summary.summary}</p>
          {summary.nextStep && (
            <div>
              <p className="label mb-1">Next step</p>
              <p className="text-sm text-foreground">{summary.nextStep}</p>
            </div>
          )}
          <div>
            <p className="label mb-1">Objections</p>
            {summary.objections?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {summary.objections.map((o) => (
                  <Badge key={o} tone="muted">
                    {o}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None raised</p>
            )}
          </div>
        </div>
      ) : (
        !problem && <p className="text-sm text-muted-foreground">A short summary of this lead from its history, tasks and fields.</p>
      )}

      {problem &&
        (problem.notConfigured ? (
          <p role="alert" className="border-l-[3px] border-strong bg-muted px-4 py-2 text-sm text-foreground">
            <NotConfiguredText message={problem.message} />
          </p>
        ) : (
          <p role="alert" className="border-l-[3px] border-l-primary bg-muted px-4 py-2 text-sm text-foreground">
            {problem.message}
          </p>
        ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => run(Boolean(summary))} disabled={loading}>
          {loading ? 'Working…' : summary ? 'Refresh' : 'Generate'}
        </Button>
        <p className="text-xs text-muted-foreground">Made by Groq from your CRM data. Check before acting.</p>
      </div>
    </Panel>
  );
}
