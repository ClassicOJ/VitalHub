import {
  Activity,
  Brain,
  CheckCircle2,
  FileSpreadsheet,
  HeartPulse,
  Link2,
  Lock,
  Menu,
  Moon,
  Ruler,
  Settings,
  Share2,
  Shield,
  Stethoscope,
  Utensils,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { AiInsightsScreen } from './components/AiInsightsScreen';
import { AuthScreen, OnboardingConsentScreen } from './components/AuthOnboarding';
import { ActivityScreen, NutritionScreen, SleepScreen } from './components/DomainScreens';
import { LabsScreen } from './components/LabsScreen';
import { OverviewDashboard } from './components/OverviewAndVitals';
import { AdminConsoleScreen, SettingsPrivacyScreen } from './components/SettingsAndAdminScreens';
import { ProfessionalViewScreen, SharingScreen } from './components/SharingAndProScreens';
import { SourcesScreen } from './components/SourcesScreen';
import { apiFetch } from './lib/api';
import type { AuthUser, HealthSnapshot, UserRole } from './types';

type TabKey =
  | 'overview'
  | 'sources'
  | 'activity'
  | 'sleep'
  | 'nutrition'
  | 'labs'
  | 'ai'
  | 'sharing'
  | 'pro'
  | 'settings'
  | 'admin';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [rangeDays, setRangeDays] = useState(30);
  const [darkMode, setDarkMode] = useState(true);
  const [largeType, setLargeType] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [biometricUnlocked, setBiometricUnlocked] = useState(true);

  // Shared Log Vital modal (accessible from Right Control Panel & Overview)
  const [showLogModal, setShowLogModal] = useState(false);
  const [logType, setLogType] = useState('bp_systolic');
  const [logVal, setLogVal] = useState('118');
  const [logUnit, setLogUnit] = useState('mmHg');
  const [savingMetric, setSavingMetric] = useState(false);

  // Body Profile (Height & Weight -> Connected Apps) modal
  const [showBodyModal, setShowBodyModal] = useState(false);
  const [heightInput, setHeightInput] = useState('');
  const [heightUnit, setHeightUnit] = useState<'cm' | 'in'>('cm');
  const [weightInput, setWeightInput] = useState('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [propagateBodySync, setPropagateBodySync] = useState(true);
  const [savingBody, setSavingBody] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [propagationReceipts, setPropagationReceipts] = useState<
    Array<{ provider: string; displayName: string; synced: boolean; detail: string }>
  >([]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) root.classList.add('dark');
    else root.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    document.documentElement.style.fontSize = largeType ? '18px' : '16px';
  }, [largeType]);

  const loadSnapshot = async (days = rangeDays) => {
    setLoadingSnapshot(true);
    try {
      const data = await apiFetch<HealthSnapshot>(`/api/dashboard?rangeDays=${days}`);
      setSnapshot(data);
    } finally {
      setLoadingSnapshot(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<{ user: AuthUser }>('/api/auth/me');
        setUser(res.user);
        setBiometricUnlocked(!res.user.biometricLockEnabled);
        if (res.user.role === 'professional') setActiveTab('pro');
        else if (res.user.role === 'admin') setActiveTab('admin');
        else setActiveTab('overview');
      } catch {
        setUser(null);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (user && user.role === 'individual' && user.onboardingCompleted) {
      loadSnapshot(rangeDays);
    }
  }, [user?.id, user?.onboardingCompleted, rangeDays]);

  const handleAuthenticated = (nextUser: AuthUser) => {
    setUser(nextUser);
    setBiometricUnlocked(!nextUser.biometricLockEnabled);
    if (nextUser.role === 'professional') setActiveTab('pro');
    else if (nextUser.role === 'admin') setActiveTab('admin');
    else setActiveTab('overview');
  };

  const handleSwitchDemoRole = async (role: UserRole) => {
    const res = await apiFetch<{ user: AuthUser }>('/api/auth/demo', {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    handleAuthenticated(res.user);
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setSnapshot(null);
  };

  const openBodyProfileModal = () => {
    const currentH = snapshot?.bodyProfile?.heightCm ?? user?.heightCm ?? null;
    const currentW = snapshot?.bodyProfile?.weightKg ?? user?.weightKg ?? null;
    setHeightUnit('cm');
    setWeightUnit('kg');
    setHeightInput(currentH !== null ? String(currentH) : '');
    setWeightInput(currentW !== null ? String(currentW) : '');
    setBodyError(null);
    setPropagationReceipts([]);
    setShowBodyModal(true);
  };

  const handleSaveBodyProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingBody(true);
    setBodyError(null);
    setPropagationReceipts([]);
    try {
      const res = await apiFetch<{
        user: AuthUser;
        bodyProfile: { heightCm: number | null; weightKg: number | null; bmi: number | null };
        propagationResults: Array<{ provider: string; displayName: string; synced: boolean; detail: string }>;
      }>('/api/profile/body-metrics', {
        method: 'POST',
        body: JSON.stringify({
          heightValue: heightInput.trim() ? Number(heightInput) : undefined,
          heightUnit,
          weightValue: weightInput.trim() ? Number(weightInput) : undefined,
          weightUnit,
          propagateToConnectedApps: propagateBodySync,
        }),
      });
      setUser(res.user);
      setPropagationReceipts(res.propagationResults || []);
      await loadSnapshot(rangeDays);
      if (!propagateBodySync || (res.propagationResults || []).length === 0) {
        setShowBodyModal(false);
      }
    } catch (err) {
      setBodyError(err instanceof Error ? err.message : 'Failed to update body metrics.');
    } finally {
      setSavingBody(false);
    }
  };

  const handleLogMetric = async (e: FormEvent) => {
    e.preventDefault();
    setSavingMetric(true);
    try {
      await apiFetch('/api/metrics', {
        method: 'POST',
        body: JSON.stringify({
          type: logType,
          value: Number(logVal),
          unit: logUnit,
        }),
      });
      setShowLogModal(false);
      if (user?.role === 'individual') {
        await loadSnapshot(rangeDays);
      }
    } finally {
      setSavingMetric(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#090e11] flex items-center justify-center font-mono text-xs uppercase tracking-[0.2em] text-[#cde0e6]">
        Loading VitalHub Intelligence...
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  if (user.role === 'individual' && !user.onboardingCompleted) {
    return <OnboardingConsentScreen user={user} onComplete={(u) => setUser(u)} />;
  }

  if (user.biometricLockEnabled && !biometricUnlocked) {
    return (
      <div className="min-h-screen bg-[#090e11] text-[#f8f9fa] flex items-center justify-center p-6 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none fixed -top-48 -right-24 h-[520px] w-[520px] rounded-full bg-[#056583] opacity-30 blur-[120px]"
        />
        <div className="relative z-10 max-w-sm w-full rounded-[32px] border border-white/[0.08] bg-white/[0.05] backdrop-blur-xl p-8 text-center space-y-4">
          <Lock className="h-8 w-8 text-[#cde0e6] mx-auto" />
          <h2 className="text-lg font-semibold">Session Locked</h2>
          <p className="text-xs text-white/55">
            Biometric / PIN privacy lock is active for {user.name}.
          </p>
          <button
            type="button"
            onClick={() => setBiometricUnlocked(true)}
            className="w-full min-h-[46px] rounded-[20px] bg-[#cde0e6] text-xs font-bold uppercase tracking-wider text-[#090e11] hover:bg-white transition-colors"
          >
            Unlock VitalHub
          </button>
        </div>
      </div>
    );
  }

  const individualNav: Array<{ key: TabKey; label: string; icon: typeof HeartPulse }> = [
    { key: 'overview', label: 'Dashboard', icon: HeartPulse },
    { key: 'sources', label: 'Sources', icon: Link2 },
    { key: 'activity', label: 'Activity', icon: Activity },
    { key: 'sleep', label: 'Sleep', icon: Moon },
    { key: 'nutrition', label: 'Nutrition', icon: Utensils },
    { key: 'labs', label: 'Labs', icon: FileSpreadsheet },
    { key: 'ai', label: 'AI Insights', icon: Brain },
    { key: 'sharing', label: 'Sharing', icon: Share2 },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  const professionalNav: Array<{ key: TabKey; label: string; icon: typeof HeartPulse }> = [
    { key: 'pro', label: 'Care Team View', icon: Stethoscope },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  const adminNav: Array<{ key: TabKey; label: string; icon: typeof HeartPulse }> = [
    { key: 'admin', label: 'Admin Console', icon: Shield },
    { key: 'pro', label: 'Care Team View', icon: Stethoscope },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  const navItems =
    user.role === 'professional'
      ? professionalNav
      : user.role === 'admin'
        ? adminNav
        : individualNav;

  const mobileBottomTabs =
    user.role === 'individual'
      ? [individualNav[0], individualNav[2], individualNav[5], individualNav[6]]
      : navItems.slice(0, 4);

  // Build Resting HR mini-sparkline with gradient fill (Variation 3 Control Panel)
  const rhrPoints = (snapshot?.metrics || [])
    .filter((m) => m.type === 'resting_hr')
    .slice(-14)
    .map((m) => m.canonical_value);
  const rhrMin = rhrPoints.length > 0 ? Math.min(...rhrPoints) : null;
  const rhrMax = rhrPoints.length > 0 ? Math.max(...rhrPoints) : null;
  const sparklineCoords =
    rhrPoints.length > 1
      ? rhrPoints
          .map((val, idx) => {
            const x = (idx / (rhrPoints.length - 1)) * 250;
            const span = Math.max((rhrMax ?? val) - (rhrMin ?? val), 1);
            const y = 72 - ((val - (rhrMin ?? val)) / span) * 52;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '0,52 250,52';
  const sparklineArea = `0,80 ${sparklineCoords} 250,80`;

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const activeAlerts = snapshot?.alerts?.active || [];

  return (
    <div className="relative min-h-screen w-full bg-slate-50 dark:bg-[#090e11] text-slate-900 dark:text-[#f8f9fa] flex flex-col lg:grid lg:grid-cols-[100px_1fr] xl:grid-cols-[100px_1fr_300px] overflow-x-hidden">
      {/* Variation 3 Ambient Liquid Background Orbs */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden no-print">
        <div
          className="absolute -top-[200px] -right-[100px] h-[600px] w-[600px] rounded-full opacity-10 dark:opacity-30 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #056583 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-[200px] -left-[100px] h-[600px] w-[600px] rounded-full opacity-10 dark:opacity-25 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #056583 0%, transparent 70%)' }}
        />
      </div>

      {/* Left Compact Icon Rail (Variation 3, Desktop lg+) */}
      <aside className="relative z-10 hidden lg:flex lg:flex-col lg:sticky lg:top-0 lg:h-screen items-center justify-between border-r border-slate-200 dark:border-white/[0.08] bg-white/80 dark:bg-black/30 backdrop-blur-xl py-7 no-print">
        <button
          type="button"
          onClick={() => setActiveTab(user.role === 'professional' ? 'pro' : user.role === 'admin' ? 'admin' : 'overview')}
          title="VitalHub Intelligence"
          aria-label="VitalHub Home"
          className="h-[54px] w-[54px] rounded-[20px] border border-[#056583]/30 bg-[#056583]/10 dark:bg-[#056583]/25 text-[#056583] dark:text-[#cde0e6] font-bold tracking-tighter text-sm flex items-center justify-center hover:scale-105 transition-transform"
        >
          VH
        </button>

        <nav className="flex flex-col items-center gap-2.5 overflow-y-auto py-2" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.key;
            const alertCount = item.key === 'overview' ? activeAlerts.length : 0;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                title={item.label}
                aria-label={item.label}
                className={`relative h-[52px] w-[52px] rounded-[20px] flex items-center justify-center border transition-all duration-200 ${
                  active
                    ? 'bg-slate-100 dark:bg-white/[0.08] text-[#056583] dark:text-[#cde0e6] border-slate-300 dark:border-white/[0.14] shadow-md scale-105'
                    : 'bg-transparent border-transparent text-slate-400 dark:text-white/40 hover:text-[#056583] dark:hover:text-[#cde0e6] hover:bg-slate-100/70 dark:hover:bg-white/[0.05] hover:border-slate-200 dark:hover:border-white/[0.08] hover:scale-105'
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={2} />
                {alertCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[#090e11] font-mono text-[10px] font-bold tabular-nums flex items-center justify-center">
                    {alertCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          title={`${user.name} (${user.role}) · Settings`}
          aria-label="Open profile and settings"
          className="h-11 w-11 rounded-full overflow-hidden border border-slate-200 dark:border-white/[0.12] hover:scale-105 transition-transform"
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[#056583] to-[#cde0e6] text-[#090e11] flex items-center justify-center font-bold text-xs">
              {initials}
            </div>
          )}
        </button>
      </aside>

      {/* Center Scrollable Main Viewport */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 pb-20 lg:pb-10">
        {/* Mobile Top Bar */}
        <header className="lg:hidden sticky top-0 z-30 h-14 border-b border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#090e11]/90 backdrop-blur-xl px-4 flex items-center justify-between gap-3 no-print">
          <span className="text-base font-bold tracking-[-0.04em] text-[#056583] dark:text-[#cde0e6]">
            VitalHub
          </span>
          <div className="flex items-center gap-2">
            {user.role === 'individual' && activeTab !== 'ai' && (
              <button
                type="button"
                onClick={() => setActiveTab('ai')}
                className="min-h-[36px] rounded-[14px] bg-[#056583] dark:bg-[#cde0e6] px-3.5 text-[11px] font-semibold uppercase tracking-wider text-white dark:text-[#090e11] whitespace-nowrap"
              >
                Ask My Data
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-[14px] border border-slate-300 dark:border-white/[0.1]"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-10">
          {activeTab === 'overview' && (
            <OverviewDashboard
              snapshot={snapshot}
              loading={loadingSnapshot}
              rangeDays={rangeDays}
              onRangeChange={(d) => setRangeDays(d)}
              onRefresh={() => loadSnapshot(rangeDays)}
              onNavigate={(tab) => setActiveTab(tab as TabKey)}
              onOpenLogModal={() => setShowLogModal(true)}
              onOpenBodyProfileModal={openBodyProfileModal}
            />
          )}
          {activeTab === 'sources' && <SourcesScreen onSynced={() => loadSnapshot(rangeDays)} />}
          {activeTab === 'activity' && (
            <ActivityScreen snapshot={snapshot} onNavigate={(tab) => setActiveTab(tab as TabKey)} />
          )}
          {activeTab === 'sleep' && (
            <SleepScreen snapshot={snapshot} onNavigate={(tab) => setActiveTab(tab as TabKey)} />
          )}
          {activeTab === 'nutrition' && (
            <NutritionScreen snapshot={snapshot} onRefresh={() => loadSnapshot(rangeDays)} />
          )}
          {activeTab === 'labs' && <LabsScreen onUpdated={() => loadSnapshot(rangeDays)} />}
          {activeTab === 'ai' && (
            <AiInsightsScreen snapshot={snapshot} onEvaluated={() => loadSnapshot(rangeDays)} />
          )}
          {activeTab === 'sharing' && <SharingScreen />}
          {activeTab === 'pro' && <ProfessionalViewScreen />}
          {activeTab === 'settings' && (
            <SettingsPrivacyScreen
              user={user}
              darkMode={darkMode}
              largeType={largeType}
              onToggleDarkMode={() => setDarkMode((d) => !d)}
              onToggleLargeType={() => setLargeType((l) => !l)}
              onUserUpdated={(u) => setUser(u)}
              onAccountPurged={() => {
                if (user.email.endsWith('@vitalhub.app')) {
                  loadSnapshot(rangeDays);
                  setActiveTab('overview');
                } else {
                  setUser(null);
                }
              }}
            />
          )}
          {activeTab === 'admin' && <AdminConsoleScreen />}
        </main>
      </div>

      {/* Right Glass Control Panel (Variation 3, Desktop xl+) */}
      <aside className="relative z-10 hidden xl:flex xl:flex-col xl:sticky xl:top-0 xl:h-screen border-l border-slate-200 dark:border-white/[0.08] bg-white/75 dark:bg-black/20 backdrop-blur-2xl p-7 justify-between no-print">
        <div className="space-y-4">
          {user.role === 'individual' && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('ai')}
                className="w-full min-h-[50px] rounded-[20px] border border-slate-200 dark:border-white/[0.08] bg-slate-100/80 dark:bg-white/[0.05] px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-900 dark:text-[#f8f9fa] hover:bg-[#056583] hover:border-[#056583] hover:text-white transition-all duration-200"
              >
                Ask My Data
              </button>
              <button
                type="button"
                onClick={() => setShowLogModal(true)}
                className="w-full min-h-[50px] rounded-[20px] border border-slate-200 dark:border-white/[0.08] bg-slate-100/80 dark:bg-white/[0.05] px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-900 dark:text-[#f8f9fa] hover:bg-[#056583] hover:border-[#056583] hover:text-white transition-all duration-200"
              >
                Log Vital Reading
              </button>
              <button
                type="button"
                onClick={openBodyProfileModal}
                className="w-full min-h-[50px] inline-flex items-center justify-center gap-2 rounded-[20px] border border-slate-200 dark:border-white/[0.08] bg-slate-100/80 dark:bg-white/[0.05] px-4 py-3 text-xs font-semibold uppercase tracking-[0.1em] text-slate-900 dark:text-[#f8f9fa] hover:bg-[#056583] hover:border-[#056583] hover:text-white transition-all duration-200"
              >
                <Ruler className="h-3.5 w-3.5" /> Height & Weight
              </button>
            </>
          )}

          {user.role === 'individual' && (
            <div className="pt-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-white/40">
                  Active Alerts
                </span>
                <span className="font-mono text-[11px] font-bold tabular-nums text-[#056583] dark:text-[#cde0e6]">
                  {activeAlerts.length}
                </span>
              </div>
              {activeAlerts.length > 0 ? (
                <div className="mt-2.5 space-y-2">
                  {activeAlerts.slice(0, 3).map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => setActiveTab('overview')}
                      className="w-full text-left rounded-[18px] border border-amber-500/40 bg-amber-500/10 p-3 hover:border-[#056583] transition-colors"
                    >
                      <p className="font-mono text-[10px] font-bold uppercase text-amber-600 dark:text-amber-300">
                        {alert.severity === 'critical' ? 'CRITICAL ▲▲' : 'WARNING ▲'} ·{' '}
                        {alert.metric_type.replace(/_/g, ' ')}
                      </p>
                      <p className="mt-0.5 text-xs font-medium truncate text-slate-900 dark:text-white">
                        {alert.title}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
                  ● ALL METRICS NOMINAL
                </p>
              )}
            </div>
          )}

          {user.role === 'individual' && (
            <div className="pt-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-white/40">
                HR Trend ({rangeDays}D)
              </p>
              <div className="mt-3 h-24 w-full border-b-2 border-[#056583] rounded-b-[4px] overflow-hidden">
                <svg viewBox="0 0 250 80" preserveAspectRatio="none" className="w-full h-full">
                  <defs>
                    <linearGradient id="v3-hr-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#056583" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#056583" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <polygon points={sparklineArea} fill="url(#v3-hr-grad)" />
                  <polyline
                    points={sparklineCoords}
                    fill="none"
                    stroke="#cde0e6"
                    className="stroke-[#056583] dark:stroke-[#cde0e6]"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[10px] tabular-nums text-slate-500 dark:text-white/40">
                <span>MIN: {rhrMin !== null ? rhrMin.toFixed(1) : '—'}</span>
                <span>MAX: {rhrMax !== null ? rhrMax.toFixed(1) : '—'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Bottom User Block (Variation 3) */}
        <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-white/[0.08]">
          <div className="flex items-center gap-3">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.name}
                referrerPolicy="no-referrer"
                className="h-12 w-12 rounded-full object-cover shrink-0 border border-white/15"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#056583] to-[#cde0e6] text-[#090e11] flex items-center justify-center font-extrabold text-sm shrink-0">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{user.name}</p>
              <p className="font-mono text-[10px] uppercase text-slate-500 dark:text-white/40 truncate">
                {user.role} Profile
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <select
              value={user.role}
              onChange={(e) => handleSwitchDemoRole(e.target.value as UserRole)}
              className="w-full min-h-[38px] rounded-[14px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] px-3 text-xs text-slate-900 dark:text-[#f8f9fa]"
            >
              <option value="individual" className="dark:bg-[#090e11]">Maya Lin (Individual)</option>
              <option value="professional" className="dark:bg-[#090e11]">Dr. Elena Vance (Physician)</option>
              <option value="admin" className="dark:bg-[#090e11]">Jordan Park (Admin)</option>
            </select>
            <button
              type="button"
              onClick={handleLogout}
              className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-white/45 hover:text-[#056583] dark:hover:text-[#cde0e6] underline cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Thumb-Zone Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 border-t border-slate-200 dark:border-white/[0.08] bg-white/95 dark:bg-[#090e11]/95 backdrop-blur-xl grid grid-cols-4 items-center no-print">
        {mobileBottomTabs.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveTab(item.key)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-1 ${
                active ? 'text-[#056583] dark:text-[#cde0e6]' : 'text-slate-500 dark:text-white/45'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Slide-Out Drawer */}
      {mobileDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end">
          <div className="w-72 bg-white dark:bg-[#090e11] h-full p-5 flex flex-col justify-between border-l border-slate-200 dark:border-white/[0.08] overflow-y-auto">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-white/[0.08]">
                <span className="font-bold tracking-tight text-base text-[#056583] dark:text-[#cde0e6]">
                  VitalHub
                </span>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-4 space-y-1.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.key);
                        setMobileDrawerOpen(false);
                      }}
                      className={`w-full min-h-[44px] rounded-[16px] flex items-center gap-3 px-3.5 text-xs uppercase tracking-wider ${
                        activeTab === item.key
                          ? 'text-[#056583] dark:text-[#cde0e6] font-bold bg-slate-100 dark:bg-white/[0.08]'
                          : 'text-slate-500 dark:text-white/50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-200 dark:border-white/[0.08] pt-4">
              <select
                value={user.role}
                onChange={(e) => {
                  handleSwitchDemoRole(e.target.value as UserRole);
                  setMobileDrawerOpen(false);
                }}
                className="w-full min-h-[42px] rounded-[14px] border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.05] px-3 text-xs"
              >
                <option value="individual" className="dark:bg-[#090e11]">Maya Lin (Individual)</option>
                <option value="professional" className="dark:bg-[#090e11]">Dr. Elena Vance (Physician)</option>
                <option value="admin" className="dark:bg-[#090e11]">Jordan Park (Admin)</option>
              </select>
              <button
                type="button"
                onClick={handleLogout}
                className="w-full min-h-[42px] text-left px-1 font-mono text-xs uppercase text-rose-400 underline"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body Profile (Height & Weight -> All Connected Apps) Modal */}
      {showBodyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0d1418]/95 backdrop-blur-2xl p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Height, Weight & Connected App Sync</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-white/55">
                  Updates your canonical profile, recalculates BMI, checks weight-shift alerts, and pushes
                  updates across every connected health app.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBodyModal(false)}
                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-[12px] border border-slate-200 dark:border-white/[0.1]"
                aria-label="Close body profile modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBodyProfile} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-mono text-[11px] uppercase text-slate-500 dark:text-white/50 mb-1">
                    Height
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.1"
                      placeholder={heightUnit === 'cm' ? '168.0' : '66.1'}
                      value={heightInput}
                      onChange={(e) => setHeightInput(e.target.value)}
                      className="w-full min-h-[44px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] bg-transparent px-3 text-sm font-mono tabular-nums"
                    />
                    <select
                      value={heightUnit}
                      onChange={(e) => setHeightUnit(e.target.value as 'cm' | 'in')}
                      className="min-h-[44px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] bg-white dark:bg-[#090e11] px-2.5 text-xs font-mono"
                    >
                      <option value="cm">cm</option>
                      <option value="in">in</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[11px] uppercase text-slate-500 dark:text-white/50 mb-1">
                    Weight
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.1"
                      placeholder={weightUnit === 'kg' ? '65.3' : '144.0'}
                      value={weightInput}
                      onChange={(e) => setWeightInput(e.target.value)}
                      className="w-full min-h-[44px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] bg-transparent px-3 text-sm font-mono tabular-nums"
                    />
                    <select
                      value={weightUnit}
                      onChange={(e) => setWeightUnit(e.target.value as 'kg' | 'lb')}
                      className="min-h-[44px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] bg-white dark:bg-[#090e11] px-2.5 text-xs font-mono"
                    >
                      <option value="kg">kg</option>
                      <option value="lb">lb</option>
                    </select>
                  </div>
                </div>
              </div>

              {(() => {
                const hRaw = Number(heightInput);
                const wRaw = Number(weightInput);
                const hCm = heightUnit === 'in' ? hRaw * 2.54 : hRaw;
                const wKg = weightUnit === 'lb' ? wRaw * 0.453592 : wRaw;
                if (Number.isFinite(hCm) && hCm > 0 && Number.isFinite(wKg) && wKg > 0) {
                  const previewBmi = (wKg / Math.pow(hCm / 100, 2)).toFixed(1);
                  return (
                    <div className="rounded-[16px] border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.04] px-4 py-2.5 flex items-center justify-between font-mono text-xs">
                      <span className="text-slate-500 dark:text-white/50">CALCULATED BMI PREVIEW</span>
                      <span className="font-bold tabular-nums text-[#056583] dark:text-[#cde0e6]">
                        {previewBmi} kg/m²
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

              <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-white/75 cursor-pointer">
                <input
                  type="checkbox"
                  checked={propagateBodySync}
                  onChange={(e) => setPropagateBodySync(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#056583]"
                />
                <span>
                  Propagate height & weight update to all currently connected apps (Apple HealthKit, Google
                  Health Connect, Strava, and nutrition partners)
                </span>
              </label>

              {bodyError && (
                <p className="text-xs font-mono text-rose-500 dark:text-rose-400">{bodyError}</p>
              )}

              {propagationReceipts.length > 0 && (
                <div className="rounded-[18px] border border-[#056583]/40 bg-[#056583]/15 p-3.5 space-y-2">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#056583] dark:text-[#cde0e6]">
                    Connected Apps Sync Receipts
                  </p>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {propagationReceipts.map((r) => (
                      <div
                        key={r.provider}
                        className="flex items-start gap-2 text-xs text-slate-700 dark:text-white/90"
                      >
                        <CheckCircle2
                          className={`h-4 w-4 shrink-0 mt-0.5 ${
                            r.synced ? 'text-emerald-500' : 'text-amber-500'
                          }`}
                        />
                        <div>
                          <span className="font-semibold">{r.displayName}: </span>
                          <span className="text-slate-600 dark:text-white/70">{r.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBodyModal(false)}
                  className="min-h-[42px] rounded-[16px] border border-slate-300 dark:border-white/[0.1] px-4 py-2 text-xs font-mono uppercase"
                >
                  {propagationReceipts.length > 0 ? 'Done' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingBody}
                  className="min-h-[42px] rounded-[16px] bg-[#056583] dark:bg-[#cde0e6] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white dark:text-[#090e11] hover:opacity-90 disabled:opacity-60"
                >
                  {savingBody ? 'Syncing Apps...' : 'Save & Sync Apps'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Vital Reading Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-[28px] border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0d1418]/95 backdrop-blur-2xl p-6 sm:p-7">
            <h3 className="text-lg font-semibold">Log Manual Vital Reading</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-white/55">
              Automatically converts units (e.g., lb to kg, mmol/L to mg/dL) and checks clinical thresholds.
            </p>
            <form onSubmit={handleLogMetric} className="mt-4 space-y-4">
              <div>
                <label className="block font-mono text-[11px] uppercase text-slate-500 dark:text-white/50 mb-1">
                  Metric Type
                </label>
                <select
                  value={logType}
                  onChange={(e) => {
                    const t = e.target.value;
                    setLogType(t);
                    if (t === 'bp_systolic' || t === 'bp_diastolic') setLogUnit('mmHg');
                    else if (t === 'glucose') setLogUnit('mg/dL');
                    else if (t === 'weight') setLogUnit('kg');
                    else if (t === 'spo2') setLogUnit('%');
                    else setLogUnit('bpm');
                  }}
                  className="w-full min-h-[44px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] bg-white dark:bg-[#090e11] px-3 text-sm"
                >
                  <option value="bp_systolic">Systolic Blood Pressure</option>
                  <option value="bp_diastolic">Diastolic Blood Pressure</option>
                  <option value="glucose">Blood Glucose</option>
                  <option value="weight">Body Weight</option>
                  <option value="resting_hr">Resting Heart Rate</option>
                  <option value="spo2">SpO2 Saturation</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-[11px] uppercase text-slate-500 dark:text-white/50 mb-1">
                    Value
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={logVal}
                    onChange={(e) => setLogVal(e.target.value)}
                    className="w-full min-h-[44px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] bg-transparent px-3 text-sm font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase text-slate-500 dark:text-white/50 mb-1">
                    Unit
                  </label>
                  <input
                    type="text"
                    required
                    value={logUnit}
                    onChange={(e) => setLogUnit(e.target.value)}
                    className="w-full min-h-[44px] rounded-[14px] border border-slate-300 dark:border-white/[0.1] bg-transparent px-3 text-sm font-mono"
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  className="min-h-[42px] rounded-[16px] border border-slate-300 dark:border-white/[0.1] px-4 py-2 text-xs font-mono uppercase"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingMetric}
                  className="min-h-[42px] rounded-[16px] bg-[#056583] dark:bg-[#cde0e6] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white dark:text-[#090e11] hover:opacity-90"
                >
                  {savingMetric ? 'Saving...' : 'Save Reading'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
