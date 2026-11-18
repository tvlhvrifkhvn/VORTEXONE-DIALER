// The lead page's best-time hint (C6C): one line, the best local hour from
// this lead's calls, or its state's, over the last 90 days.
import { useEffect, useState } from 'react';
import * as api from '../../lib/api';

export default function BestTimeHint({ leadId }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getBestTime(leadId)
      .then((r) => !cancelled && setText(r.text))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leadId]);
  if (!text) return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="best-time">
      <span className="label mr-2">Best time</span>
      {text}
    </p>
  );
}
