import { Download, Lock, Moon, Sun, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { AuthUser, UserRole } from '../types';

interface SettingsProps {
  user: AuthUser;
  darkMode: boolean;
  largeType: boolean;
  onToggleDarkMode: () => void;
  onToggleLargeType: () => void;
  onUserUpdated: (user: AuthUser) => void;
  onAccountPurged: () => void;
}

export function SettingsPrivacyScreen({
  user,
  darkMode,
  largeType,
  onToggleDarkMode,
  onToggleLargeType,
  onUserUpdated,
  onAccountPurged,
}: SettingsProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleBiometricToggle = async () => {
    const res = await apiFetch<{ user: AuthUser }>('/api/auth/biometric', {
      method: 'POST',
      body: JSON.stringify({ enabled: !user.biometricLockEnabled }),
    });
    onUserUpdated(res.user);
    setStatus(res.user.biometricLockEnabled ? 'Session PIN / Biometric lock enabled.' : 'Biometric lock disabled.');
  };

  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      await apiFetch('/api/privacy/delete-account', { method: 'DELETE' });
      onAccountPurged();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold">Settings, Accessibility & Privacy</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          DPDP Act & GDPR controls, encryption posture, and display accessibility preferences
        </p>
      </div>

      {status && (
        <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
          {status}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] divide-y divide-slate-200 dark:divide-slate-800">
        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Appearance Theme</p>
            <p className="text-xs text-slate-500">Calm dark mode default with high-contrast light option</p>
          </div>
          <button
            type="button"
            onClick={onToggleDarkMode}
            className="min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium"
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {darkMode ? 'Switch to Light' : 'Switch to Dark'}
          </button>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Accessible Large Type</p>
            <p className="text-xs text-slate-500">Increases base reading size for effortless legibility</p>
          </div>
          <button
            type="button"
            onClick={onToggleLargeType}
            className={`min-h-[42px] rounded-xl px-4 py-2 text-xs font-medium border ${
              largeType
                ? 'border-teal-500 bg-teal-500/15 text-teal-300'
                : 'border-slate-300 dark:border-slate-700'
            }`}
          >
            {largeType ? 'Large Type On' : 'Standard Type'}
          </button>
        </div>

        <div className="p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Biometric / Session Screen Lock</p>
            <p className="text-xs text-slate-500">Requires quick unlock prompt before resuming sensitive views</p>
          </div>
          <button
            type="button"
            onClick={handleBiometricToggle}
            className={`min-h-[42px] inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-medium border ${
              user.biometricLockEnabled
                ? 'border-teal-500 bg-teal-500/15 text-teal-300'
                : 'border-slate-300 dark:border-slate-700'
            }`}
          >
            <Lock className="h-3.5 w-3.5" />
            {user.biometricLockEnabled ? 'Enabled' : 'Enable Lock'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold">Your Data Rights (DPDP Act & GDPR)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Download a portable JSON archive of all normalized metrics, workouts, meals, lab results, shares, and audit logs, or permanently erase your data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/privacy/export"
            className="min-h-[44px] inline-flex items-center gap-2 rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-5 py-2.5 text-xs font-bold hover:opacity-90"
          >
            <Download className="h-4 w-4" /> Export All My Data (JSON)
          </a>

          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-rose-500/50 px-5 py-2.5 text-xs font-medium text-rose-400 hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" /> Delete All My Data
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteAll}
                className="min-h-[44px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white"
              >
                {deleting ? 'Deleting...' : 'Confirm Permanent Deletion'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function AdminConsoleScreen() {
  const [data, setData] = useState<{
    users: Array<{ id: string; email: string; name: string; role: UserRole; created_at: string }>;
    sourceStats: Array<{ provider: string; status: string; count: number; latest_sync: string | null }>;
    counts: { users: number; metrics: number; activities: number; labReports: number; activeShares: number };
  } | null>(null);

  const load = async () => {
    const res = await apiFetch<NonNullable<typeof data>>('/api/admin/overview');
    setData(res);
  };

  useEffect(() => {
    load();
  }, []);

  const handleRoleChange = async (id: string, role: UserRole) => {
    await apiFetch(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
    await load();
  };

  if (!data) {
    return <div className="h-56 rounded-2xl bg-slate-200 dark:bg-slate-900 animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Admin Operations & System Health</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Role-based user administration and connector pipeline overview
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Users', val: data.counts.users },
          { label: 'Normalized Metrics', val: data.counts.metrics },
          { label: 'Synced Activities', val: data.counts.activities },
          { label: 'Encrypted Lab Panels', val: data.counts.labReports },
          { label: 'Active Care Shares', val: data.counts.activeShares },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4"
          >
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">{c.val}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 overflow-x-auto">
        <h3 className="text-base font-semibold mb-4">User Role Management</h3>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
            <tr>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.users.map((u) => (
              <tr key={u.id}>
                <td className="py-3 pr-4 font-medium">{u.name}</td>
                <td className="py-3 pr-4 font-mono text-xs text-slate-400">{u.email}</td>
                <td className="py-3 pr-4">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                    className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131A] px-2.5 text-xs"
                  >
                    <option value="individual">individual</option>
                    <option value="professional">professional</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td className="py-3 font-mono text-xs text-slate-400">{u.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 overflow-x-auto">
        <h3 className="text-base font-semibold mb-4">Connector Health Matrix</h3>
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
            <tr>
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4 text-right">Connections</th>
              <th className="py-2">Latest Sync</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {data.sourceStats.map((s, i) => (
              <tr key={i}>
                <td className="py-2.5 pr-4 font-mono">{s.provider}</td>
                <td className="py-2.5 pr-4">{s.status}</td>
                <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{s.count}</td>
                <td className="py-2.5 font-mono text-slate-400">
                  {s.latest_sync ? s.latest_sync.slice(0, 19).replace('T', ' ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
