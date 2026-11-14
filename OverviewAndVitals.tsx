import { AlertTriangle, Bell, Check, Plus, RefreshCw, Ruler, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import type { HealthAlertItem, HealthSnapshot } from '../types';
import { TrendLineChart } from './Charts';

interface OverviewProps {
  snapshot: HealthSnapshot | null;
  loading: boolean;
  rangeDays: number;
  onRangeChange: (days: number) => void;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
  onOpenLogModal: () => void;
  onOpenBodyProfileModal: () => void;
}

function formatAlertValue(metricType: string, val: number, unit: string): string {
  if (metricType === 'sleep_duration') {
    return `${(val / 60).toFixed(1)} hrs`;
  }
  if (metricType === 'weight') {
    return `${val.toFixed(1)} ${unit}`;
  }
  return `${Math.round(val)} ${unit}`;
}

export function OverviewDashboard({
  snapshot,
  loading,
  rangeDays,
  onRangeChange,
  onRefresh,
  onNavigate,
  onOpenLogModal,
  onOpenBodyProfileModal,
}: OverviewProps) {
  const [selectedMetric, setSelectedMetric] = useState<string>('resting_hr');
  const [scanningAlerts, setScanningAlerts] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const [alertsExpanded, setAlertsExpanded] = useState(false);

  const handleScanAlerts = async () => {
    setScanningAlerts(true);
    try {
      await apiFetch('/api/alerts/scan', { method: 'POST' });
      await onRefresh();
    } finally {
      setScanningAlerts(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    setAcknowledgingId(alertId);
    try {
      await apiFetch(`/api/alerts/${alertId}/acknowledge`, { method: 'POST' });
      await onRefresh();
    } finally {
      setAcknowledgingId(null);
    }
  };

  const handleAcknowledgeAll = async () => {
    setAcknowledgingId('all');
    try {
      await apiFetch('/api/alerts/acknowledge-all', { method: 'POST' });
      await onRefresh();
    } finally {
      setAcknowledgingId(null);
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-64 rounded-[32px] bg-slate-200 dark:bg-white/[0.05] border border-slate-200 dark:border-white/[0.08]" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-36 rounded-[28px] bg-slate-200 dark:bg-white/[0.05]" />
          ))}
        </div>
      </div>
    );
  }

  const latest = snapshot?.latestByType || {};
  const hasAnyData = Object.keys(latest).length > 0 || (snapshot?.activities.length || 0) > 0;

  if (!hasAnyData) {
    return (
      <div className="rounded-[32px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] backdrop-blur-md p-8 sm:p-14 text-center max-w-2xl mx-auto">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#056583] dark:text-[#69A3B5]">
          Onboarding Complete · Empty Record
        </p>
        <h2 className="mt-3 text-2xl sm:text-3xl font-semibold">Your health timeline is ready</h2>
        <p className="mt-3 text-sm text-slate-600 dark:text-white/60">
          Connect Apple HealthKit, Google Health Connect, or Strava, log a meal, or upload a lab report to
          generate your unified dashboard and AI health score.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('sources')}
            className="min-h-[44px] rounded-[20px] bg-[#056583] dark:bg-[#cde0e6] px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white dark:text-[#090e11] hover:opacity-90 transition-opacity"
          >
            Connect Health Sources
          </button>
          <button
            type="button"
            onClick={onOpenBodyProfileModal}
            className="min-h-[44px] rounded-[20px] border border-slate-300 dark:border-white/[0.12] px-6 py-2.5 text-xs font-bold uppercase tracking-wider hover:border-[#056583] transition-colors"
          >
            Set Height & Weight
          </button>
          <button
            type="button"
            onClick={() => onNavigate('labs')}
            className="min-h-[44px] rounded-[20px] border border-slate-300 dark:border-white/[0.12] px-6 py-2.5 text-xs font-bold uppercase tracking-wider hover:border-[#056583] transition-colors"
          >
            Upload Lab Report
          </button>
        </div>
      </div>
    );
  }

  const metricSeries = (snapshot?.metrics || [])
    .filter((m) => m.type === selectedMetric)
    .map((m) => ({
      label: m.timestamp.slice(5, 10),
      value: m.canonical_value,
      source: m.origin_app || m.source_provider,
    }));

  const metricConfigs: Array<{ key: string; label: string; unit: string }> = [
    { key: 'resting_hr', label: 'Resting HR', unit: 'bpm' },
    { key: 'hrv', label: 'HRV', unit: 'ms' },
    { key: 'steps', label: 'Daily Steps', unit: 'count' },
    { key: 'sleep_duration', label: 'Sleep Duration', unit: 'min' },
    { key: 'glucose', label: 'Glucose', unit: 'mg/dL' },
    { key: 'weight', label: 'Weight', unit: 'kg' },
  ];

  const activeConfig = metricConfigs.find((c) => c.key === selectedMetric) || metricConfigs[0];
  const evaluation = snapshot?.latestEvaluation;
  const escalation = snapshot?.safetyEscalation;
  const activeAlerts: HealthAlertItem[] = snapshot?.alerts?.active || [];
  const acknowledgedAlerts: HealthAlertItem[] = snapshot?.alerts?.acknowledged || [];
  const bodyProfile = snapshot?.bodyProfile;

  const heightVal = bodyProfile?.heightCm ?? latest.height?.value ?? null;
  const weightVal = bodyProfile?.weightKg ?? latest.weight?.value ?? null;
  const bmiVal =
    bodyProfile?.bmi ??
    (heightVal && weightVal ? Number((weightVal / Math.pow(heightVal / 100, 2)).toFixed(1)) : null);

  const kpiCards = [
    {
      label: 'Steps Today',
      val: latest.steps ? Math.round(latest.steps.value).toLocaleString() : '—',
      unit: 'steps',
      meta: latest.steps ? `${latest.steps.originApp}` : 'No sync yet',
    },
    {
      label: 'Resting HR',
      val: latest.resting_hr ? `${Math.round(latest.resting_hr.value)}` : '—',
      unit: 'bpm',
      meta: latest.resting_hr ? `${latest.resting_hr.originApp}` : 'No sync yet',
    },
    {
      label: 'Variability',
      val: latest.hrv ? `${Math.round(latest.hrv.value)}` : '—',
      unit: 'ms (HRV)',
      meta: latest.hrv ? `${latest.hrv.originApp}` : 'No sync yet',
    },
    {
      label: 'Sleep Duration',
      val: latest.sleep_duration ? `${(latest.sleep_duration.value / 60).toFixed(1)}` : '—',
      unit: 'hours',
      meta: latest.sleep_duration ? `${latest.sleep_duration.originApp}` : 'No sync yet',
    },
    {
      label: 'Fasting Glucose',
      val: latest.glucose ? `${Math.round(latest.glucose.value)}` : '—',
      unit: 'mg/dL',
      meta: latest.glucose ? `${latest.glucose.originApp}` : 'No sync yet',
    },
    {
      label: 'Blood Oxygen',
      val: latest.spo2 ? `${latest.spo2.value.toFixed(1)}` : '—',
      unit: '% SpO2',
      meta: latest.spo2 ? `${latest.spo2.originApp}` : 'No sync yet',
    },
    {
      label: 'Blood Pressure',
      val:
        latest.bp_systolic && latest.bp_diastolic
          ? `${Math.round(latest.bp_systolic.value)}/${Math.round(latest.bp_diastolic.value)}`
          : '—',
      unit: 'mmHg',
      meta: latest.bp_systolic ? `${latest.bp_systolic.originApp}` : 'No sync yet',
    },
    {
      label: 'Body Weight',
      val: weightVal !== null ? `${weightVal.toFixed(1)}` : '—',
      unit: 'kg',
      meta: latest.weight ? `${latest.weight.originApp}` : 'Body profile',
      editableBody: true,
    },
    {
      label: 'Height',
      val: heightVal !== null ? `${heightVal.toFixed(1)}` : '—',
      unit: 'cm',
      meta: latest.height ? `${latest.height.originApp}` : 'Body profile',
      editableBody: true,
    },
    {
      label: 'Body Mass Index',
      val: bmiVal !== null ? `${bmiVal.toFixed(1)}` : '—',
      unit: 'kg/m²',
      meta: bmiVal !== null ? 'Auto-computed' : 'Add height & weight',
      editableBody: true,
    },
  ];

  const showAlertsSection = activeAlerts.length > 0 || alertsExpanded;

  return (
    <div className="space-y-8">
      {/* Variation 3 Top Header Group */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-[-0.04em] text-[#056583] dark:text-[#cde0e6]">
          VitalHub
        </h1>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setAlertsExpanded((v) => !v)}
            className={`min-h-[38px] inline-flex items-center gap-2 rounded-full border px-4 py-1.5 font-mono text-[11px] uppercase transition-colors ${
              activeAlerts.length > 0
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300'
                : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            }`}
          >
            <span>
              {activeAlerts.length > 0
                ? `▲ ${activeAlerts.length} Active Health Alert${activeAlerts.length === 1 ? '' : 's'}`
                : `All metrics nominal · 0 Alerts`}
            </span>
          </button>

          <button
            type="button"
            onClick={handleScanAlerts}
            disabled={scanningAlerts}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-[16px] border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.05] px-3.5 py-1.5 font-mono text-[11px] uppercase hover:border-[#056583] transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanningAlerts ? 'animate-spin' : ''}`} />
            {scanningAlerts ? 'Scanning...' : 'Scan Metrics'}
          </button>
        </div>
      </header>

      {/* Safety Escalation Banner */}
      {escalation?.triggered && (
        <div
          role="alert"
          className="rounded-[24px] border border-rose-500/50 bg-rose-500/10 backdrop-blur-md p-5 flex items-start gap-4"
        >
          <AlertTriangle className="h-6 w-6 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-200">
              Urgent Care Threshold Notice
            </p>
            <p className="mt-1 text-sm text-rose-800 dark:text-rose-100/90">{escalation.message}</p>
            <ul className="mt-2 list-disc list-inside text-xs text-rose-700 dark:text-rose-200 space-y-1">
              {escalation.triggers.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Health Alerts Notification Panel (Visible when alerts active or toggled) */}
      {showAlertsSection && (
        <section
          aria-label="Health Alerts"
          className={`rounded-[28px] border p-6 backdrop-blur-md ${
            activeAlerts.length > 0
              ? 'border-amber-500/45 bg-amber-500/[0.06] dark:bg-white/[0.05]'
              : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {activeAlerts.length > 0 ? (
                <Bell className="h-5 w-5 text-amber-500 dark:text-amber-400 shrink-0" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-[#056583] dark:text-[#cde0e6] shrink-0" />
              )}
              <div>
                <h2 className="font-mono text-xs font-bold uppercase tracking-[0.12em]">
                  Health Alerts · {activeAlerts.length} Active
                </h2>
                <p className="text-xs text-slate-600 dark:text-white/55">
                  {activeAlerts.length > 0
                    ? 'Significant deviations detected against your trailing 14-day baseline and clinical thresholds.'
                    : 'All monitored biometrics are currently within your 14-day baseline range.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {acknowledgedAlerts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAcknowledged((v) => !v)}
                  className="min-h-[36px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] px-3 py-1.5 font-mono text-[11px] uppercase hover:border-[#056583] transition-colors"
                >
                  {showAcknowledged ? 'Hide History' : `History (${acknowledgedAlerts.length})`}
                </button>
              )}
              {activeAlerts.length > 0 && (
                <button
                  type="button"
                  onClick={handleAcknowledgeAll}
                  disabled={acknowledgingId === 'all'}
                  className="min-h-[36px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] px-3 py-1.5 font-mono text-[11px] uppercase hover:border-[#056583] transition-colors disabled:opacity-60"
                >
                  {acknowledgingId === 'all' ? 'Clearing...' : 'Acknowledge All'}
                </button>
              )}
            </div>
          </div>

          {activeAlerts.length > 0 && (
            <div className="mt-4 space-y-3">
              {activeAlerts.map((alert) => {
                const isCritical = alert.severity === 'critical';
                return (
                  <div
                    key={alert.id}
                    className={`rounded-[20px] border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      isCritical
                        ? 'border-rose-500/50 bg-rose-500/10'
                        : 'border-amber-500/40 bg-amber-500/10'
                    }`}
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase">
                        <span
                          className={`font-bold ${
                            isCritical
                              ? 'text-rose-600 dark:text-rose-300'
                              : 'text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {isCritical ? 'CRITICAL ▲▲' : alert.severity === 'warning' ? 'WARNING ▲' : 'INFO ●'}
                        </span>
                        <span className="text-slate-400 dark:text-white/30">·</span>
                        <span className="text-slate-700 dark:text-[#cde0e6]">
                          {alert.metric_type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-slate-400 dark:text-white/30">·</span>
                        <span className="tabular-nums text-slate-600 dark:text-white/55">
                          {alert.detected_at.slice(0, 10)}
                        </span>
                      </div>
                      <p className="text-sm font-semibold">{alert.title}</p>
                      <p className="text-xs leading-relaxed text-slate-700 dark:text-white/75">
                        {alert.message}
                      </p>
                      <p className="font-mono text-[11px] tabular-nums text-slate-600 dark:text-white/55">
                        Latest: {formatAlertValue(alert.metric_type, alert.current_value, alert.unit)} · Baseline:{' '}
                        {formatAlertValue(alert.metric_type, alert.baseline_value, alert.unit)} (
                        {alert.delta_pct > 0 ? `+${alert.delta_pct}` : alert.delta_pct}%)
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAcknowledge(alert.id)}
                      disabled={acknowledgingId === alert.id}
                      className="min-h-[40px] shrink-0 inline-flex items-center justify-center gap-1.5 rounded-[16px] border border-slate-300 dark:border-white/[0.14] bg-white dark:bg-white/[0.06] px-4 py-2 font-mono text-[11px] font-bold uppercase hover:border-[#056583] transition-colors"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {acknowledgingId === alert.id ? 'Saving...' : 'Acknowledge'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {showAcknowledged && acknowledgedAlerts.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/[0.08] space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/40">
                Recently Acknowledged Deviations
              </p>
              {acknowledgedAlerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-white/60 py-1.5 border-b border-slate-100 dark:border-white/[0.05] last:border-none"
                >
                  <span className="font-medium text-slate-700 dark:text-white/85">{alert.title}</span>
                  <span className="font-mono text-[11px] tabular-nums">
                    {formatAlertValue(alert.metric_type, alert.current_value, alert.unit)} · Ack{' '}
                    {alert.acknowledged_at?.slice(0, 10)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Variation 3 Hero Intelligence Card */}
      <section className="relative rounded-[32px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] backdrop-blur-md p-8 sm:p-12">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <div className="max-w-xl">
            <span className="block font-mono text-xs uppercase tracking-[0.2em] text-[#056583] dark:text-[#69A3B5]">
              Composite Wellness Index
            </span>
            <div className="mt-4 mb-6 font-light text-7xl sm:text-[6.5rem] leading-none tabular-nums text-slate-900 dark:text-white">
              {evaluation ? evaluation.overallScore : '—'}
            </div>
            <p className="text-sm sm:text-base leading-relaxed text-slate-600 dark:text-white/70">
              {evaluation?.summary ||
                'Composite wellness index across connected biometrics and laboratory data.'}
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-6">
              <button
                type="button"
                onClick={() => onNavigate('ai')}
                className="min-h-[46px] rounded-[20px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-8 py-3 text-xs font-semibold uppercase tracking-[0.1em] hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                {evaluation ? 'Open Evaluation' : 'Run Evaluation'}
              </button>
              <div className="font-mono text-[11px] leading-relaxed text-slate-500 dark:text-white/40 uppercase">
                <div>Dupes Resolved: {String(snapshot?.suppressedDuplicatesCount || 0).padStart(2, '0')}</div>
                <div>Informational only · Not medical advice</div>
              </div>
            </div>
          </div>

          {evaluation && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 lg:w-[360px] shrink-0">
              {[
                { label: 'Cardio', score: evaluation.subScores.cardiovascular },
                { label: 'Sleep', score: evaluation.subScores.sleep },
                { label: 'Activity', score: evaluation.subScores.activity },
                { label: 'Nutrition', score: evaluation.subScores.nutrition },
                { label: 'Labs', score: evaluation.subScores.metabolicLabs },
                { label: 'Recovery', score: evaluation.subScores.recoveryStress },
              ].map((sub) => (
                <div key={sub.label}>
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-slate-500 dark:text-white/55 uppercase">{sub.label}</span>
                    <span className="tabular-nums font-semibold text-slate-900 dark:text-white">
                      {sub.score}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 dark:bg-white/[0.1] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#056583] dark:bg-[#cde0e6]"
                      style={{ width: `${sub.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Telemetry Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-[#cde0e6]">
          Biometric Telemetry
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-[16px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] p-1">
            {[7, 30, 90].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => onRangeChange(days)}
                className={`min-h-[34px] rounded-[12px] px-3 py-1 font-mono text-[11px] font-semibold transition-colors whitespace-nowrap ${
                  rangeDays === days
                    ? 'bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11]'
                    : 'text-slate-600 dark:text-white/55 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {days}D
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onOpenBodyProfileModal}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-[16px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] px-3.5 py-1.5 font-mono text-[11px] uppercase hover:border-[#056583] transition-colors whitespace-nowrap"
          >
            <Ruler className="h-3.5 w-3.5" /> Height & Weight
          </button>

          <button
            type="button"
            onClick={onOpenLogModal}
            className="xl:hidden min-h-[38px] inline-flex items-center gap-1.5 rounded-[16px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] px-3.5 py-1.5 font-mono text-[11px] uppercase hover:border-[#056583] transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" /> Log Vital
          </button>

          <button
            type="button"
            onClick={onRefresh}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-[16px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] px-3.5 py-1.5 font-mono text-[11px] uppercase hover:border-[#056583] transition-colors whitespace-nowrap"
            aria-label="Refresh telemetry"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Sync
          </button>
        </div>
      </div>

      {/* Variation 3 Three-Column Glass Metric Card Grid */}
      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="rounded-[28px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-7 transition-all duration-300 hover:border-[#056583] dark:hover:bg-white/[0.08]"
          >
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500 dark:text-white/40">
                {card.label}
              </span>
              {card.editableBody && (
                <button
                  type="button"
                  onClick={onOpenBodyProfileModal}
                  className="font-mono text-[10px] uppercase text-[#056583] dark:text-[#cde0e6] hover:underline"
                >
                  Edit & Sync
                </button>
              )}
            </div>
            <span className="block text-4xl font-semibold tabular-nums text-slate-900 dark:text-white">
              {card.val}
            </span>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-400 dark:text-white/35">
              <span>{card.unit}</span>
              <span className="font-mono text-[10px] truncate">{card.meta}</span>
            </div>
          </div>
        ))}
      </section>

      {/* Interactive Longitudinal Trend Explorer */}
      <section className="rounded-[28px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-base font-semibold">Normalized Telemetry Trend</h3>
            <p className="text-xs text-slate-500 dark:text-white/50">
              Primary conflict-resolved values across connected wearables and logs
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {metricConfigs.map((cfg) => (
              <button
                key={cfg.key}
                type="button"
                onClick={() => setSelectedMetric(cfg.key)}
                className={`min-h-[34px] rounded-[14px] px-3 py-1 font-mono text-[11px] border transition-colors whitespace-nowrap ${
                  selectedMetric === cfg.key
                    ? 'bg-[#056583] border-[#056583] text-white dark:bg-[#cde0e6] dark:border-[#cde0e6] dark:text-[#090e11] font-semibold'
                    : 'border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-white/55 hover:border-[#056583]'
                }`}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        <TrendLineChart
          data={metricSeries}
          unit={activeConfig.unit}
          primaryLabel={activeConfig.label}
          primaryColor="#056583"
        />
      </section>
    </div>
  );
}
