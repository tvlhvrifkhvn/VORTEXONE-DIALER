import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import { formatDateTime } from '../lib/format';
import { useImportJob, trackImportJob } from '../hooks/useImportJob';
import * as api from '../lib/api';

// State isn't strictly required here even though it's mandatory on every
// lead — the backend derives it from address text or phone area code (and,
// as a last resort, a validated AI guess) when no column is mapped to it.
const REQUIRED_FIELDS = ['name', 'phone'];
// The preview table shows the lead as it will be saved; the mapping list
// shows every column the importer understands.
const PREVIEW_FIELDS = ['name', 'phone', 'email', 'address', 'brokerage', 'state'];
const FIELD_LABELS = { first_name: 'first name', last_name: 'last name', zip: 'zip / postal', source: 'source / website' };

/** What the importer will use as the name: the name column, or first + last joined. */
function previewName(row, mapping) {
  if (mapping.name) return row[mapping.name];
  return [mapping.first_name, mapping.last_name]
    .map((h) => (h ? String(row[h] || '').trim() : ''))
    .filter(Boolean)
    .join(' ');
}
const CONFIDENCE_COLORS = { high: 'text-action-contacted', medium: 'text-action-warn', low: 'text-action-hangup' };

/** Last 10 imports, shown below the upload area. */
function ImportHistory({ refreshKey }) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api
      .getImportHistory()
      .then(({ history: rows }) => setHistory(rows))
      .catch(() => {});
  }, [refreshKey]);

  if (history.length === 0) return null;

  return (
    <NeuCard className="overflow-x-auto p-5">
      <h2 className="mb-3 text-sm font-semibold text-text-primary">Import history</h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wide text-text-secondary">
            <th className="px-2 py-2">Date</th>
            <th className="px-2 py-2">Filename</th>
            <th className="px-2 py-2">Imported</th>
            <th className="px-2 py-2">Skipped</th>
            <th className="px-2 py-2">Duplicates</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.id} className="border-t border-shadow/20">
              <td className="px-2 py-2 text-text-secondary">{formatDateTime(row.imported_at)}</td>
              <td className="px-2 py-2 text-text-primary">{row.filename || '—'}</td>
              <td className="px-2 py-2 text-text-primary">{row.imported}</td>
              <td className="px-2 py-2 text-text-primary">{row.skipped_dnc + row.skipped_invalid}</td>
              <td className="px-2 py-2 text-text-primary">{row.skipped_duplicate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </NeuCard>
  );
}

const BUCKETS = [
  ['imported', 'Imported (dialable)'],
  ['noNumber', 'Imported without a usable number'],
  ['merged', 'Merged within the file'],
  ['alreadyInList', 'Already in your list'],
  ['dncBlocked', 'DNC — blocked'],
  ['invalid', 'Invalid'],
];

