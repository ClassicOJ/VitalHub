import { Check, Download, FileText, Lock, Upload } from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { apiFetch } from '../lib/api';
import type { LabReport, LabResult } from '../types';
import { TrendLineChart } from './Charts';

interface LabsScreenProps {
  onUpdated: () => Promise<void>;
}

const SAMPLE_LAB_TEXT = `QUEST DIAGNOSTICS - SPECIMEN COLLECTED: ${new Date().toISOString().slice(0, 10)}
Hemoglobin A1c: 5.3 % (Reference: 4.0 - 5.6 %)
Fasting Glucose: 91 mg/dL (Reference: 70 - 99 mg/dL)
LDL Cholesterol: 96 mg/dL (Reference: < 100 mg/dL)
HDL Cholesterol: 64 mg/dL (Reference: >= 45 mg/dL)
Triglycerides: 88 mg/dL (Reference: < 150 mg/dL)
Vitamin D 25-OH: 41 ng/mL (Reference: 30 - 100 ng/mL)
hs-CRP: 0.7 mg/L (Reference: < 1.0 mg/L)`;

export function LabsScreen({ onUpdated }: LabsScreenProps) {
  const [reports, setReports] = useState<LabReport[]>([]);
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pending confirmation draft state
  const [pendingReport, setPendingReport] = useState<{
    id: string;
    labName: string;
    collectedAt: string;
    ocrRawText: string;
  } | null>(null);
  const [draftResults, setDraftResults] = useState<
    Array<{
      id?: string;
      testName: string;
      testCode: string;
      value: number;
      unit: string;
      referenceLow: number | null;
      referenceHigh: number | null;
      referenceText: string;
      flag: string;
    }>
  >([]);
  const [rawPaste, setRawPaste] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [selectedBiomarker, setSelectedBiomarker] = useState('HbA1c');

  const loadLabs = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ reports: LabReport[]; results: LabResult[] }>('/api/labs');
      setReports(data.reports);
      setResults(data.results);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLabs();
  }, []);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      const data = await apiFetch<{
        report: { id: string; labName: string; collectedAt: string; ocrRawText: string };
        results: typeof draftResults;
      }>('/api/labs/upload', { method: 'POST', body: form });

      setPendingReport(data.report);
      setDraftResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lab extraction failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleTextExtract = async () => {
    if (!rawPaste.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const data = await apiFetch<{
        report: { id: string; labName: string; collectedAt: string; ocrRawText: string };
        results: typeof draftResults;
      }>('/api/labs/upload', {
        method: 'POST',
        body: JSON.stringify({ rawText: rawPaste, title: 'Extracted Diagnostic Panel' }),
      });
      setPendingReport(data.report);
      setDraftResults(data.results);
      setShowPasteBox(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lab extraction failed');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirmSave = async () => {
    if (!pendingReport) return;
    setUploading(true);
    try {
      await apiFetch(`/api/labs/${pendingReport.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          labName: pendingReport.labName,
          collectedAt: pendingReport.collectedAt,
          results: draftResults,
        }),
      });
      setPendingReport(null);
      setDraftResults([]);
      await loadLabs();
      await onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm results');
    } finally {
      setUploading(false);
    }
  };

  const confirmedResults = results.filter((r) => r.confirmed === 1);
  const distinctTests = Array.from(new Set(confirmedResults.map((r) => r.test_name)));
  const activeTest = distinctTests.includes(selectedBiomarker) ? selectedBiomarker : distinctTests[0] || '';

  const trendSeries = confirmedResults
    .filter((r) => r.test_name === activeTest)
    .sort((a, b) => a.collected_at.localeCompare(b.collected_at))
    .map((r) => ({
      label: r.collected_at.slice(0, 10),
      value: r.value,
      source: r.flag.toUpperCase(),
    }));

  const formatFlag = (flag: string) => {
    if (flag === 'normal') return { label: 'Normal', cls: 'text-teal-400' };
    if (flag === 'high') return { label: 'High ▲', cls: 'text-amber-400' };
    if (flag === 'low') return { label: 'Low ▼', cls: 'text-amber-400' };
    if (flag === 'critical_high') return { label: 'Critical High ▲▲', cls: 'text-rose-400' };
    return { label: 'Critical Low ▼▼', cls: 'text-rose-400' };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Lab Reports & Biomarker Trends</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            AES-256-GCM encrypted at rest · Gemini OCR & structured extraction with mandatory user review
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setRawPaste(SAMPLE_LAB_TEXT);
              setShowPasteBox((v) => !v);
            }}
            className="min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium hover:border-teal-500 whitespace-nowrap"
          >
            <FileText className="h-3.5 w-3.5" /> Paste / Sample Report
          </button>

          <label className="min-h-[42px] inline-flex items-center gap-2 rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-4 py-2 text-xs font-bold hover:opacity-90 cursor-pointer whitespace-nowrap">
            <Upload className="h-3.5 w-3.5" />
            <span>{uploading ? 'Extracting...' : 'Upload PDF / Image'}</span>
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {showPasteBox && (
        <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-3">
          <h3 className="text-sm font-semibold">Extract Biomarkers from Report Text</h3>
          <textarea
            rows={7}
            value={rawPaste}
            onChange={(e) => setRawPaste(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0A0F14] p-3 font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPasteBox(false)}
              className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={handleTextExtract}
              className="min-h-[40px] rounded-xl bg-teal-500 px-4 py-2 text-xs font-semibold text-slate-950"
            >
              {uploading ? 'Extracting with Gemini...' : 'Run AI Extraction'}
            </button>
          </div>
        </section>
      )}

      {/* Mandatory Review & Confirmation Table before saving */}
      {pendingReport && (
        <section className="rounded-2xl border border-teal-500/60 bg-white dark:bg-[#1A1A1A] p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-teal-400">
                Review & Confirm Extracted Results
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verify every OCR value and unit against your original document before committing to your longitudinal record.
              </p>
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={handleConfirmSave}
              className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400 whitespace-nowrap"
            >
              <Check className="h-4 w-4" /> Confirm & Save Results
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Laboratory Name</label>
              <input
                type="text"
                value={pendingReport.labName}
                onChange={(e) => setPendingReport({ ...pendingReport, labName: e.target.value })}
                className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Collection Date</label>
              <input
                type="date"
                value={pendingReport.collectedAt.slice(0, 10)}
                onChange={(e) =>
                  setPendingReport({ ...pendingReport, collectedAt: new Date(e.target.value).toISOString() })
                }
                className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm font-mono"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Test Name</th>
                  <th className="py-2 pr-3">Value</th>
                  <th className="py-2 pr-3">Unit</th>
                  <th className="py-2 pr-3">Ref Low</th>
                  <th className="py-2 pr-3">Ref High</th>
                  <th className="py-2">Reference Text</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {draftResults.map((row, idx) => (
                  <tr key={idx}>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={row.testName}
                        onChange={(e) => {
                          const next = [...draftResults];
                          next[idx] = { ...row, testName: e.target.value };
                          setDraftResults(next);
                        }}
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2"
                      />
                    </td>
                    <td className="py-2 pr-2 w-24">
                      <input
                        type="number"
                        step="0.01"
                        value={row.value}
                        onChange={(e) => {
                          const next = [...draftResults];
                          next[idx] = { ...row, value: Number(e.target.value) };
                          setDraftResults(next);
                        }}
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 font-mono tabular-nums"
                      />
                    </td>
                    <td className="py-2 pr-2 w-24">
                      <input
                        type="text"
                        value={row.unit}
                        onChange={(e) => {
                          const next = [...draftResults];
                          next[idx] = { ...row, unit: e.target.value };
                          setDraftResults(next);
                        }}
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 font-mono"
                      />
                    </td>
                    <td className="py-2 pr-2 w-20">
                      <input
                        type="number"
                        step="0.1"
                        value={row.referenceLow ?? ''}
                        onChange={(e) => {
                          const next = [...draftResults];
                          next[idx] = {
                            ...row,
                            referenceLow: e.target.value === '' ? null : Number(e.target.value),
                          };
                          setDraftResults(next);
                        }}
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 font-mono tabular-nums"
                      />
                    </td>
                    <td className="py-2 pr-2 w-20">
                      <input
                        type="number"
                        step="0.1"
                        value={row.referenceHigh ?? ''}
                        onChange={(e) => {
                          const next = [...draftResults];
                          next[idx] = {
                            ...row,
                            referenceHigh: e.target.value === '' ? null : Number(e.target.value),
                          };
                          setDraftResults(next);
                        }}
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2 font-mono tabular-nums"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="text"
                        value={row.referenceText}
                        onChange={(e) => {
                          const next = [...draftResults];
                          next[idx] = { ...row, referenceText: e.target.value };
                          setDraftResults(next);
                        }}
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-2"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Longitudinal Biomarker Trend Chart */}
      {distinctTests.length > 0 && (
        <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="text-base font-semibold">Biomarker Trend Across Reports</h3>
            <select
              value={activeTest}
              onChange={(e) => setSelectedBiomarker(e.target.value)}
              className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131A] px-3 text-xs font-medium"
            >
              {distinctTests.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <TrendLineChart
            data={trendSeries}
            unit={confirmedResults.find((r) => r.test_name === activeTest)?.unit || ''}
            primaryLabel={activeTest}
            height={190}
          />
        </section>
      )}

      {/* Confirmed Lab Results Table */}
      {loading ? (
        <div className="h-44 rounded-2xl bg-slate-200 dark:bg-slate-900 animate-pulse" />
      ) : confirmedResults.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-10 text-center text-sm text-slate-500">
          No confirmed lab results yet. Upload a PDF or image, or paste a sample diagnostic report above.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Biomarker</th>
                  <th className="px-4 py-3 font-medium text-right">Value</th>
                  <th className="px-4 py-3 font-medium">Reference</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Collected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {confirmedResults.map((r) => {
                  const status = formatFlag(r.flag);
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {r.test_name}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {r.value} <span className="text-xs text-slate-400">{r.unit}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">
                        {r.reference_text || '—'}
                      </td>
                      <td className={`px-4 py-3 text-xs font-medium ${status.cls}`}>{status.label}</td>
                      <td className="px-4 py-3 font-mono tabular-nums text-xs text-slate-400">
                        {r.collected_at.slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-5 space-y-4">
            <h3 className="text-sm font-semibold">Encrypted Source Files</h3>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {reports.map((rep) => (
                <div key={rep.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{rep.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {rep.lab_name} · {rep.collected_at.slice(0, 10)} · {rep.status}
                    </p>
                  </div>
                  <a
                    href={`/api/labs/${rep.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 hover:border-teal-500 shrink-0"
                    title="Decrypt & download original file"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-teal-500 shrink-0" />
              Original files stored with AES-256-GCM field-level encryption.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
