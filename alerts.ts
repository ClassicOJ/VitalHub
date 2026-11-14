import crypto from 'crypto';
import { db } from './db.ts';
import { detectMetricDeviations } from './normalization.ts';

const MONITORED_TYPES = [
  'resting_hr',
  'hrv',
  'bp_systolic',
  'bp_diastolic',
  'glucose',
  'spo2',
  'sleep_duration',
  'weight',
] as const;

export interface HealthAlertRecord {
  id: string;
  user_id: string;
  metric_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  current_value: number;
  baseline_value: number;
  unit: string;
  delta_pct: number;
  detected_at: string;
  acknowledged_at: string | null;
  dedup_key: string;
  created_at: string;
}

/**
 * Scan the user's latest primary metrics against trailing 14-day baselines
 * and persist any newly detected significant deviations in health_alerts.
 */
export function evaluateAndStoreHealthAlerts(userId: string): HealthAlertRecord[] {
  const newAlerts: HealthAlertRecord[] = [];
  const nowIso = new Date().toISOString();

  for (const metricType of MONITORED_TYPES) {
    const rows = db
      .prepare(
        `SELECT canonical_value, canonical_unit, timestamp
         FROM metrics
         WHERE user_id = ? AND type = ? AND is_primary = 1
         ORDER BY timestamp DESC
         LIMIT 15`
      )
      .all(userId, metricType) as Array<{
      canonical_value: number;
      canonical_unit: string;
      timestamp: string;
    }>;

    if (rows.length === 0) continue;

    const latest = rows[0];
    const baselineValues = rows.slice(1).map((r) => r.canonical_value);

    const alert = detectMetricDeviations({
      type: metricType,
      latestValue: latest.canonical_value,
      latestTimestamp: latest.timestamp,
      unit: latest.canonical_unit,
      baselineValues,
    });

    if (!alert) continue;

    const existing = db
      .prepare('SELECT id, current_value, acknowledged_at FROM health_alerts WHERE user_id = ? AND dedup_key = ?')
      .get(userId, alert.dedupKey) as
      | { id: string; current_value: number; acknowledged_at: string | null }
      | undefined;

    if (existing) {
      // If a worse reading arrived on the same day, update and re-surface it
      if (existing.current_value !== alert.currentValue) {
        db.prepare(
          `UPDATE health_alerts
           SET severity = ?, title = ?, message = ?, current_value = ?, baseline_value = ?,
               delta_pct = ?, detected_at = ?, acknowledged_at = NULL
           WHERE id = ?`
        ).run(
          alert.severity,
          alert.title,
          alert.message,
          alert.currentValue,
          alert.baselineValue,
          alert.deltaPct,
          alert.detectedAt,
          existing.id
        );
        const updated = db.prepare('SELECT * FROM health_alerts WHERE id = ?').get(existing.id) as HealthAlertRecord;
        newAlerts.push(updated);
      }
      continue;
    }

    const id = `alt_${crypto.randomUUID().slice(0, 12)}`;
    db.prepare(
      `INSERT INTO health_alerts
       (id, user_id, metric_type, severity, title, message, current_value, baseline_value, unit, delta_pct, detected_at, acknowledged_at, dedup_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      id,
      userId,
      alert.metricType,
      alert.severity,
      alert.title,
      alert.message,
      alert.currentValue,
      alert.baselineValue,
      alert.unit,
      alert.deltaPct,
      alert.detectedAt,
      alert.dedupKey,
      nowIso
    );
    const created = db.prepare('SELECT * FROM health_alerts WHERE id = ?').get(id) as HealthAlertRecord;
    newAlerts.push(created);
  }

  return newAlerts;
}

export function listHealthAlerts(userId: string): {
  active: HealthAlertRecord[];
  acknowledged: HealthAlertRecord[];
} {
  const all = db
    .prepare('SELECT * FROM health_alerts WHERE user_id = ? ORDER BY detected_at DESC, created_at DESC LIMIT 50')
    .all(userId) as HealthAlertRecord[];
  return {
    active: all.filter((a) => !a.acknowledged_at),
    acknowledged: all.filter((a) => Boolean(a.acknowledged_at)),
  };
}

export function acknowledgeHealthAlert(userId: string, alertId: string): boolean {
  const res = db
    .prepare('UPDATE health_alerts SET acknowledged_at = ? WHERE id = ? AND user_id = ?')
    .run(new Date().toISOString(), alertId, userId);
  return res.changes > 0;
}

export function acknowledgeAllHealthAlerts(userId: string): number {
  const res = db
    .prepare('UPDATE health_alerts SET acknowledged_at = ? WHERE user_id = ? AND acknowledged_at IS NULL')
    .run(new Date().toISOString(), userId);
  return res.changes;
}
