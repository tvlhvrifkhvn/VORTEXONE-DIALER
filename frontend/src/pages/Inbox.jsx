import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
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
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [confirmingOptOut, setConfirmingOptOut] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .getSmsInbox(page, 20)
      .then(({ leads }) => setRows(leads))
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
      <div className="mx-auto mt-4 max-w-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-text-primary">Inbox</h1>
          <Link to="/sms/templates" className="text-sm font-medium text-action-call hover:underline">
            Manage templates
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-text-secondary">Loading…</p>
        ) : rows.length === 0 ? (
          <NeuCard className="p-8 text-center text-sm text-text-secondary">No new messages</NeuCard>
        ) : (
          rows.map((row) => (
            <NeuCard key={row.leadId} className="flex items-center gap-3 p-4">
              <button
                type="button"
                onClick={() => handleOpenRow(row)}
                className="flex flex-1 items-center gap-3 text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-action-call font-semibold text-white">
                  {initialsOf(row.leadName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{row.leadName}</span>
                    {row.unreadCount > 1 && (
                      <span className="rounded-full bg-action-hangup px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {row.unreadCount}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-text-secondary">
                    {row.brokerage ? `${row.brokerage} · ` : ''}
                    {(row.lastMessageBody || '').slice(0, 80)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-text-secondary">{formatRelativeToNow(row.lastMessageAt)}</span>
              </button>
              <div className="flex shrink-0 gap-2">
                <NeuButton className="text-xs" onClick={() => handleMarkInterested(row.leadId)}>
                  Mark interested
                </NeuButton>
                {confirmingOptOut === row.leadId ? (
                  <NeuButton
                    className="text-xs !bg-action-warn/20 text-action-warn"
                    onClick={() => handleOptOut(row.leadId)}
                  >
                    Confirm?
                  </NeuButton>
                ) : (
                  <NeuButton
                    className="text-xs !bg-action-warn/10 text-action-warn"
                    title="Stop texting this lead? They can still be called."
                    onClick={() => setConfirmingOptOut(row.leadId)}
                  >
                    Mark opted out
                  </NeuButton>
                )}
              </div>
            </NeuCard>
          ))
        )}

        <div className="flex justify-center gap-3 pt-2">
          <NeuButton disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </NeuButton>
          <NeuButton disabled={rows.length < 20} onClick={() => setPage((p) => p + 1)}>
            Next
          </NeuButton>
        </div>
      </div>

    </AppShell>
  );
}
