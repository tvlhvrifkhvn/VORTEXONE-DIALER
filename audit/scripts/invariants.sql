-- Lifecycle invariants. Run with: psql -h localhost -U vortex -d vortex_dialer -f audit/scripts/invariants.sql
\echo '-- I1 every lead has exactly one status from the allowed list (violations):'
SELECT status, count(*) FROM leads
WHERE status NOT IN ('new','in_queue','in_progress','contacted','voicemail','no_answer','callback_scheduled','no_contact_number','no_contact_person','dnc','cold')
   OR status IS NULL
GROUP BY status;

\echo '-- I2 leads in_progress, and whether each has an open (undispositioned) call:'
SELECT l.id, l.locked_by, round(extract(epoch from now() - l.locked_at)) AS lock_age_s,
       (SELECT count(*) FROM call_history c WHERE c.lead_id = l.id AND c.disposition IS NULL) AS open_calls
FROM leads l WHERE l.status = 'in_progress' ORDER BY l.id;

\echo '-- I3 in_progress with lock older than 30s (should be swept on next queue read):'
SELECT count(*) AS stale_locks FROM leads WHERE status = 'in_progress' AND locked_at < now() - interval '30 seconds';

\echo '-- I4 orphan call rows (lead_id not in leads; manual calls have NULL lead_id by design):'
SELECT count(*) AS orphan_calls FROM call_history c WHERE c.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = c.lead_id);

\echo '-- I5 calls never dispositioned and never ended, older than 5 minutes:'
SELECT count(*) AS dangling_calls FROM call_history WHERE disposition IS NULL AND ended_at IS NULL AND started_at < now() - interval '5 minutes';

\echo '-- I6 leads with more open (undispositioned) calls than one:'
SELECT lead_id, count(*) AS open_calls FROM call_history WHERE lead_id IS NOT NULL AND disposition IS NULL GROUP BY lead_id HAVING count(*) > 1 ORDER BY 2 DESC LIMIT 10;

\echo '-- I7 attempts above max_attempts:'
SELECT id, attempts, max_attempts, status FROM leads WHERE attempts > max_attempts ORDER BY attempts DESC LIMIT 10;

\echo '-- I8 dnc consistency: dnc_flag vs status vs dnc_list'
SELECT 'flag without status' AS kind, count(*) FROM leads WHERE dnc_flag AND status <> 'dnc'
UNION ALL SELECT 'status without flag', count(*) FROM leads WHERE status = 'dnc' AND NOT dnc_flag
UNION ALL SELECT 'lead whose phone is on dnc_list but not flagged', count(*) FROM leads l WHERE NOT l.dnc_flag AND EXISTS (SELECT 1 FROM dnc_list d WHERE d.phone = l.phone)
UNION ALL SELECT 'phones not in E.164 (+1 and 10 digits)', count(*) FROM leads WHERE phone IS NOT NULL AND phone !~ '^\+1[2-9][0-9]{9}$';

\echo '-- I9 lead counts:'
SELECT count(*) AS total, count(*) FILTER (WHERE deleted_at IS NOT NULL) AS soft_deleted FROM leads;
