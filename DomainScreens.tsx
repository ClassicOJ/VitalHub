import { Plus, Upload } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import type { HealthSnapshot } from '../types';
import { SleepStagesChart, TrendLineChart, type SleepStageBar } from './Charts';

export function ActivityScreen({
  snapshot,
  onNavigate,
}: {
  snapshot: HealthSnapshot | null;
  onNavigate: (tab: string) => void;
}) {
  const [showSuperseded, setShowSuperseded] = useState(false);

  const allActivities = snapshot?.activities || [];
  const primaryActivities = allActivities.filter((a) => a.is_primary === 1);
  const displayed = showSuperseded ? allActivities : primaryActivities;

  if (allActivities.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-10 text-center">
        <h3 className="text-lg font-semibold">No workouts synced yet</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Connect Strava, Apple HealthKit, or Google Health Connect to aggregate runs, rides, and workouts.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('sources')}
          className="mt-5 min-h-[44px] rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Connect Activity Source
        </button>
      </div>
    );
  }

  const totalDistanceKm = primaryActivities.reduce((s, a) => s + a.distance_m / 1000, 0);
  const totalMinutes = Math.round(primaryActivities.reduce((s, a) => s + a.duration_sec / 60, 0));
  const totalElevation = Math.round(primaryActivities.reduce((s, a) => s + a.elevation_gain_m, 0));
  const suppressedCount = allActivities.length - primaryActivities.length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Physical Activity & Training</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Strava prioritized over wearable duplicates · {suppressedCount} overlapping record{suppressedCount === 1 ? '' : 's'} deduplicated
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSuperseded((v) => !v)}
          className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-2 text-xs font-medium hover:border-teal-500 whitespace-nowrap"
        >
          {showSuperseded ? 'Hide Superseded Duplicates' : `Inspect Superseded (${suppressedCount})`}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Workouts</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">{primaryActivities.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Distance</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">
            {totalDistanceKm.toFixed(1)} <span className="text-xs text-slate-400">km</span>
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Active Time</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">
            {totalMinutes} <span className="text-xs text-slate-400">min</span>
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Elevation Gain</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">
            {totalElevation} <span className="text-xs text-slate-400">m</span>
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Workout</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium text-right">Duration</th>
              <th className="px-4 py-3 font-medium text-right">Distance</th>
              <th className="px-4 py-3 font-medium text-right">Pace</th>
              <th className="px-4 py-3 font-medium text-right">Avg HR</th>
              <th className="px-4 py-3 font-medium">Source & Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {displayed.map((a) => {
              const paceStr = a.avg_pace_sec_per_km
                ? `${Math.floor(a.avg_pace_sec_per_km / 60)}:${String(a.avg_pace_sec_per_km % 60).padStart(2, '0')} /km`
                : '—';
              return (
                <tr key={a.id} className={a.is_primary === 0 ? 'opacity-50' : ''}>
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{a.title}</p>
                    <p className="text-xs text-slate-500">{a.activity_type}</p>
                  </td>
                  <td className="px-4 py-3.5 font-mono tabular-nums text-xs text-slate-400">
                    {a.start_time.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    {Math.round(a.duration_sec / 60)} min
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    {(a.distance_m / 1000).toFixed(2)} km
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums text-xs">{paceStr}</td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                    {a.avg_hr ? `${Math.round(a.avg_hr)} bpm` : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-slate-500 dark:text-slate-400">
                    {a.source_provider} · {a.is_primary === 1 ? 'Primary' : 'Superseded Duplicate'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SleepScreen({
  snapshot,
  onNavigate,
}: {
  snapshot: HealthSnapshot | null;
  onNavigate: (tab: string) => void;
}) {
  const metrics = snapshot?.metrics || [];
  const byDate: Record<string, SleepStageBar & { rhr?: number }> = {};

  for (const m of metrics) {
    const day = m.timestamp.slice(0, 10);
    if (!byDate[day]) byDate[day] = { date: day, deep: 0, rem: 0, light: 0, awake: 0 };
    if (m.type === 'sleep_deep') byDate[day].deep = Math.round(m.canonical_value);
    if (m.type === 'sleep_rem') byDate[day].rem = Math.round(m.canonical_value);
    if (m.type === 'sleep_light') byDate[day].light = Math.round(m.canonical_value);
    if (m.type === 'sleep_awake') byDate[day].awake = Math.round(m.canonical_value);
    if (m.type === 'resting_hr') byDate[day].rhr = Math.round(m.canonical_value);
  }

  const nights = Object.values(byDate)
    .filter((n) => n.deep + n.rem + n.light > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (nights.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-10 text-center">
        <h3 className="text-lg font-semibold">No sleep data recorded yet</h3>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Sync Apple HealthKit or Google Health Connect to visualize sleep stages and resting heart rate recovery.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('sources')}
          className="mt-5 min-h-[44px] rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950"
        >
          Connect Sleep Source
        </button>
      </div>
    );
  }

  const avgTotalMin = Math.round(
    nights.reduce((s, n) => s + n.deep + n.rem + n.light, 0) / nights.length
  );
  const avgDeep = Math.round(nights.reduce((s, n) => s + n.deep, 0) / nights.length);
  const avgRem = Math.round(nights.reduce((s, n) => s + n.rem, 0) / nights.length);

  const correlationSeries = nights.map((n) => ({
    label: n.date.slice(5),
    value: Number(((n.deep + n.rem + n.light) / 60).toFixed(1)),
    secondaryValue: n.rhr,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Sleep Architecture & Recovery</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Color-blind-safe stage breakdown and overnight resting heart rate correlation
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Average Asleep</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">
            {Math.floor(avgTotalMin / 60)}h {avgTotalMin % 60}m
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Average Deep Sleep</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">
            {avgDeep} <span className="text-xs text-slate-400">min</span>
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Average REM Sleep</p>
          <p className="mt-2 text-2xl font-semibold font-mono tabular-nums">
            {avgRem} <span className="text-xs text-slate-400">min</span>
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6">
        <h3 className="text-base font-semibold mb-4">Nightly Sleep Stages</h3>
        <SleepStagesChart nights={nights.slice(-21)} />
      </section>

      <section className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6">
        <h3 className="text-base font-semibold mb-1">Sleep Duration vs. Resting Heart Rate</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Solid line shows hours slept; dashed line tracks next-morning resting HR (bpm)
        </p>
        <TrendLineChart
          data={correlationSeries}
          unit="hrs"
          secondaryUnit="bpm"
          primaryLabel="Sleep Duration"
          secondaryLabel="Resting HR"
        />
      </section>
    </div>
  );
}

export function NutritionScreen({
  snapshot,
  onRefresh,
}: {
  snapshot: HealthSnapshot | null;
  onRefresh: () => Promise<void>;
}) {
  const meals = snapshot?.meals || [];
  const [mealType, setMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('lunch');
  const [title, setTitle] = useState('');
  const [calories, setCalories] = useState('520');
  const [proteinG, setProteinG] = useState('34');
  const [carbsG, setCarbsG] = useState('48');
  const [fatG, setFatG] = useState('18');
  const [fiberG, setFiberG] = useState('9');
  const [waterMl, setWaterMl] = useState('450');
  const [submitting, setSubmitting] = useState(false);

  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvText, setCsvText] = useState(
    `date,meal_type,title,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,water_ml\n${new Date().toISOString().slice(0, 10)},dinner,Miso glazed tofu & brown rice bowl,560,32,64,18,10,640,500`
  );
  const [csvStatus, setCsvStatus] = useState<string | null>(null);

  const handleLogMeal = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/meals', {
        method: 'POST',
        body: JSON.stringify({
          mealType,
          title,
          calories: Number(calories),
          proteinG: Number(proteinG),
          carbsG: Number(carbsG),
          fatG: Number(fatG),
          fiberG: Number(fiberG),
          waterMl: Number(waterMl),
        }),
      });
      setTitle('');
      await onRefresh();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvImport = async () => {
    setSubmitting(true);
    try {
      const res = await apiFetch<{ importedCount: number }>('/api/meals/import-csv', {
        method: 'POST',
        body: JSON.stringify({ csvText }),
      });
      setCsvStatus(`Imported ${res.importedCount} meal rows from CSV.`);
      setShowCsvModal(false);
      await onRefresh();
    } catch (err) {
      setCsvStatus(err instanceof Error ? err.message : 'CSV import failed');
    } finally {
      setSubmitting(false);
    }
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMeals = meals.filter((m) => m.logged_at.startsWith(todayIso));
  const summarySource = todayMeals.length > 0 ? todayMeals : meals.slice(0, 3);

  const totals = summarySource.reduce(
    (acc, m) => ({
      calories: acc.calories + Number(m.calories || 0),
      protein: acc.protein + Number(m.protein_g || 0),
      carbs: acc.carbs + Number(m.carbs_g || 0),
      fat: acc.fat + Number(m.fat_g || 0),
      fiber: acc.fiber + Number(m.fiber_g || 0),
      water: acc.water + Number(m.water_ml || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, water: 0 }
  );

  const macroGramsTotal = Math.max(1, totals.protein + totals.carbs + totals.fat);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Nutrition, Macros & Hydration</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Ingested via Health Connect / HealthKit nutrition records, CSV import, and manual logging
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCsvModal(true)}
          className="min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium hover:border-teal-500 whitespace-nowrap"
        >
          <Upload className="h-3.5 w-3.5" /> Import Nutrition CSV
        </button>
      </div>

      {csvStatus && (
        <div className="rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
          {csvStatus}
        </div>
      )}

      {/* Daily Summary & Macro Balance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-5">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {todayMeals.length > 0 ? "Today's Intake" : 'Recent Meals Snapshot'}
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-3xl font-semibold font-mono tabular-nums">
                {Math.round(totals.calories).toLocaleString()}
              </span>
              <span className="text-xs font-mono text-slate-400">kcal</span>
            </div>
          </div>

          <div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                style={{ width: `${(totals.protein / macroGramsTotal) * 100}%` }}
                className="bg-[#2DD4BF]"
                title="Protein"
              />
              <div
                style={{ width: `${(totals.carbs / macroGramsTotal) * 100}%` }}
                className="bg-[#38BDF8]"
                title="Carbohydrates"
              />
              <div
                style={{ width: `${(totals.fat / macroGramsTotal) * 100}%` }}
                className="bg-[#F59E0B]"
                title="Fat"
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Protein</span>
                <span className="font-mono tabular-nums font-semibold text-[#2DD4BF]">
                  {Math.round(totals.protein)}g
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Carbs</span>
                <span className="font-mono tabular-nums font-semibold text-[#38BDF8]">
                  {Math.round(totals.carbs)}g
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block">Fat</span>
                <span className="font-mono tabular-nums font-semibold text-[#F59E0B]">
                  {Math.round(totals.fat)}g
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-t border-slate-200 dark:border-slate-800 pt-4 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400 block">Dietary Fiber</span>
              <span className="mt-1 block text-base font-mono tabular-nums font-semibold">
                {Math.round(totals.fiber)} g
              </span>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400 block">Hydration</span>
              <span className="mt-1 block text-base font-mono tabular-nums font-semibold">
                {Math.round(totals.water)} ml
              </span>
            </div>
          </div>
        </div>

        {/* Manual Meal Logger */}
        <form
          onSubmit={handleLogMeal}
          className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6 space-y-4"
        >
          <h3 className="text-base font-semibold">Log a Meal</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Meal Type</label>
              <select
                value={mealType}
                onChange={(e) => setMealType(e.target.value as typeof mealType)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0D131A] px-3 text-sm"
              >
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="dinner">Dinner</option>
                <option value="snack">Snack</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">Description</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Grilled chicken bowl with farro & greens"
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {[
              { label: 'kcal', val: calories, set: setCalories },
              { label: 'Protein (g)', val: proteinG, set: setProteinG },
              { label: 'Carbs (g)', val: carbsG, set: setCarbsG },
              { label: 'Fat (g)', val: fatG, set: setFatG },
              { label: 'Fiber (g)', val: fiberG, set: setFiberG },
              { label: 'Water (ml)', val: waterMl, set: setWaterMl },
            ].map((f) => (
              <div key={f.label}>
                <label className="block text-[11px] text-slate-500 mb-1 truncate">{f.label}</label>
                <input
                  type="number"
                  min="0"
                  value={f.val}
                  onChange={(e) => f.set(e.target.value)}
                  className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-2.5 text-sm font-mono tabular-nums"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[42px] inline-flex items-center gap-2 rounded-[16px] bg-[#056583] text-white dark:bg-[#cde0e6] dark:text-[#090e11] px-5 py-2 text-xs font-bold hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> {submitting ? 'Saving...' : 'Save Meal'}
            </button>
          </div>
        </form>
      </div>

      {/* Meal Log Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] overflow-x-auto">
        {meals.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No meals logged yet. Use the form above or import a CSV export.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Meal</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium text-right">Calories</th>
                <th className="px-4 py-3 font-medium text-right">P / C / F (g)</th>
                <th className="px-4 py-3 font-medium text-right">Water</th>
                <th className="px-4 py-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {meals.slice(0, 20).map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{m.title}</p>
                    <p className="text-xs text-slate-500 capitalize">{m.meal_type}</p>
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-xs text-slate-400">
                    {m.logged_at.slice(0, 10)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {Math.round(m.calories)} kcal
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                    {Math.round(m.protein_g)} / {Math.round(m.carbs_g)} / {Math.round(m.fat_g)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-xs">
                    {Math.round(m.water_ml)} ml
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{m.source_provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.05] p-6">
            <h3 className="text-lg font-semibold">Import Meals via CSV</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Paste CSV rows exported from MyFitnessPal, Cronometer, or Healthify.
            </p>
            <textarea
              rows={7}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#0A0F14] p-3 font-mono text-xs"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCsvModal(false)}
                className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCsvImport}
                className="min-h-[42px] rounded-xl bg-teal-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400"
              >
                Import CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
