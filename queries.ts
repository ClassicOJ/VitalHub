import { listHealthAlerts } from './alerts.ts';
import { db } from './db.ts';
import { checkSafetyEscalation } from './normalization.ts';

export function buildUserHealthSnapshot(userId: string, rangeDays = 30) {
  const sinceIso = new Date(Date.now() - rangeDays * 86400000).toISOString();

  // Primary metrics (deduplicated via is_primary = 1)
  const primaryMetrics = db
    .prepare(
      `SELECT id, type, value, unit, canonical_value, canonical_unit, timestamp, source_provider, origin_app, confidence
       FROM metrics
       WHERE user_id = ? AND is_primary = 1 AND timestamp >= ?
       ORDER BY timestamp ASC`
    )
    .all(userId, sinceIso) as Array<{
    id: string;
    type: string;
    value: number;
    unit: string;
    canonical_value: number;
    canonical_unit: string;
    timestamp: string;
    source_provider: string;
    origin_app: string;
    confidence: number;
  }>;

  // Latest value per metric type
  const latestRows = db
    .prepare(
      `SELECT m1.type, m1.canonical_value, m1.canonical_unit, m1.timestamp, m1.source_provider, m1.origin_app
       FROM metrics m1
       INNER JOIN (
         SELECT type, MAX(timestamp) as max_ts
         FROM metrics
         WHERE user_id = ? AND is_primary = 1
         GROUP BY type
       ) m2 ON m1.type = m2.type AND m1.timestamp = m2.max_ts
       WHERE m1.user_id = ? AND m1.is_primary = 1`
    )
    .all(userId, userId) as Array<{
    type: string;
    canonical_value: number;
    canonical_unit: string;
    timestamp: string;
    source_provider: string;
    origin_app: string;
  }>;

  const latestByType: Record<
    string,
    { value: number; unit: string; timestamp: string; source: string; originApp: string }
  > = {};
  for (const r of latestRows) {
    latestByType[r.type] = {
      value: r.canonical_value,
      unit: r.canonical_unit,
      timestamp: r.timestamp,
      source: r.source_provider,
      originApp: r.origin_app,
    };
  }

  // Deduplication telemetry count (how many overlapping records were cleanly suppressed)
  const suppressedCount = (
    db
      .prepare('SELECT COUNT(*) as c FROM metrics WHERE user_id = ? AND is_primary = 0 AND timestamp >= ?')
      .get(userId, sinceIso) as { c: number }
  ).c;

  const activities = db
    .prepare(
      `SELECT id, external_id, source_provider, activity_type, title, start_time, duration_sec, distance_m, elevation_gain_m, calories, avg_hr, max_hr, avg_pace_sec_per_km, is_primary
       FROM activities
       WHERE user_id = ? AND start_time >= ?
       ORDER BY start_time DESC`
    )
    .all(userId, sinceIso) as Array<Record<string, unknown>>;

  const meals = db
    .prepare(
      `SELECT id, source_provider, meal_type, title, logged_at, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, water_ml, notes
       FROM meals
       WHERE user_id = ? AND logged_at >= ?
       ORDER BY logged_at DESC`
    )
    .all(userId, sinceIso) as Array<Record<string, unknown>>;

  const labReports = db
    .prepare(
      `SELECT id, title, lab_name, collected_at, file_name, mime_type, file_size, status, created_at
       FROM lab_reports
       WHERE user_id = ?
       ORDER BY collected_at DESC`
    )
    .all(userId) as Array<Record<string, unknown>>;

  const labResults = db
    .prepare(
      `SELECT id, report_id, test_name, test_code, value, unit, reference_low, reference_high, reference_text, flag, confirmed, collected_at
       FROM lab_results
       WHERE user_id = ? AND confirmed = 1
       ORDER BY collected_at DESC`
    )
    .all(userId) as Array<{
    id: string;
    report_id: string;
    test_name: string;
    test_code: string;
    value: number;
    unit: string;
    reference_low: number | null;
    reference_high: number | null;
    reference_text: string;
    flag: string;
    confirmed: number;
    collected_at: string;
  }>;

  const latestEvalRow = db
    .prepare('SELECT * FROM ai_evaluations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId) as Record<string, unknown> | undefined;

  const latestEval = latestEvalRow
    ? {
        id: latestEvalRow.id,
        overallScore: latestEvalRow.overall_score,
        subScores: JSON.parse(String(latestEvalRow.sub_scores_json)),
        summary: latestEvalRow.summary,
        strengths: JSON.parse(String(latestEvalRow.strengths_json)),
        concerns: JSON.parse(String(latestEvalRow.concerns_json)),
        trends: JSON.parse(String(latestEvalRow.trends_json)),
        correlations: JSON.parse(String(latestEvalRow.correlations_json)),
        recommendations: JSON.parse(String(latestEvalRow.recommendations_json)),
        escalationAlert: JSON.parse(String(latestEvalRow.escalation_alert_json)),
        disclaimer: latestEvalRow.disclaimer,
        modelUsed: latestEvalRow.model_used,
        createdAt: latestEvalRow.created_at,
      }
    : null;

  const safetyInput = {
    latestSystolicBp: latestByType.bp_systolic?.value ?? null,
    latestDiastolicBp: latestByType.bp_diastolic?.value ?? null,
    latestGlucoseMgDl: latestByType.glucose?.value ?? null,
    latestSpo2: latestByType.spo2?.value ?? null,
    criticalLabs: labResults
      .filter((l) => l.flag === 'critical_high' || l.flag === 'critical_low')
      .map((l) => ({ testName: l.test_name, value: l.value, unit: l.unit, flag: l.flag })),
  };

  const safetyEscalation = checkSafetyEscalation(safetyInput);
  const alerts = listHealthAlerts(userId);

  const userProfile = db
    .prepare('SELECT height_cm, weight_kg FROM users WHERE id = ?')
    .get(userId) as { height_cm: number | null; weight_kg: number | null } | undefined;

  const heightCm = userProfile?.height_cm ?? latestByType.height?.value ?? null;
  const weightKg = latestByType.weight?.value ?? userProfile?.weight_kg ?? null;
  const bmi =
    typeof heightCm === 'number' && heightCm > 0 && typeof weightKg === 'number' && weightKg > 0
      ? Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1))
      : (latestByType.bmi?.value ?? null);

  return {
    rangeDays,
    latestByType,
    metrics: primaryMetrics,
    suppressedDuplicatesCount: suppressedCount,
    activities,
    meals,
    labReports,
    labResults,
    latestEvaluation: latestEval,
    safetyInput,
    safetyEscalation,
    alerts,
    bodyProfile: {
      heightCm,
      weightKg,
      bmi,
    },
  };
}
