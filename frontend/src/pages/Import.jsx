import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import { formatDateTime } from '../lib/format';
import * as api from '../lib/api';

const REQUIRED_FIELDS = ['name', 'phone', 'state'];
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
  const [step, setStep] = useState(1); // 1 = upload+detect, 2 = confirm mapping+preview, 3 = cleaning report
  const [analysis, setAnalysis] = useState(null); // { headers, rows, mapping, confidence, needsReview, fields }
  const [mapping, setMapping] = useState({});
  const [filename, setFilename] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const data = await api.analyzeImport(file);
      setAnalysis(data);
      setMapping(data.mapping);
      setFilename(file.name);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleMappingChange = (field, header) => {
    setMapping((m) => ({ ...m, [field]: header || undefined }));
  };

  const canContinue = REQUIRED_FIELDS.every((f) => mapping[f]);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const result = await api.commitImport(mapping, analysis.rows, filename);
      setSummary(result);
      setStep(3);
      setHistoryRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  const handleReset = () => {
    setStep(1);
    setAnalysis(null);
    setMapping({});
    setFilename(null);
    setSummary(null);
    setError(null);
  };

  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-4xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary">Import leads</h1>

        {error && <NeuCard className="p-4 text-sm text-action-hangup">{error}</NeuCard>}

        {step === 1 && (
          <NeuCard className="p-6 text-center">
            <p className="text-sm text-text-secondary">Upload a CSV with lead name, phone, and state at minimum.</p>
            <p className="mt-1 text-xs text-text-secondary">
              We'll use AI to detect which columns map to each field.
            </p>
            <NeuButton className="mt-4" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Analyzing…' : 'Choose CSV file'}
            </NeuButton>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          </NeuCard>
        )}

        {step === 2 && analysis && (
          <>
            <NeuCard className="p-5">
              <h2 className="mb-1 text-sm font-semibold text-text-primary">We detected these columns</h2>
              <p className="mb-3 text-xs text-text-secondary">
                Review the AI's suggested mapping below — fields marked in red or amber may need a manual fix.
              </p>
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
                  {analysis.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-shadow/20">
                      {analysis.fields.map((f) => (
                        <td key={f} className="px-2 py-2 text-text-primary">
                          {mapping[f] ? row[mapping[f]] || '—' : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </NeuCard>

            <div className="flex items-center gap-3">
              <ActionButton variant="call" onClick={handleCommit} disabled={!canContinue || committing}>
                {committing ? 'Importing…' : `Confirm & import ${analysis.rows.length} leads`}
              </ActionButton>
              <NeuButton onClick={handleReset}>Start over</NeuButton>
              {!canContinue && (
                <span className="text-xs text-text-secondary">Map name, phone, and state to continue.</span>
              )}
            </div>
          </>
        )}

        {step === 3 && summary && (
          <NeuCard className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Cleaning report</h2>
            <p className="text-sm text-text-secondary">
              {summary.imported} leads imported · {summary.skippedDnc} skipped (DNC) · {summary.skippedDuplicate}{' '}
              duplicates removed · {summary.skippedInvalid} invalid phones
            </p>
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
