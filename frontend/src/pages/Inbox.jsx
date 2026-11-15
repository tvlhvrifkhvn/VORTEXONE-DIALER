import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import Badge from '../components/ui/Badge';
import SectionLabel from '../components/ui/SectionLabel';
import { formatRelativeToNow } from '../lib/format';
import * as api from '../lib/api';

function initialsOf(name) {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || '—').toUpperCase();
}

export default function Inbox() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  // Texts from numbers that match no lead (F-37): kept and shown, not dropped.
  const [unmatched, setUnmatched] = useState([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [confirmingOptOut, setConfirmingOptOut] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .getSmsInbox(page, 20)
      .then(({ leads, unmatched: fromUnknown }) => {
        setRows(leads);
        setUnmatched(fromUnknown || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [page]);

  const handleMarkInterested = async (leadId) => {
    await api.markSmsRead(leadId);
    load();
  };

  const handleOptOut = async (leadId) => {
    await api.optOutSms(leadId);
    setConfirmingOptOut(null);
    load();
  };

  // Opening the lead's page marks its messages read on mount too
  // (LeadActionHub does it), but this keeps the inbox badge accurate the
  // instant the row is clicked rather than one navigation later.
  const handleOpenRow = async (row) => {
    await api.markSmsRead(row.leadId).catch(() => {});
    navigate(`/leads/${row.leadId}`);
  };

  return (
    <AppShell>
      <div className="mx-auto mt-6 max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Inbox</h1>
          <Link
            to="/sms/templates"
            className="font-mono text-sm font-medium uppercase tracking-button text-foreground underline underline-offset-4 hover:bg-muted"
          >
            Manage templates →
          </Link>
        </div>

        {loading ? (
          <p className="label">Loading…</p>
        ) : rows.length === 0 ? (
          <NeuCard className="space-y-2 p-6">
            <p className="label">Inbox empty</p>
            <p className="text-base text-foreground">No new messages.</p>
          </NeuCard>
        ) : (
          <NeuCard className="p-0">
            {rows.map((row) => (
              <div key={row.leadId} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
                <button
                  type="button"
                  onClick={() => handleOpenRow(row)}
                  className="-mx-2 flex min-w-0 flex-1 items-center gap-4 px-2 py-1 text-left transition-colors duration-150 hover:bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center border border-strong font-mono text-xs font-medium text-foreground"
                  >
                    {initialsOf(row.leadName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{row.leadName}</span>
                      {row.unreadCount > 1 && (
                        <Badge tone="solid" className="tabular-nums">
                          {row.unreadCount}
                          <span className="sr-only"> unread</span>
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {row.brokerage ? `${row.brokerage} · ` : ''}
                      {(row.lastMessageBody || '').slice(0, 80)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {formatRelativeToNow(row.lastMessageAt)}
                  </span>
                </button>
                <div className="flex shrink-0 gap-2">
                  <NeuButton onClick={() => handleMarkInterested(row.leadId)}>Mark interested</NeuButton>
                  {confirmingOptOut === row.leadId ? (
                    <NeuButton active onClick={() => handleOptOut(row.leadId)}>
                      ⊘ Confirm opt-out?
                    </NeuButton>
                  ) : (
                    <NeuButton
                      title="Stop texting this lead? They can still be called."
                      onClick={() => setConfirmingOptOut(row.leadId)}
                    >
                      ⊘ Mark opted out
                    </NeuButton>
                  )}
                </div>
              </div>
            ))}
          </NeuCard>
        )}

        <div className="flex justify-end gap-2">
          <NeuButton disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </NeuButton>
          <NeuButton disabled={rows.length < 20} onClick={() => setPage((p) => p + 1)}>
            Next
          </NeuButton>
        </div>
        {!loading && unmatched.length > 0 && (
          <NeuCard className="space-y-2 p-4" data-testid="unmatched-inbound">
            <SectionLabel title="From unknown numbers" />
            <ul className="divide-y">
              {unmatched.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-4 py-2 text-sm">
                  {!m.isRead && <Badge tone="solid">New</Badge>}
                  <span className={`font-mono tabular-nums ${m.isRead ? 'text-muted-foreground' : 'font-medium text-foreground'}`}>{m.fromNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{m.body}</span>
                  {m.keywordAction && (
                    <Badge tone="muted">{m.keywordAction === 'opt_out' ? 'Opt-out keyword' : 'Opt-in keyword'}</Badge>
                  )}
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatRelativeToNow(m.receivedAt)}</span>
                  {!m.isRead && (
                    <NeuButton
                      onClick={() => api.markUnmatchedSmsRead(m.id).then(load).catch(() => {})}
                    >
                      Mark read
                    </NeuButton>
                  )}
                </li>
              ))}
            </ul>
          </NeuCard>
        )}
      </div>

    </AppShell>
  );
}
