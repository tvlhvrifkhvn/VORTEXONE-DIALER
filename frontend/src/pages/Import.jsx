import { useRef, useState } from 'react';
import AppShell from '../components/layout/AppShell';
import NeuCard from '../components/ui/NeuCard';
import NeuButton from '../components/ui/NeuButton';
import NeuInput from '../components/ui/NeuInput';
import ActionButton from '../components/ui/ActionButton';
import * as api from '../lib/api';

const REQUIRED_FIELDS = ['name', 'phone', 'state'];

export default function Import() {
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null); // { headers, rows, fields }
  const [mapping, setMapping] = useState({});
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    setUploading(true);
    try {
      const data = await api.previewImport(file);
      setPreview(data);
      setMapping(data.mapping);
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

  const canCommit = REQUIRED_FIELDS.every((f) => mapping[f]);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const result = await api.commitImport(mapping, preview.rows);
      setSummary(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setCommitting(false);
    }
  };

  const handleReset = () => {
    setPreview(null);
    setMapping({});
    setSummary(null);
    setError(null);
  };

  return (
    <AppShell>
      <div className="mx-auto mt-4 max-w-4xl space-y-4">
        <h1 className="text-lg font-semibold text-text-primary">Import leads</h1>

        {!preview && (
          <NeuCard className="p-6 text-center">
            <p className="text-sm text-text-secondary">Upload a CSV with lead name, phone, and state at minimum.</p>
            <NeuButton className="mt-4" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Reading file…' : 'Choose CSV file'}
            </NeuButton>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          </NeuCard>
        )}

        {error && (
          <NeuCard className="p-4 text-sm text-action-hangup">{error}</NeuCard>
        )}

        {preview && !summary && (
          <>
            <NeuCard className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-text-primary">Map columns</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {preview.fields.map((field) => (
                  <div key={field}>
                    <label className="mb-1 block text-xs font-medium capitalize text-text-secondary">
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
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </NeuInput>
                  </div>
                ))}
              </div>
            </NeuCard>

            <NeuCard className="overflow-x-auto p-5">
              <h2 className="mb-3 text-sm font-semibold text-text-primary">
                Preview ({preview.rows.length} row{preview.rows.length === 1 ? '' : 's'} total)
              </h2>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-text-secondary">
                    {preview.fields.map((f) => (
                      <th key={f} className="px-2 py-2">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-t border-shadow/20">
                      {preview.fields.map((f) => (
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
              <ActionButton variant="call" onClick={handleCommit} disabled={!canCommit || committing}>
                {committing ? 'Importing…' : `Import ${preview.rows.length} leads`}
              </ActionButton>
              <NeuButton onClick={handleReset}>Start over</NeuButton>
              {!canCommit && (
                <span className="text-xs text-text-secondary">Map name, phone, and state to continue.</span>
              )}
            </div>
          </>
        )}

        {summary && (
          <NeuCard className="space-y-3 p-5">
            <h2 className="text-sm font-semibold text-text-primary">Import complete</h2>
            <p className="text-sm text-text-secondary">
              {summary.imported} imported · {summary.skippedDnc} on DNC list · {summary.skippedDuplicate} duplicates ·{' '}
              {summary.skippedInvalid} invalid
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
      </div>
    </AppShell>
  );
}