/** The import result: every row of the file in exactly one bucket. */
function ImportSummary({ summary, onReset }) {
  const [downloadError, setDownloadError] = useState(null);
  const skippedCount = (summary.merged ?? 0) + (summary.alreadyInList ?? 0) + (summary.dncBlocked ?? 0) + (summary.invalid ?? 0);

  const download = async () => {
    setDownloadError(null);
    try {
      const blob = await api.downloadSkippedRows(summary.jobId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skipped-rows.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err.message);
    }
  };

  // Older jobs (before this summary existed) only have the legacy fields.
  if (summary.noNumber === undefined) {
    return (
      <NeuCard className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-text-primary">Import report</h2>
        <p className="text-sm text-text-secondary">
          {summary.imported} leads imported · {summary.mergedDuplicates ?? 0} duplicates merged · {summary.skippedDnc} skipped
          (DNC) · {summary.skippedDuplicate} duplicates removed · {summary.skippedInvalid} invalid
        </p>
        <NeuButton onClick={onReset}>Import another file</NeuButton>
      </NeuCard>
    );
  }

  return (
    <NeuCard className="space-y-3 p-5">
      <h2 className="text-sm font-semibold text-text-primary">Import report</h2>
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b border-shadow/20 font-semibold text-text-primary">
            <td className="py-1.5">Rows in the file</td>
            <td className="py-1.5 text-right tabular-nums">{summary.totalRows}</td>
          </tr>
          {BUCKETS.map(([key, label]) => (
            <tr key={key} className="text-text-primary">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right tabular-nums">{summary[key]}</td>
            </tr>
          ))}
          {summary.notProcessed > 0 && (
            <tr className="text-action-warn">
              <td className="py-1">Not processed (import cancelled)</td>
              <td className="py-1 text-right tabular-nums">{summary.notProcessed}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={`text-xs font-medium ${summary.allRowsAccountedFor ? 'text-action-contacted' : 'text-action-hangup'}`}>
        {summary.allRowsAccountedFor
          ? `All ${summary.totalRows} rows are accounted for.`
          : 'Some rows are not accounted for — please report this.'}
      </p>
      {summary.noNumber > 0 && (
        <p className="rounded-input bg-action-warn/10 px-3 py-2 text-xs font-medium text-action-warn">
          {summary.noNumber} leads were imported without a usable phone number (visible in the list, not dialable until a
          number is added).
          {summary.unreadable > 0 &&
            ` ${summary.unreadable} of them had a number that couldn't be read — the original text is shown on the lead.`}
        </p>
      )}
      {summary.smsOptedOut > 0 && (
        <p className="text-xs text-text-secondary" data-testid="import-sms-opted-out">
          SMS opted out: {summary.smsOptedOut} imported lead(s) replied STOP to a text earlier — they won't be texted, but
          they can still be called.
        </p>
      )}
      {summary.withExtension > 0 && (
        <p className="text-xs text-text-secondary">{summary.withExtension} numbers had an extension — it is kept and shown on the call screen.</p>
      )}
      {summary.invalidReasons?.length > 0 && (
        <div className="text-xs text-text-secondary">
          <p className="font-medium text-text-primary">Why rows were invalid</p>
          <ul className="mt-1 space-y-0.5">
            {summary.invalidReasons.map((r) => (
              <li key={r.reason}>
                {r.count} × {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.ambiguousSameName > 0 && (
        <p className="text-xs text-text-secondary">
          {summary.ambiguousSameName} rows had only a name that appears in several places in the file — they were not merged
          into any of them.
        </p>
      )}
      {summary.aiStoppedAfterFailures && (
        <p className="text-xs text-text-secondary">
          The AI cleaner stopped responding, so {summary.rowsNotAiCleaned} rows were imported with the built-in cleanup only.
        </p>
      )}
      {skippedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <NeuButton className="text-sm" onClick={download}>
            Download the {skippedCount} rows that weren't imported (CSV)
          </NeuButton>
          {downloadError && <span className="text-xs text-action-hangup">{downloadError}</span>}
        </div>
      )}
      <NeuButton onClick={onReset}>Import another file</NeuButton>
    </NeuCard>
  );
}

export default function Import() {
  const fileInputRef = useRef(null);
  // 1 = upload, 1.5 = pick sheets (multi-sheet files only), 2 = confirm
  // mapping + preview, 3 = cleaning report
  const [step, setStep] = useState(1);
  const [analysis, setAnalysis] = useState(null); // { jobId, headers, sampleRows, mapping, sheetNames, ... }
  const [mapping, setMapping] = useState({});
  const [filename, setFilename] = useState(null);
  const [selectedSheets, setSelectedSheets] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [cancelNote, setCancelNote] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const { job, isActive, cancelJob, clearJob } = useImportJob();

  // The job runs on the server, so its result arrives here whether or not the
  // page stayed open — including after navigating away and coming back.
  useEffect(() => {
    if (!job) return;
    if (job.status === 'completed' && job.resultSummary) {
      setSummary(job.resultSummary);
      setStep(3);
      setHistoryRefreshKey((k) => k + 1);
    } else if (job.status === 'failed') {
      setError(job.errorMessage || 'Import failed.');
      setStep(2);
    } else if (job.status === 'cancelled') {
      const written = job.resultSummary?.written ?? job.written ?? 0;
      setError(
        written > 0
          ? `Import cancelled. ${written} leads were already saved and stay in your list; the rest of the file was not imported.`
          : 'Import cancelled. No leads were saved from this file.'
      );
      setStep(2);
    }
  }, [job]);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const data = await api.uploadImportFile(file);
      setAnalysis(data);
      setMapping(data.mapping || {});
      setFilename(file.name);
      setSelectedSheets(data.sheetNames || []);
      // Only ask which sheets to use when there's actually a choice.
      setStep(data.sheetNames?.length > 1 ? 1.5 : 2);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const toggleSheet = (name) => {
    setSelectedSheets((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  };

  const handleMappingChange = (field, header) => {
    setMapping((m) => ({ ...m, [field]: header || undefined }));
  };

  const hasName = Boolean(mapping.name || mapping.first_name || mapping.last_name);
  const canContinue = hasName && Boolean(mapping.phone);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const { jobId } = analysis;
      await api.processImportJob(jobId, selectedSheets, mapping);
      trackImportJob(jobId);
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  const handleReset = () => {
    clearJob();
    setCancelNote(null);
    setStep(1);
    setAnalysis(null);
    setMapping({});
    setFilename(null);
    setSelectedSheets([]);
    setSummary(null);
    setError(null);
  };

  const selectedRowCount = selectedSheets.reduce((sum, name) => sum + (analysis?.sheetRowCounts?.[name] || 0), 0);

  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-4xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary">Import leads</h1>

        {error && <NeuCard className="p-4 text-sm text-action-hangup">{error}</NeuCard>}

        {isActive && job && (
          <NeuCard className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">
                Importing {job.filename || filename || 'leads'}…
              </h2>
              <span className="text-sm font-semibold text-text-primary">{job.percentage}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-shadow/20 shadow-neu-inset">
              <div
                className="h-full rounded-full bg-action-call transition-all duration-300"
                style={{ width: `${job.percentage}%` }}
              />
            </div>
            <p className="text-xs text-text-secondary">
              {job.phaseLabel || `${job.processedRows} of ${job.totalRows} rows processed`}
              {job.failedRows > 0 ? ` · ${job.failedRows} need manual review` : ''}
            </p>
            <p className="text-xs text-text-secondary">
              This runs on the server — you can leave this page and it keeps going.
            </p>
            <NeuButton
              onClick={async () => {
                const result = await cancelJob();
                if (result?.message) setCancelNote(result.message);
              }}
            >
              Cancel import
            </NeuButton>
            {cancelNote && <p className="text-xs text-text-secondary">{cancelNote}</p>}
          </NeuCard>
        )}

        {step === 1 && !isActive && (
          <NeuCard className="p-6 text-center">
            <p className="text-sm text-text-secondary">
              Upload a CSV or Excel file with lead name, phone, and state at minimum.
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              Columns are matched automatically (with AI when it's available) and you can correct them before
              importing. Any number of rows; very large files (over the upload size limit) need to be split.
            </p>
            <NeuButton className="mt-4" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Reading file…' : 'Choose CSV or Excel file'}
            </NeuButton>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
          </NeuCard>
        )}

        {step === 1.5 && analysis && !isActive && (
          <NeuCard className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-text-primary">
              This file has {analysis.sheetNames.length} sheets — which should we import?
            </h2>
            <div className="space-y-2">
              {analysis.sheetNames.map((name) => (
                <label key={name} className="flex cursor-pointer items-center gap-3 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={selectedSheets.includes(name)}
                    onChange={() => toggleSheet(name)}
                    className="h-4 w-4 cursor-pointer accent-action-call"
                  />
                  <span>{name}</span>
                  <span className="text-xs text-text-secondary">
                    {analysis.sheetRowCounts?.[name] ?? 0} rows
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-text-secondary">{selectedRowCount} rows selected</p>
            <div className="flex gap-3">
              <ActionButton variant="call" onClick={() => setStep(2)} disabled={selectedSheets.length === 0}>
                Continue
              </ActionButton>
              <NeuButton onClick={handleReset}>Start over</NeuButton>
            </div>
          </NeuCard>
        )}

        {step === 2 && analysis && (
          <>
            <NeuCard className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-text-primary">We detected these columns</h2>
              {analysis.unavailable ? (
                <p className="mb-3 rounded-input bg-action-warn/10 px-3 py-2 text-xs font-medium text-action-warn">
                  AI mapping is off or unavailable — columns were matched by their names. Check them below
                  and change any that are wrong.
                </p>
              ) : (
                <p className="mb-3 text-xs text-text-secondary">
                  Review the AI's suggested mapping below — fields marked in red or amber may need a manual fix.
                </p>
              )}
              <div className="space-y-2">
                {analysis.fields.map((field) => {
                  const confidence = analysis.confidence?.[field] || 'low';
                  const flagged = analysis.needsReview?.includes(field);
                  return (
                    <div key={field} className="grid grid-cols-[100px_1fr_80px] items-center gap-3">
                      <label className="text-xs font-medium capitalize text-text-secondary">
                        {FIELD_LABELS[field] || field}
                        {REQUIRED_FIELDS.includes(field) && ' *'}
                      </label>
                      <NeuInput
                        as="select"
                        value={mapping[field] || ''}
                        onChange={(e) => handleMappingChange(field, e.target.value)}
                        className="w-full text-sm"
                      >
                        <option value="">— none —</option>
                        {analysis.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </NeuInput>
                      <span className={`text-xs font-medium ${CONFIDENCE_COLORS[confidence] || CONFIDENCE_COLORS.low}`}>
                        {flagged ? 'Needs review' : confidence}
                      </span>
                    </div>
                  );
                })}
              </div>
            </NeuCard>

            <NeuCard className="overflow-x-auto p-5">
              <h2 className="mb-3 text-sm font-semibold text-text-primary">
                Preview — first 5 leads as they'll be imported
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-text-secondary">
                    {PREVIEW_FIELDS.map((f) => (
                      <th key={f} className="px-2 py-2">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(analysis.sampleRows || []).slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-shadow/20">
                      {PREVIEW_FIELDS.map((f) => {
                        const original = f === 'name' ? analysis.originalNames?.[i] : null;
                        const value = f === 'name' ? previewName(row, mapping) : mapping[f] ? row[mapping[f]] : '';
                        return (
                          <td key={f} className="px-2 py-2 text-text-primary">
                            {value || '—'}
                            {original && (
                              <span
                                title={`Cleaned by AI from: ${original}`}
                                aria-label={`Cleaned by AI from: ${original}`}
                                className="ml-1 cursor-help"
                              >
                                ✨
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </NeuCard>

            <div className="flex items-center gap-3">
              <ActionButton variant="call" onClick={handleCommit} disabled={!canContinue || committing}>
                {committing
                  ? 'Starting…'
                  : `Confirm & import ${selectedRowCount || analysis.totalRows} leads`}
              </ActionButton>
              <NeuButton onClick={handleReset}>Start over</NeuButton>
              {!canContinue && (
                <span className="text-xs text-text-secondary">
                  Map phone and a name (or first/last name) to continue.
                </span>
              )}
            </div>
          </>
        )}

        {step === 3 && summary && <ImportSummary summary={summary} onReset={handleReset} />}

        <ImportHistory refreshKey={historyRefreshKey} />
      </div>
    </AppShell>
  );
}
