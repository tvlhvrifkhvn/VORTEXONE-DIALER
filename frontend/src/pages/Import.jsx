import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import Badge from '../components/ui/Badge';
import Meter from '../components/ui/Meter';
import SectionLabel from '../components/ui/SectionLabel';
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
// Mapping confidence as Tag tones (docs/RESKIN.md R6): HIGH solid, MEDIUM outline, LOW dashed.
const CONFIDENCE_TONES = { high: 'solid', medium: 'outline', low: 'dashed' };

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
    <section>
    <SectionLabel title="Import history" className="mb-2" />
    <NeuCard className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="label px-4 py-3 font-medium">Date</th>
            <th className="label px-4 py-3 font-medium">Filename</th>
            <th className="label px-4 py-3 text-right font-medium">Imported</th>
            <th className="label px-4 py-3 text-right font-medium">Skipped</th>
            <th className="label px-4 py-3 text-right font-medium">Duplicates</th>
          </tr>
        </thead>
        <tbody>
          {history.map((row) => (
            <tr key={row.id} className="h-12 border-b last:border-b-0">
              <td className="px-4 font-mono text-xs tabular-nums text-muted-foreground">{formatDateTime(row.imported_at)}</td>
              <td className="px-4 text-foreground">{row.filename || '—'}</td>
              <td className="px-4 text-right font-mono tabular-nums text-foreground">{row.imported}</td>
              <td className="px-4 text-right font-mono tabular-nums text-foreground">{row.skipped_dnc + row.skipped_invalid}</td>
              <td className="px-4 text-right font-mono tabular-nums text-foreground">{row.skipped_duplicate}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </NeuCard>
    </section>
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
      <NeuCard className="space-y-4 p-6">
        <SectionLabel index="04" title="Result" />
        <p className="text-sm text-muted-foreground">
          {summary.imported} leads imported · {summary.mergedDuplicates ?? 0} duplicates merged · {summary.skippedDnc} skipped
          (DNC) · {summary.skippedDuplicate} duplicates removed · {summary.skippedInvalid} invalid
        </p>
        <NeuButton onClick={onReset}>Import another file</NeuButton>
      </NeuCard>
    );
  }

  return (
    <NeuCard className="space-y-4 p-6">
      <SectionLabel index="04" title="Result" />
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b font-semibold text-foreground">
            <td className="py-2">Rows in the file</td>
            <td className="py-2 text-right font-mono text-lg tabular-nums">{summary.totalRows}</td>
          </tr>
          {BUCKETS.map(([key, label]) => (
            <tr key={key} className="border-b text-foreground">
              <td className="py-2">{label}</td>
              <td className="py-2 text-right font-mono tabular-nums">{summary[key]}</td>
            </tr>
          ))}
          {summary.notProcessed > 0 && (
            <tr className="border-b font-medium text-foreground">
              <td className="py-2">
                <Badge tone="dashed" className="mr-2">
                  Cancelled
                </Badge>
                Not processed (import cancelled)
              </td>
              <td className="py-2 text-right font-mono tabular-nums">{summary.notProcessed}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className={`font-mono text-xs uppercase ${summary.allRowsAccountedFor ? 'text-foreground' : 'font-medium text-signal'}`}>
        {summary.allRowsAccountedFor
          ? `✓ All ${summary.totalRows} rows are accounted for.`
          : 'Some rows are not accounted for — please report this.'}
      </p>
      {summary.noNumber > 0 && (
        <p className="border-l-[3px] border-strong bg-muted px-4 py-2 text-sm text-foreground">
          {summary.noNumber} leads were imported without a usable phone number (visible in the list, not dialable until a
          number is added).
          {summary.unreadable > 0 &&
            ` ${summary.unreadable} of them had a number that couldn't be read — the original text is shown on the lead.`}
        </p>
      )}
      {summary.namesTrimmed > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="import-names-trimmed">
          {summary.namesTrimmed} name(s) were longer than 200 characters and were cut to 200.
        </p>
      )}
      {summary.smsOptedOut > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="import-sms-opted-out">
          SMS opted out: {summary.smsOptedOut} imported lead(s) replied STOP to a text earlier — they won't be texted, but
          they can still be called.
        </p>
      )}
      {summary.withExtension > 0 && (
        <p className="text-sm text-muted-foreground">{summary.withExtension} numbers had an extension — it is kept and shown on the call screen.</p>
      )}
      {summary.invalidReasons?.length > 0 && (
        <div className="text-sm text-muted-foreground">
          <p className="label">Why rows were invalid</p>
          <ul className="mt-2">
            {summary.invalidReasons.map((r) => (
              <li key={r.reason} className="border-b py-1 last:border-b-0">
                <span className="font-mono tabular-nums text-foreground">{r.count} ×</span> {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.ambiguousSameName > 0 && (
        <p className="text-sm text-muted-foreground">
          {summary.ambiguousSameName} rows had only a name that appears in several places in the file — they were not merged
          into any of them.
        </p>
      )}
      {summary.aiStoppedAfterFailures && (
        <p className="text-sm text-muted-foreground">
          The AI cleaner stopped responding, so {summary.rowsNotAiCleaned} rows were imported with the built-in cleanup only.
        </p>
      )}
      {skippedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <NeuButton onClick={download}>Download the {skippedCount} rows that weren't imported (CSV) ↓</NeuButton>
          {downloadError && <span role="alert" className="text-sm text-signal">{downloadError}</span>}
        </div>
      )}
      <NeuButton variant="primary" onClick={onReset}>
        Import another file →
      </NeuButton>
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
      <div className="mx-auto mt-6 max-w-5xl space-y-6">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-foreground">Import leads</h1>

        {error && (
          <NeuCard role="alert" className="border-l-[3px] border-l-primary p-4 text-sm text-foreground">
            <span className="label mr-2 text-signal">Error</span>
            {error}
          </NeuCard>
        )}

        {isActive && job && (
          <NeuCard className="space-y-4 p-6">
            <h2 className="text-base font-semibold text-foreground">Importing {job.filename || filename || 'leads'}…</h2>
            <Meter
              label="Rows processed"
              value={job.processedRows || 0}
              max={job.totalRows || 0}
              tone="goal"
              format={(n) => Number(n).toLocaleString('en-US')}
            />
            <p className="text-sm text-muted-foreground">
              {job.phaseLabel || `${job.processedRows} of ${job.totalRows} rows processed`}
              {job.failedRows > 0 ? ` · ${job.failedRows} need manual review` : ''}
            </p>
            <p className="text-sm text-muted-foreground">
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
            {cancelNote && <p className="text-sm text-muted-foreground">{cancelNote}</p>}
          </NeuCard>
        )}

        {step === 1 && !isActive && (
          <NeuCard className="space-y-4 p-6">
            <SectionLabel index="01" title="File" />
            <p className="text-base text-foreground">
              Upload a CSV or Excel file with lead name, phone, and state at minimum.
            </p>
            <p className="text-sm text-muted-foreground">
              Columns are matched automatically (with AI when it's available) and you can correct them before
              importing. Any number of rows; very large files (over the upload size limit) need to be split.
            </p>
            <NeuButton variant="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
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
          <NeuCard className="space-y-4 p-6">
            <SectionLabel index="01" title="File" meta="Sheets" />
            <h2 className="text-base font-semibold text-foreground">
              This file has {analysis.sheetNames.length} sheets — which should we import?
            </h2>
            <div className="space-y-2">
              {analysis.sheetNames.map((name) => (
                <label key={name} className="flex min-h-10 cursor-pointer items-center gap-4 border-b text-sm text-foreground last:border-b-0">
                  <input
                    type="checkbox"
                    checked={selectedSheets.includes(name)}
                    onChange={() => toggleSheet(name)}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                  <span className="flex-1">{name}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {analysis.sheetRowCounts?.[name] ?? 0} rows
                  </span>
                </label>
              ))}
            </div>
            <p className="font-mono text-xs uppercase tabular-nums text-muted-foreground">{selectedRowCount} rows selected</p>
            <div className="flex gap-2">
              <ActionButton variant="call" className="min-h-10 py-2" onClick={() => setStep(2)} disabled={selectedSheets.length === 0}>
                Continue →
              </ActionButton>
              <NeuButton onClick={handleReset}>Start over</NeuButton>
            </div>
          </NeuCard>
        )}

        {step === 2 && analysis && (
          <>
            <NeuCard className="space-y-4 p-6">
              <SectionLabel index="02" title="Mapping" />
              <h2 className="text-base font-semibold text-foreground">We detected these columns</h2>
              {analysis.unavailable ? (
                <p className="border-l-[3px] border-strong bg-muted px-4 py-2 text-sm text-foreground">
                  AI mapping is off or unavailable — columns were matched by their names. Check them below
                  and change any that are wrong.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Review the AI's suggested mapping below — fields tagged LOW or NEEDS REVIEW may need a manual fix.
                </p>
              )}
              {/* The mapping as a table: field, source column, confidence. */}
              <div className="border-t">
                <div className="grid grid-cols-[140px_1fr_120px] gap-4 border-b py-2">
                  <span className="label">Field</span>
                  <span className="label">Column in your file</span>
                  <span className="label">Confidence</span>
                </div>
                {analysis.fields.map((field) => {
                  const confidence = analysis.confidence?.[field] || 'low';
                  const flagged = analysis.needsReview?.includes(field);
                  return (
                    <div key={field} className="grid grid-cols-[140px_1fr_120px] items-center gap-4 border-b py-2">
                      <label htmlFor={`map-${field}`} className="font-mono text-xs font-medium uppercase text-foreground">
                        {FIELD_LABELS[field] || field}
                        {REQUIRED_FIELDS.includes(field) && ' *'}
                      </label>
                      <NeuInput
                        id={`map-${field}`}
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
                      <span>
                        <Badge tone={flagged ? 'dashed' : CONFIDENCE_TONES[confidence] || CONFIDENCE_TONES.low}>
                          {flagged ? 'Needs review' : confidence}
                        </Badge>
                      </span>
                    </div>
                  );
                })}
              </div>
            </NeuCard>

            <NeuCard className="space-y-4 overflow-x-auto p-6">
              <SectionLabel index="03" title="Review" />
              <h2 className="text-base font-semibold text-foreground">Preview — first 5 leads as they'll be imported</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    {PREVIEW_FIELDS.map((f) => (
                      <th key={f} className="label px-2 py-2 font-medium">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(analysis.sampleRows || []).slice(0, 5).map((row, i) => (
                    <tr key={i} className="h-12 border-b last:border-b-0">
                      {PREVIEW_FIELDS.map((f) => {
                        const original = f === 'name' ? analysis.originalNames?.[i] : null;
                        const value = f === 'name' ? previewName(row, mapping) : mapping[f] ? row[mapping[f]] : '';
                        return (
                          <td key={f} className={`px-2 text-foreground ${f === 'phone' ? 'font-mono tabular-nums' : ''}`}>
                            {value || '—'}
                            {original && (
                              <span
                                title={`Cleaned by AI from: ${original}`}
                                aria-label={`Cleaned by AI from: ${original}`}
                                className="ml-2 cursor-help"
                              >
                                <Badge>AI</Badge>
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

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton variant="call" className="min-h-10 py-2" onClick={handleCommit} disabled={!canContinue || committing}>
                {committing
                  ? 'Starting…'
                  : `Confirm & import ${selectedRowCount || analysis.totalRows} leads`}
              </ActionButton>
              <NeuButton onClick={handleReset}>Start over</NeuButton>
              {!canContinue && (
                <span className="text-sm text-muted-foreground">
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
