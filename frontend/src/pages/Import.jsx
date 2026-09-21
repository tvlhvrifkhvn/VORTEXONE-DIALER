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
      setError('Import cancelled.');
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

  const canContinue = REQUIRED_FIELDS.every((f) => mapping[f]);

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
              {job.processedRows} of {job.totalRows} rows processed
              {job.failedRows > 0 ? ` · ${job.failedRows} need manual review` : ''}
            </p>
            <p className="text-xs text-text-secondary">
              This runs on the server — you can leave this page and it keeps going.
            </p>
            <NeuButton onClick={cancelJob}>Cancel import</NeuButton>
          </NeuCard>
        )}

        {step === 1 && !isActive && (
          <NeuCard className="p-6 text-center">
            <p className="text-sm text-text-secondary">
              Upload a CSV or Excel file with lead name, phone, and state at minimum.
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              We'll use AI to detect which columns map to each field. Files over 5,000 leads should be split up
              for now.
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
                  AI mapping is not configured — please map columns manually.
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
                        {field}
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
                    {analysis.fields.map((f) => (
                      <th key={f} className="px-2 py-2">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(analysis.sampleRows || []).slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-shadow/20">
                      {analysis.fields.map((f) => {
                        const original = f === 'name' ? analysis.originalNames?.[i] : null;
                        return (
                          <td key={f} className="px-2 py-2 text-text-primary">
                            {mapping[f] ? row[mapping[f]] || '—' : '—'}
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
                <span className="text-xs text-text-secondary">Map name and phone to continue.</span>
              )}
            </div>
          </>
        )}

        {step === 3 && summary && (
          <NeuCard className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Cleaning report</h2>
            <p className="text-sm text-text-secondary">
              {summary.imported} leads imported · {summary.mergedDuplicates ?? 0} duplicates merged ·{' '}
              {summary.skippedDnc} skipped (DNC) · {summary.skippedDuplicate} duplicates removed ·{' '}
              {summary.skippedInvalid} invalid phones
            </p>
            {summary.importedWithoutPhone > 0 && (
              <p className="rounded-input bg-action-warn/10 px-3 py-2 text-xs font-medium text-action-warn">
                {summary.importedWithoutPhone} leads imported without a phone number (visible in the list,
                not dialable until a number is added manually).
              </p>
            )}
            {summary.needsManualReview > 0 && (
              <details className="rounded-input bg-action-warn/10 px-3 py-2 text-xs text-action-warn">
                <summary className="cursor-pointer font-medium">
                  {summary.needsManualReview} rows need manual review
                </summary>
                <p className="mt-2 text-text-secondary">
                  AI cleaning couldn't run on these rows (the service didn't respond after three attempts), so
                  they were imported with their original values. Check them in the lead list and fix any names
                  or states that look wrong.
                </p>
              </details>
            )}
            {summary.skippedDetails.length > 0 && (
              <details className="text-xs text-text-secondary">
                <summary className="cursor-pointer">Skipped rows ({summary.skippedDetails.length} shown)</summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {summary.skippedDetails.map((d, i) => (
                    <li key={i}>
                      {d.row}: {d.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <NeuButton onClick={handleReset}>Import another file</NeuButton>
          </NeuCard>
        )}

        <ImportHistory refreshKey={historyRefreshKey} />
      </div>
    </AppShell>
  );
}
