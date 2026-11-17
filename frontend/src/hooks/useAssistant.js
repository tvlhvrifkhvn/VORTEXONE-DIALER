import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api';

// The assistant conversation (C5B). Kept in sessionStorage: this tab only,
// gone when the tab closes; CLEAR empties it. The server keeps nothing: the
// last 6 turns go with each question (C5A).
const STORAGE_KEY = 'vortex.assistant';
const HISTORY_TURNS = 10; // C7F (was 6)

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && Array.isArray(saved.messages)) return { messages: saved.messages, scope: saved.scope === 'all' ? 'all' : 'file', web: saved.web === true };
  } catch {
    /* storage unavailable or damaged: start empty */
  }
  return { messages: [], scope: 'file', web: false };
}

/** What went wrong, for the panel: not configured, rate limited, or another error. */
function problemFrom(err) {
  if (err.status === 503 && err.code === 'assistant_not_configured') return { kind: 'not_configured', message: err.message };
  if (err.status === 429) {
    return { kind: 'rate', message: `Too many questions this minute. Try again${err.retryAfter ? ` in ${err.retryAfter} s` : ' shortly'}.` };
  }
  return { kind: 'error', message: err.message || 'The assistant could not answer.' };
}

export function useAssistant() {
  const [state, setState] = useState(load);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable: the conversation lasts until the page reloads */
    }
  }, [state]);

  const setScope = useCallback((scope) => setState((s) => ({ ...s, scope })), []);
  // C7F: WEB on sends only the question to a Groq model with web search (no CRM data, no history).
  const setWeb = useCallback((web) => setState((s) => ({ ...s, web: Boolean(web) })), []);

  const clear = useCallback(() => {
    setState((s) => ({ ...s, messages: [] }));
    setProblem(null);
  }, []);

  const ask = useCallback(
    async (raw) => {
      const question = String(raw || '').trim();
      if (!question || loading) return;
      const history = state.messages.slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
      const scope = state.scope;
      const viaWeb = state.web;
      setState((s) => ({ ...s, messages: [...s.messages, { role: 'user', content: question, scope, web: viaWeb }] }));
      setLoading(true);
      setProblem(null);
      try {
        const campaign = scope === 'all' ? 'ALL' : undefined;
        const res = viaWeb ? await api.askWeb(question, campaign) : await api.askAssistant(question, history, campaign);
        setState((s) => ({
          ...s,
          messages: [
            ...s.messages,
            { role: 'assistant', content: res.answer, leadRefs: res.leadRefs || [], toolsUsed: res.toolsUsed || [], proposals: res.proposals || [], web: Boolean(res.web) },
          ],
        }));
      } catch (err) {
        setProblem(problemFrom(err));
      } finally {
        setLoading(false);
      }
    },
    [loading, state.messages, state.scope, state.web]
  );

  // C5C: a proposal card's outcome (confirmed | dismissed), kept with the conversation.
  const resolveProposal = useCallback((messageIndex, proposalIndex, status) => {
    setState((s) => ({
      ...s,
      messages: s.messages.map((m, i) =>
        i !== messageIndex ? m : { ...m, proposals: (m.proposals || []).map((p, j) => (j === proposalIndex ? { ...p, status } : p)) }
      ),
    }));
  }, []);

  return { messages: state.messages, scope: state.scope, setScope, web: state.web, setWeb, ask, clear, loading, problem, resolveProposal };
}
