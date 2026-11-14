import { Copy, Lock, Printer, Send, ShieldOff, UserPlus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import type { AuditLogRow, MessageRow, NoteRow, ShareRecord } from '../types';
import { TrendLineChart } from './Charts';

const ALL_SCOPES = ['vitals', 'sleep', 'activity', 'diet', 'labs'] as const;

export function SharingScreen() {
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [granteeEmail, setGranteeEmail] = useState('dr.elena@vitalhub.app');
  const [granteeName, setGranteeName] = useState('Dr. Elena Vance, MD');
  const [granteeRole, setGranteeRole] = useState<'doctor' | 'coach' | 'dietician'>('doctor');
  const [scopes, setScopes] = useState<string[]>(['vitals', 'sleep', 'activity', 'labs']);
  const [rangeDays, setRangeDays] = useState(30);
  const [expiryDays, setExpiryDays] = useState(30);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [msgText, setMsgText] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [s, l, n, m] = await Promise.all([
        apiFetch<{ shares: ShareRecord[] }>('/api/shares'),
        apiFetch<{ logs: AuditLogRow[] }>('/api/audit-logs'),
        apiFetch<{ notes: NoteRow[] }>('/api/notes'),
        apiFetch<{ messages: MessageRow[] }>('/api/messages'),
      ]);
      setShares(s.shares);
      setLogs(l.logs);
      setNotes(n.notes);
      setMessages(m.messages);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const toggleScope = (scope: string) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!granteeEmail.trim() || scopes.length === 0) return;
    await apiFetch('/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        granteeEmail,
        granteeName,
        granteeRole,
        scopes,
        rangeDays,
        expiryDays,
      }),
    });
    await loadAll();
  };

  const handleRevoke = async (shareId: string) => {
    await apiFetch(`/api/shares/${shareId}/revoke`, { method: 'POST' });
    await loadAll();
  };

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard?.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!msgText.trim()) return;
    await apiFetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ body: msgText }),
    });
    setMsgText('');
    await loadAll();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Sharing & Access Control</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Grant time-bound, category-scoped access to your care team with one-tap revocation and full access logs
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Invite Care Team Member */}
        <form
          onSubmit={handleInvite}
          className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-4"
        >
          <h3 className="text-base font-semibold">Invite Doctor, Coach, or Dietician</h3>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Care Team Member Name</label>
            <input
              type="text"
              value={granteeName}
              onChange={(e) => setGranteeName(e.target.value)}
              className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Email</label>
              <input
                type="email"
                required
                value={granteeEmail}
                onChange={(e) => setGranteeEmail(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Role</label>
              <select
                value={granteeRole}
                onChange={(e) => setGranteeRole(e.target.value as typeof granteeRole)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131A] px-3 text-sm"
              >
                <option value="doctor">Physician / Doctor</option>
                <option value="coach">Performance Coach</option>
                <option value="dietician">Dietician</option>
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs text-slate-500 mb-2">Shared Categories (Granular Scope)</p>
            <div className="flex flex-wrap gap-2">
              {ALL_SCOPES.map((sc) => {
                const active = scopes.includes(sc);
                return (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => toggleScope(sc)}
                    className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium capitalize border transition-colors ${
                      active
                        ? 'border-teal-500 bg-teal-500/15 text-teal-300'
                        : 'border-slate-300 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {sc}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">History Window</label>
              <select
                value={rangeDays}
                onChange={(e) => setRangeDays(Number(e.target.value))}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131A] px-3 text-sm"
              >
                <option value={7}>Last 7 Days</option>
                <option value={30}>Last 30 Days</option>
                <option value={90}>Last 90 Days</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Link Expiry</label>
              <select
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131A] px-3 text-sm"
              >
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
                <option value={90}>90 Days</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-4 py-2 text-sm font-bold hover:opacity-90"
          >
            <UserPlus className="h-4 w-4" /> Grant Scoped Access
          </button>
        </form>

        {/* Active & Revoked Shares */}
        <div className="lg:col-span-7 space-y-6">
          <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6">
            <h3 className="text-base font-semibold mb-4">Share Grants</h3>
            {loading ? (
              <div className="h-28 rounded-xl bg-slate-200 dark:bg-slate-900 animate-pulse" />
            ) : shares.length === 0 ? (
              <p className="text-sm text-slate-500">No active care-team shares created yet.</p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {shares.map((s) => {
                  const isRevoked = Boolean(s.revoked_at);
                  const isExpired = new Date(s.expires_at).getTime() < Date.now();
                  return (
                    <div key={s.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {s.grantee_name} · <span className="capitalize font-normal text-slate-400">{s.grantee_role}</span>
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {s.grantee_email} · {s.scopes.join(', ')} · {s.range_days}d window
                        </p>
                        <p className="text-xs font-mono text-slate-400 mt-0.5">
                          {isRevoked
                            ? `Revoked ${s.revoked_at?.slice(0, 10)}`
                            : isExpired
                              ? `Expired ${s.expires_at.slice(0, 10)}`
                              : `Active until ${s.expires_at.slice(0, 10)}`}
                        </p>
                      </div>

                      {!isRevoked && !isExpired && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopy(s.id, s.shareUrl)}
                            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:border-teal-500"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {copiedId === s.id ? 'Copied' : 'Copy Link'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(s.id)}
                            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
                          >
                            <ShieldOff className="h-3.5 w-3.5" /> Revoke
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Clinician Notes & In-App Messaging */}
          <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-4">
            <h3 className="text-base font-semibold">Care Team Notes & Messages</h3>
            {notes.length > 0 && (
              <div className="space-y-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                {notes.map((n) => (
                  <div key={n.id} className="rounded-xl bg-slate-100 dark:bg-[#0D131A] p-3.5">
                    <p className="text-xs font-mono text-teal-400">
                      {n.author_name} · {n.category} · {n.created_at.slice(0, 10)}
                    </p>
                    <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-200">{n.content}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {messages.map((m) => (
                <div key={m.id} className="text-xs rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{m.sender_name}</span>
                  <span className="text-slate-500 ml-2">{m.created_at.slice(0, 16).replace('T', ' ')}</span>
                  <p className="mt-1 text-slate-700 dark:text-slate-300">{m.body}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                placeholder="Message your care team..."
                className="flex-1 min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
              />
              <button
                type="submit"
                className="min-h-[42px] min-w-[42px] inline-flex items-center justify-center rounded-xl bg-teal-500 text-slate-950"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </section>
        </div>
      </div>

      {/* Full Access & Audit Log */}
      <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6">
        <h3 className="text-base font-semibold mb-3">Access & Security Audit Log</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
              <tr>
                <th className="py-2 pr-4">Timestamp</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {logs.slice(0, 15).map((l) => (
                <tr key={l.id}>
                  <td className="py-2.5 pr-4 font-mono tabular-nums text-slate-400">
                    {l.created_at.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="py-2.5 pr-4">
                    {l.actor_email} · {l.actor_role}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-teal-400">{l.action}</td>
                  <td className="py-2.5 text-slate-400">{l.resource_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface ProPatientSummary {
  shareId: string;
  patientId: string;
  patientName: string;
  patientEmail: string;
  patientAvatar: string | null;
  scopes: string[];
  rangeDays: number;
  expiresAt: string;
}

interface ScopedPatientDetail {
  patient: { id: string; name: string; email: string; avatarUrl: string | null };
  share: { id: string; scopes: string[]; rangeDays: number; expiresAt: string; granteeRole: string };
  latestByType: Record<string, { value: number; unit: string; timestamp: string; source: string }>;
  metrics: Array<{ type: string; canonical_value: number; canonical_unit: string; timestamp: string }>;
  activities: Array<{ id: string; title: string; start_time: string; duration_sec: number; distance_m: number }>;
  meals: Array<{ id: string; title: string; logged_at: string; calories: number }>;
  labResults: Array<{ id: string; test_name: string; value: number; unit: string; reference_text: string; flag: string; collected_at: string }>;
  notes: NoteRow[];
}

export function ProfessionalViewScreen() {
  const [patients, setPatients] = useState<ProPatientSummary[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ScopedPatientDetail | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteCategory, setNoteCategory] = useState('Cardiometabolic Follow-Up');
  const [noteContent, setNoteContent] = useState('');
  const [isRecommendation, setIsRecommendation] = useState(true);
  const [replyText, setReplyText] = useState('');

  const loadPatients = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ patients: ProPatientSummary[] }>('/api/pro/patients');
      setPatients(data.patients);
      if (data.patients.length > 0 && !selectedPatientId) {
        setSelectedPatientId(data.patients[0].patientId);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadPatientDetail = async (patientId: string) => {
    const [d, m] = await Promise.all([
      apiFetch<ScopedPatientDetail>(`/api/pro/patient/${patientId}`),
      apiFetch<{ messages: MessageRow[] }>(`/api/messages?patientId=${patientId}`),
    ]);
    setDetail(d);
    setMessages(m.messages);
  };

  useEffect(() => {
    loadPatients();
  }, []);

  useEffect(() => {
    if (selectedPatientId) {
      loadPatientDetail(selectedPatientId);
    }
  }, [selectedPatientId]);

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !noteContent.trim()) return;
    await apiFetch(`/api/pro/patient/${selectedPatientId}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        category: noteCategory,
        content: noteContent,
        isRecommendation,
      }),
    });
    setNoteContent('');
    await loadPatientDetail(selectedPatientId);
  };

  const handleReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId || !replyText.trim()) return;
    await apiFetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ patientId: selectedPatientId, body: replyText }),
    });
    setReplyText('');
    await loadPatientDetail(selectedPatientId);
  };

  if (loading) {
    return <div className="h-56 rounded-2xl bg-slate-200 dark:bg-slate-900 animate-pulse" />;
  }

  if (patients.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-10 text-center">
        <h3 className="text-lg font-semibold">No active patient shares</h3>
        <p className="mt-2 text-sm text-slate-500">
          When a member invites you via VitalHub Sharing, their scoped read-only clinical dashboard will appear here.
        </p>
      </div>
    );
  }

  const scopes = new Set(detail?.share.scopes || []);
  const rhrSeries = (detail?.metrics || [])
    .filter((m) => m.type === 'resting_hr')
    .map((m) => ({ label: m.timestamp.slice(5, 10), value: m.canonical_value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-xl font-semibold">Care Team Clinical View (Read-Only)</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Strictly scoped to categories explicitly shared by the patient
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium hover:border-teal-500 whitespace-nowrap"
        >
          <Printer className="h-4 w-4" /> Export Printable / PDF Summary
        </button>
      </div>

      {/* Patient Selector */}
      <div className="flex flex-wrap gap-3 no-print">
        {patients.map((p) => (
          <button
            key={p.shareId}
            type="button"
            onClick={() => setSelectedPatientId(p.patientId)}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-2.5 text-left transition-colors ${
              selectedPatientId === p.patientId
                ? 'border-teal-500 bg-teal-500/10'
                : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05]'
            }`}
          >
            {p.patientAvatar ? (
              <img
                src={p.patientAvatar}
                alt={p.patientName}
                referrerPolicy="no-referrer"
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <div className="h-9 w-9 rounded-full bg-slate-800 flex items-center justify-center text-xs font-semibold">
                {p.patientName.slice(0, 2)}
              </div>
            )}
            <div>
              <p className="text-sm font-semibold">{p.patientName}</p>
              <p className="text-[11px] text-slate-500">
                Scopes: {p.scopes.join(', ')} · {p.rangeDays}d
              </p>
            </div>
          </button>
        ))}
      </div>

      {detail && (
        <div className="space-y-6">
          {/* Scope Enforcement Summary */}
          <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">{detail.patient.name}</h3>
              <p className="text-xs text-slate-500">
                Shared Categories: {detail.share.scopes.join(' · ')} · Window: {detail.share.rangeDays} days · Expires{' '}
                {detail.share.expiresAt.slice(0, 10)}
              </p>
            </div>
            {!scopes.has('diet') && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Lock className="h-3.5 w-3.5 text-amber-400" />
                <span>Nutrition / Diet is not shared by patient (RBAC enforced)</span>
              </div>
            )}
          </div>

          {scopes.has('vitals') && (
            <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6">
              <h4 className="text-base font-semibold mb-4">Resting Heart Rate Trend ({detail.share.rangeDays}d)</h4>
              <TrendLineChart data={rhrSeries} unit="bpm" primaryLabel="Resting HR" height={190} />
            </section>
          )}

          {scopes.has('labs') && detail.labResults.length > 0 && (
            <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 overflow-x-auto">
              <h4 className="text-base font-semibold mb-3">Confirmed Lab Results</h4>
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Test</th>
                    <th className="py-2 pr-4 text-right">Value</th>
                    <th className="py-2 pr-4">Reference</th>
                    <th className="py-2 pr-4">Flag</th>
                    <th className="py-2">Collected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {detail.labResults.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-4 font-medium">{l.test_name}</td>
                      <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                        {l.value} {l.unit}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-slate-400">{l.reference_text}</td>
                      <td className="py-2.5 pr-4 uppercase font-mono">{l.flag}</td>
                      <td className="py-2.5 font-mono text-slate-400">{l.collected_at.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 no-print">
            {/* Add Clinical Note / Recommendation */}
            <form
              onSubmit={handleAddNote}
              className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-4"
            >
              <h4 className="text-base font-semibold">Add Clinical Note & Recommendation</h4>
              <input
                type="text"
                value={noteCategory}
                onChange={(e) => setNoteCategory(e.target.value)}
                className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
                placeholder="Category (e.g. Lipid Management)"
              />
              <textarea
                rows={4}
                required
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write observation or care-plan recommendation..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent p-3 text-sm"
              />
              <label className="flex items-center gap-2 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={isRecommendation}
                  onChange={(e) => setIsRecommendation(e.target.checked)}
                  className="h-4 w-4 accent-teal-500"
                />
                Mark as actionable recommendation
              </label>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400"
              >
                Save Note to Patient Record
              </button>
            </form>

            {/* Care Team Messaging */}
            <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 flex flex-col justify-between gap-4">
              <div>
                <h4 className="text-base font-semibold mb-3">Direct Patient Messaging</h4>
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-xl bg-slate-100 dark:bg-[#0D131A] p-3 text-xs">
                      <p className="font-semibold">{m.sender_name}</p>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">{m.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <form onSubmit={handleReply} className="flex gap-2">
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Send message to patient..."
                  className="flex-1 min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
                />
                <button
                  type="submit"
                  className="min-h-[42px] min-w-[42px] inline-flex items-center justify-center rounded-xl bg-teal-500 text-slate-950"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
