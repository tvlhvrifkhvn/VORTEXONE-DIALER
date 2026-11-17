// The ASK drawer (C5B, docs/CRM_PLAN.md): a panel fixed to the right edge,
// over the page (nothing underneath moves, the call screen included). No new
// hotkeys: the question box is a textarea, which the call screen's keys skip.
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../ui/Button';
import Segmented from '../ui/Segmented';
import Field from '../ui/Field';
import SectionLabel from '../ui/SectionLabel';
import { useAssistant } from '../../hooks/useAssistant';
import ProposalCard from './ProposalCard';

export const SUGGESTIONS = [
  'Who should I call first today?',
  'Which interested leads have no task?',
  'Summarize yesterday',
  'Leads with no activity in 7 days',
  "What's overdue?",
  "How is this month's spend?",
];

/** The answer text with each [lead:ID] as a link to the lead page. */
export function AnswerText({ text, leadRefs = [] }) {
  const names = new Map(leadRefs.map((r) => [r.id, r.name]));
  const parts = String(text || '').split(/(\[lead:\d+\])/g);
  return (
    <p className="whitespace-pre-wrap text-sm text-foreground">
      {parts.map((part, i) => {
        const m = part.match(/^\[lead:(\d+)\]$/);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const id = Number(m[1]);
        return (
          <Link key={i} to={`/leads/${id}`} className="font-medium underline underline-offset-4 hover:bg-muted">
            {names.get(id) || `Lead ${id}`}
          </Link>
        );
      })}
    </p>
  );
}

/** The server's reason, with "Settings → Integrations" as a link (added at the end if the reason doesn't name it). */
export function NotConfiguredText({ message }) {
  const LINK = 'Settings → Integrations';
  const text = String(message || "The assistant isn't set up").replace(/\s*\((Settings → Integrations)\)/, ' in $1');
  const [before, after = ''] = text.includes(LINK) ? text.split(LINK) : [`${text.replace(/\.$/, '')}. Set it up in `, '.'];
  return (
    <>
      {before}
      <Link to="/settings#integrations" className="underline underline-offset-4">
        {LINK}
      </Link>
      {after}
    </>
  );
}

function Problem({ problem }) {
  if (problem.kind === 'not_configured') {
    return (
      <p role="alert" className="border-l-[3px] border-strong bg-muted px-4 py-2 text-sm text-foreground" data-testid="assistant-not-configured">
        <NotConfiguredText message={problem.message} />
      </p>
    );
  }
  return (
    <p role="alert" className="border-l-[3px] border-l-primary bg-muted px-4 py-2 text-sm text-foreground">
      {problem.message}
    </p>
  );
}

export default function AssistantPanel({ onClose }) {
  const { messages, scope, setScope, ask, clear, loading, problem, resolveProposal } = useAssistant();
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, loading, problem]);

  const submit = (e) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    setDraft('');
    ask(q);
  };

  return (
    <aside
      aria-label="Assistant"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-strong bg-card"
      data-testid="assistant-panel"
    >
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2">
        <h2 className="font-mono text-sm font-medium uppercase tracking-button text-foreground">Ask</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={clear} disabled={messages.length === 0 && !problem}>
            Clear
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close ×
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-b px-4 py-3">
        <Segmented
          label="Which files"
          options={[
            { value: 'file', label: 'This file' },
            { value: 'all', label: 'All files' },
          ]}
          value={scope}
          onChange={setScope}
        />
        <p className="text-xs text-muted-foreground">Answers come from your CRM data via Groq. Check before acting.</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-2">
            <SectionLabel index="01" title="Try asking" />
            <ul className="space-y-1">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => ask(s)}
                    disabled={loading}
                    className="min-h-10 w-full border px-3 py-2 text-left text-sm text-foreground transition-colors duration-150 hover:bg-muted"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-8 border bg-muted px-3 py-2">
              <p className="label mb-1">You{m.scope === 'all' ? ' · all files' : ''}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{m.content}</p>
            </div>
          ) : (
            <div key={i} className="mr-8 border border-strong px-3 py-2" data-testid="assistant-answer">
              <p className="label mb-1">Assistant</p>
              <AnswerText text={m.content} leadRefs={m.leadRefs} />
              {m.proposals?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {m.proposals.map((p, j) => (
                    <ProposalCard key={j} proposal={p} onResolved={(status) => resolveProposal(i, j, status)} />
                  ))}
                </div>
              )}
              {m.toolsUsed?.filter((t) => !t.startsWith('propose_')).length > 0 && (
                <p className="mt-2 font-mono text-xs uppercase text-muted-foreground">
                  Looked at: {m.toolsUsed.filter((t) => !t.startsWith('propose_')).join(', ').replace(/_/g, ' ')}
                </p>
              )}
            </div>
          )
        )}

        {loading && (
          <p className="font-mono text-xs uppercase tracking-label text-muted-foreground" role="status">
            Looking through your data…
          </p>
        )}
        {problem && <Problem problem={problem} />}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="space-y-2 border-t px-4 py-3">
        <label htmlFor="assistant-question" className="label block">
          Your question
        </label>
        <Field
          as="textarea"
          id="assistant-question"
          ref={inputRef}
          rows={2}
          maxLength={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
          placeholder="Ask about your leads, tasks, pipeline or spend"
          className="w-full resize-none text-sm"
        />
        <Button type="submit" variant="primary" disabled={loading || !draft.trim()} className="w-full">
          {loading ? 'Asking…' : 'Ask'}
        </Button>
      </form>
    </aside>
  );
}
