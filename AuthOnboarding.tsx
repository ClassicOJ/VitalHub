import { ShieldCheck, Lock, ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import type { AuthUser, UserRole } from '../types';

interface AuthScreenProps {
  onAuthenticated: (user: AuthUser) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'individual' | 'professional'>('individual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login' ? { email, password } : { name, email, password, role };
      const data = await apiFetch<{ user: AuthUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onAuthenticated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async (demoRole: UserRole) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ user: AuthUser }>('/api/auth/demo', {
        method: 'POST',
        body: JSON.stringify({ role: demoRole }),
      });
      onAuthenticated(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demo workspace');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-50 dark:bg-[#090e11] text-slate-900 dark:text-[#f8f9fa] flex items-center justify-center p-4 sm:p-8 overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute -top-[200px] -right-[100px] h-[600px] w-[600px] rounded-full opacity-10 dark:opacity-30 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #056583 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-[200px] -left-[100px] h-[600px] w-[600px] rounded-full opacity-10 dark:opacity-25 blur-[120px]"
          style={{ background: 'radial-gradient(circle, #056583 0%, transparent 70%)' }}
        />
      </div>
      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Calm editorial introduction column */}
        <div className="lg:col-span-6 flex flex-col justify-between rounded-[32px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] backdrop-blur-xl p-6 sm:p-10">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.16em] text-[#056583] dark:text-[#cde0e6]">
              VitalHub Intelligence
            </p>
            <h1 className="mt-4 text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
              One calm record for every health signal.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-600 dark:text-white/70">
              Unify wearables, Strava activities, nutrition logs, and encrypted lab panels into a single
              timeline. Share strictly scoped views with your physician, coach, or dietician.
            </p>
          </div>

          <div className="mt-8 space-y-4 border-t border-slate-200 dark:border-white/[0.08] pt-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-[#056583] dark:text-[#cde0e6] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Explicit consent and source priority
                </p>
                <p className="text-sm text-slate-600 dark:text-white/55">
                  Automatic conflict resolution across HealthKit, Health Connect, and Strava prevents double counting.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Lock className="h-5 w-5 text-[#056583] dark:text-[#cde0e6] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Field-encrypted labs and one-tap revoke
                </p>
                <p className="text-sm text-slate-600 dark:text-white/55">
                  Original PDFs and images stay encrypted at rest; every clinician access is logged.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Auth & instant role switcher column */}
        <div className="lg:col-span-6 rounded-[32px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] backdrop-blur-xl p-6 sm:p-10 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-semibold">
                {mode === 'login' ? 'Sign in to VitalHub' : 'Create your account'}
              </h2>
              <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-900 p-1">
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                    mode === 'login'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                    mode === 'register'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Register
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Rivera"
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 text-sm focus:border-teal-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                      Account Role
                    </label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'individual' | 'professional')}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131A] px-3.5 text-sm focus:border-teal-500 focus:outline-none"
                    >
                      <option value="individual">Individual Member</option>
                      <option value="professional">Doctor / Coach / Dietician</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3.5 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[46px] rounded-[20px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider"
              >
                <span>{loading ? 'Signing in...' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="mt-8 border-t border-slate-200 dark:border-slate-800 pt-6">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">
              Explore pre-seeded demo workspaces
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemo('individual')}
                className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-left hover:border-teal-500/60 transition-colors"
              >
                <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">Maya Lin</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Individual</span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemo('professional')}
                className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-left hover:border-teal-500/60 transition-colors"
              >
                <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">Dr. Elena</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Physician</span>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleDemo('admin')}
                className="min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-left hover:border-teal-500/60 transition-colors"
              >
                <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">Jordan Park</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">Admin</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface OnboardingProps {
  user: AuthUser;
  onComplete: (user: AuthUser) => void;
}

export function OnboardingConsentScreen({ user, onComplete }: OnboardingProps) {
  const [consents, setConsents] = useState({
    vitals: true,
    sleep: true,
    activity: true,
    nutrition: true,
    labs: true,
    aiInsights: true,
  });
  const [saving, setSaving] = useState(false);

  const toggle = (key: keyof typeof consents) => {
    setConsents((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ user: AuthUser }>('/api/auth/consent', {
        method: 'POST',
        body: JSON.stringify({
          consentFlags: { ...consents, consentedAt: new Date().toISOString() },
          completeOnboarding: true,
        }),
      });
      onComplete(res.user);
    } finally {
      setSaving(false);
    }
  };

  const items: Array<{ key: keyof typeof consents; title: string; desc: string }> = [
    { key: 'vitals', title: 'Heart, BP & Blood Glucose Vitals', desc: 'Ingest normalized resting HR, HRV, SpO2, BP, and glucose.' },
    { key: 'sleep', title: 'Sleep Architecture', desc: 'Store nightly sleep stages (Deep, REM, Light, Awake) from wearables.' },
    { key: 'activity', title: 'Workouts & Activity', desc: 'Sync runs, rides, and workouts from Strava, HealthKit, or Health Connect.' },
    { key: 'nutrition', title: 'Meals & Hydration', desc: 'Track calories, macros, micronutrients, and daily water intake.' },
    { key: 'labs', title: 'Encrypted Lab Reports', desc: 'Upload PDFs or photos for OCR extraction with AES-256-GCM storage.' },
    { key: 'aiInsights', title: 'Pseudonymized AI Evaluation', desc: 'Generate wellness evaluations without sending your name or email.' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090e11] text-slate-900 dark:text-[#f8f9fa] flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-[32px] border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] backdrop-blur-xl p-6 sm:p-10">
        <p className="text-xs font-mono uppercase tracking-[0.14em] text-[#056583] dark:text-[#cde0e6]">
          Welcome, {user.name} · Privacy & Consent
        </p>
        <h1 className="mt-2 text-2xl sm:text-3xl font-semibold">
          Choose which health categories VitalHub may process
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-white/60">
          We collect only the categories you enable below. You can change consents, export your data, or
          delete everything anytime in Settings.
        </p>

        <div className="mt-6 divide-y divide-slate-200 dark:divide-white/[0.08] border-y border-slate-200 dark:border-white/[0.08]">
          {items.map((item) => (
            <label
              key={item.key}
              className="flex items-center justify-between gap-4 py-4 cursor-pointer min-h-[60px]"
            >
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{item.title}</p>
                <p className="text-xs text-slate-500 dark:text-white/55 mt-0.5">{item.desc}</p>
              </div>
              <input
                type="checkbox"
                checked={consents[item.key]}
                onChange={() => toggle(item.key)}
                className="h-5 w-5 accent-[#056583] rounded cursor-pointer shrink-0"
              />
            </label>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500 dark:text-white/50">
            Informational wellness tool · Not medical advice
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="min-h-[44px] rounded-[20px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-6 py-2.5 text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            {saving ? 'Saving...' : 'Save Consent & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
