import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import path from 'path';
import {
  buildActivityDedupKey,
  buildMetricDedupBucket,
  evaluateLabFlag,
  getSourcePriority,
  normalizeMetricUnit,
  type SourceProvider,
} from './normalization.ts';

const DB_PATH = path.resolve(process.cwd(), 'vitalhub.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Versioned SQLite migrations mirroring the production PostgreSQL/TimescaleDB schema.
 */
export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set<number>(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row: unknown) => (row as { version: number }).version)
  );

  if (!applied.has(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('individual', 'professional', 'admin')),
        avatar_url TEXT,
        onboarding_completed INTEGER NOT NULL DEFAULT 0,
        consent_flags_json TEXT NOT NULL DEFAULT '{}',
        biometric_lock_enabled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('connected', 'syncing', 'error', 'disconnected')),
        access_token_enc TEXT,
        refresh_token_enc TEXT,
        token_expires_at TEXT,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        last_synced_at TEXT,
        sync_cursor TEXT,
        last_error TEXT,
        priority_rank INTEGER NOT NULL DEFAULT 5,
        created_at TEXT NOT NULL,
        UNIQUE(user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        canonical_value REAL NOT NULL,
        canonical_unit TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        source_provider TEXT NOT NULL,
        origin_app TEXT,
        confidence REAL NOT NULL DEFAULT 1.0,
        dedup_key TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_metrics_user_type_ts
        ON metrics(user_id, type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_metrics_primary_ts
        ON metrics(user_id, is_primary, timestamp DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_user_dedup_source
        ON metrics(user_id, dedup_key, source_provider);

      CREATE TABLE IF NOT EXISTS activities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        external_id TEXT NOT NULL,
        source_provider TEXT NOT NULL,
        activity_type TEXT NOT NULL,
        title TEXT NOT NULL,
        start_time TEXT NOT NULL,
        duration_sec INTEGER NOT NULL,
        distance_m REAL NOT NULL DEFAULT 0,
        elevation_gain_m REAL NOT NULL DEFAULT 0,
        calories INTEGER NOT NULL DEFAULT 0,
        avg_hr REAL,
        max_hr REAL,
        avg_pace_sec_per_km REAL,
        dedup_key TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 1,
        raw_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_activities_user_start
        ON activities(user_id, start_time DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_user_ext_src
        ON activities(user_id, external_id, source_provider);

      CREATE TABLE IF NOT EXISTS meals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_provider TEXT NOT NULL,
        meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
        title TEXT NOT NULL,
        logged_at TEXT NOT NULL,
        calories REAL NOT NULL DEFAULT 0,
        protein_g REAL NOT NULL DEFAULT 0,
        carbs_g REAL NOT NULL DEFAULT 0,
        fat_g REAL NOT NULL DEFAULT 0,
        fiber_g REAL NOT NULL DEFAULT 0,
        sodium_mg REAL NOT NULL DEFAULT 0,
        water_ml REAL NOT NULL DEFAULT 0,
        micronutrients_json TEXT NOT NULL DEFAULT '{}',
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_meals_user_logged
        ON meals(user_id, logged_at DESC);

      CREATE TABLE IF NOT EXISTS lab_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        lab_name TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        encrypted_file_b64 TEXT NOT NULL,
        file_iv TEXT NOT NULL,
        file_auth_tag TEXT NOT NULL,
        ocr_raw_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK(status IN ('pending_review', 'confirmed', 'archived')),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_lab_reports_user_date
        ON lab_reports(user_id, collected_at DESC);

      CREATE TABLE IF NOT EXISTS lab_results (
        id TEXT PRIMARY KEY,
        report_id TEXT NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        test_name TEXT NOT NULL,
        test_code TEXT,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        reference_low REAL,
        reference_high REAL,
        reference_text TEXT,
        flag TEXT NOT NULL CHECK(flag IN ('normal', 'low', 'high', 'critical_low', 'critical_high')),
        confirmed INTEGER NOT NULL DEFAULT 0,
        collected_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_lab_results_user_test_date
        ON lab_results(user_id, test_name, collected_at DESC);

      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        grantee_email TEXT NOT NULL,
        grantee_name TEXT NOT NULL,
        grantee_role TEXT NOT NULL CHECK(grantee_role IN ('doctor', 'coach', 'dietician')),
        share_token TEXT NOT NULL UNIQUE,
        scopes_json TEXT NOT NULL,
        range_days INTEGER NOT NULL DEFAULT 30,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_shares_owner
        ON shares(owner_user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_shares_grantee
        ON shares(grantee_email, revoked_at);

      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        patient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL,
        author_role TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        is_recommendation INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_notes_patient
        ON notes(patient_user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        patient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        professional_email TEXT NOT NULL,
        sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_name TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_patient
        ON messages(patient_user_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS ai_evaluations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        overall_score INTEGER NOT NULL,
        sub_scores_json TEXT NOT NULL,
        summary TEXT NOT NULL,
        strengths_json TEXT NOT NULL,
        concerns_json TEXT NOT NULL,
        trends_json TEXT NOT NULL,
        correlations_json TEXT NOT NULL,
        recommendations_json TEXT NOT NULL,
        escalation_alert_json TEXT NOT NULL,
        disclaimer TEXT NOT NULL,
        model_used TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_ai_eval_user
        ON ai_evaluations(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_user_id TEXT,
        actor_email TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        ip_address TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_ts
        ON audit_logs(user_id, created_at DESC);
    `);

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      1,
      'initial_vitalhub_schema',
      new Date().toISOString()
    );
  }

  if (!applied.has(2)) {
    const userCols = (
      db.prepare("PRAGMA table_info('users')").all() as Array<{ name: string }>
    ).map((c) => c.name);
    if (!userCols.includes('height_cm')) {
      db.exec('ALTER TABLE users ADD COLUMN height_cm REAL;');
    }
    if (!userCols.includes('weight_kg')) {
      db.exec('ALTER TABLE users ADD COLUMN weight_kg REAL;');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS health_alerts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        metric_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'critical')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        current_value REAL NOT NULL,
        baseline_value REAL NOT NULL,
        unit TEXT NOT NULL,
        delta_pct REAL NOT NULL,
        detected_at TEXT NOT NULL,
        acknowledged_at TEXT,
        dedup_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_health_alerts_dedup
        ON health_alerts(user_id, dedup_key);
      CREATE INDEX IF NOT EXISTS idx_health_alerts_user_ts
        ON health_alerts(user_id, detected_at DESC);
    `);

    // Backfill height/weight for seeded demo member if present
    db.prepare(
      "UPDATE users SET height_cm = COALESCE(height_cm, 168.0), weight_kg = COALESCE(weight_kg, 65.3) WHERE id = 'usr_maya_lin'"
    ).run();

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      2,
      'health_alerts_and_body_profile',
      new Date().toISOString()
    );
  }
}

export function writeAuditLog(params: {
  userId: string;
  actorUserId?: string | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, actor_user_id, actor_email, actor_role, action, resource_type, resource_id, details_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    params.userId,
    params.actorUserId ?? null,
    params.actorEmail,
    params.actorRole,
    params.action,
    params.resourceType,
    params.resourceId ?? null,
    JSON.stringify(params.details ?? {}),
    params.ipAddress ?? '127.0.0.1',
    new Date().toISOString()
  );
}

/**
 * Insert or update a normalized metric with source-priority conflict resolution.
 * If another source already recorded the same dedup_key bucket:
 * - Higher priority source becomes is_primary = 1 and demotes lower priority records to is_primary = 0.
 * - Lower priority source is stored with is_primary = 0 so raw provenance is preserved without double-counting.
 */
export function upsertMetricWithResolution(params: {
  userId: string;
  sourceId?: string | null;
  sourceProvider: SourceProvider;
  originApp?: string;
  type: string;
  value: number;
  unit: string;
  timestamp: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}): { id: string; isPrimary: boolean; deduplicatedAgainst?: string } {
  const { canonicalValue, canonicalUnit } = normalizeMetricUnit(params.type, params.value, params.unit);
  const dedupKey = buildMetricDedupBucket(params.type, params.timestamp);
  const incomingPriority = getSourcePriority(params.type, params.sourceProvider);

  const existingSameBucket = db
    .prepare(
      `SELECT id, source_provider, is_primary FROM metrics
       WHERE user_id = ? AND dedup_key = ?`
    )
    .all(params.userId, dedupKey) as Array<{ id: string; source_provider: SourceProvider; is_primary: number }>;

  let isPrimary = true;
  let deduplicatedAgainst: string | undefined;

  for (const row of existingSameBucket) {
    if (row.source_provider === params.sourceProvider) continue;
    const existingPriority = getSourcePriority(params.type, row.source_provider);
    if (existingPriority > incomingPriority) {
      isPrimary = false;
      deduplicatedAgainst = row.source_provider;
    } else if (incomingPriority >= existingPriority && row.is_primary === 1) {
      db.prepare('UPDATE metrics SET is_primary = 0 WHERE id = ?').run(row.id);
      deduplicatedAgainst = row.source_provider;
    }
  }

  const now = new Date().toISOString();
  const existingExact = db
    .prepare('SELECT id FROM metrics WHERE user_id = ? AND dedup_key = ? AND source_provider = ?')
    .get(params.userId, dedupKey, params.sourceProvider) as { id: string } | undefined;

  if (existingExact) {
    db.prepare(
      `UPDATE metrics
       SET value = ?, unit = ?, canonical_value = ?, canonical_unit = ?, timestamp = ?,
           origin_app = ?, confidence = ?, is_primary = ?, metadata_json = ?
       WHERE id = ?`
    ).run(
      params.value,
      params.unit,
      canonicalValue,
      canonicalUnit,
      params.timestamp,
      params.originApp ?? params.sourceProvider,
      params.confidence ?? 0.95,
      isPrimary ? 1 : 0,
      JSON.stringify(params.metadata ?? {}),
      existingExact.id
    );
    return { id: existingExact.id, isPrimary, deduplicatedAgainst };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO metrics
     (id, user_id, type, value, unit, canonical_value, canonical_unit, timestamp, source_id, source_provider, origin_app, confidence, dedup_key, is_primary, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.type,
    params.value,
    params.unit,
    canonicalValue,
    canonicalUnit,
    params.timestamp,
    params.sourceId ?? null,
    params.sourceProvider,
    params.originApp ?? params.sourceProvider,
    params.confidence ?? 0.95,
    dedupKey,
    isPrimary ? 1 : 0,
    JSON.stringify(params.metadata ?? {}),
    now
  );

  return { id, isPrimary, deduplicatedAgainst };
}

/**
 * Insert or update an activity with cross-source deduplication (e.g., Strava > HealthKit/Health Connect).
 */
export function upsertActivityWithResolution(params: {
  userId: string;
  externalId: string;
  sourceProvider: SourceProvider;
  activityType: string;
  title: string;
  startTime: string;
  durationSec: number;
  distanceM: number;
  elevationGainM: number;
  calories: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgPaceSecPerKm?: number | null;
  raw?: Record<string, unknown>;
}): { id: string; isPrimary: boolean; supersededProvider?: string } {
  const dedupKey = buildActivityDedupKey(params.activityType, params.startTime);
  const incomingPriority = getSourcePriority('activity', params.sourceProvider);

  const overlapping = db
    .prepare('SELECT id, source_provider, is_primary FROM activities WHERE user_id = ? AND dedup_key = ?')
    .all(params.userId, dedupKey) as Array<{ id: string; source_provider: SourceProvider; is_primary: number }>;

  let isPrimary = true;
  let supersededProvider: string | undefined;

  for (const row of overlapping) {
    if (row.source_provider === params.sourceProvider) continue;
    const existingPriority = getSourcePriority('activity', row.source_provider);
    if (existingPriority > incomingPriority) {
      isPrimary = false;
      supersededProvider = row.source_provider;
    } else if (incomingPriority >= existingPriority && row.is_primary === 1) {
      db.prepare('UPDATE activities SET is_primary = 0 WHERE id = ?').run(row.id);
      supersededProvider = row.source_provider;
    }
  }

  const existing = db
    .prepare('SELECT id FROM activities WHERE user_id = ? AND external_id = ? AND source_provider = ?')
    .get(params.userId, params.externalId, params.sourceProvider) as { id: string } | undefined;

  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE activities
       SET title = ?, duration_sec = ?, distance_m = ?, elevation_gain_m = ?, calories = ?,
           avg_hr = ?, max_hr = ?, avg_pace_sec_per_km = ?, is_primary = ?, raw_json = ?
       WHERE id = ?`
    ).run(
      params.title,
      params.durationSec,
      params.distanceM,
      params.elevationGainM,
      params.calories,
      params.avgHr ?? null,
      params.maxHr ?? null,
      params.avgPaceSecPerKm ?? null,
      isPrimary ? 1 : 0,
      JSON.stringify(params.raw ?? {}),
      existing.id
    );
    return { id: existing.id, isPrimary, supersededProvider };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO activities
     (id, user_id, external_id, source_provider, activity_type, title, start_time, duration_sec, distance_m, elevation_gain_m, calories, avg_hr, max_hr, avg_pace_sec_per_km, dedup_key, is_primary, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.userId,
    params.externalId,
    params.sourceProvider,
    params.activityType,
    params.title,
    params.startTime,
    params.durationSec,
    params.distanceM,
    params.elevationGainM,
    params.calories,
    params.avgHr ?? null,
    params.maxHr ?? null,
    params.avgPaceSecPerKm ?? null,
    dedupKey,
    isPrimary ? 1 : 0,
    JSON.stringify(params.raw ?? {}),
    now
  );

  return { id, isPrimary, supersededProvider };
}

/**
 * Seed realistic demo accounts and 30-day multi-source health history on first empty DB boot.
 */
export function seedDemoDataIfEmpty(): void {
  const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
  if (userCount > 0) return;

  const now = new Date();
  const passwordHash = bcrypt.hashSync('VitalHub2026!', 10);

  const mayaId = 'usr_maya_lin';
  const drElenaId = 'usr_dr_elena';
  const adminId = 'usr_admin_ops';

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, avatar_url, onboarding_completed, consent_flags_json, biometric_lock_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertUser.run(
    mayaId,
    'maya.lin@vitalhub.app',
    passwordHash,
    'Maya Lin',
    'individual',
    '/src/assets/images/avatar_member_profile_1794636765273.jpg',
    1,
    JSON.stringify({
      vitals: true,
      sleep: true,
      activity: true,
      nutrition: true,
      labs: true,
      aiInsights: true,
      consentedAt: new Date(now.getTime() - 28 * 86400000).toISOString(),
    }),
    0,
    new Date(now.getTime() - 30 * 86400000).toISOString()
  );

  insertUser.run(
    drElenaId,
    'dr.elena@vitalhub.app',
    passwordHash,
    'Dr. Elena Vance, MD',
    'professional',
    '/src/assets/images/avatar_clinician_profile_1794636765724.jpg',
    1,
    JSON.stringify({ clinicianAttestation: true }),
    0,
    new Date(now.getTime() - 30 * 86400000).toISOString()
  );

  insertUser.run(
    adminId,
    'admin@vitalhub.app',
    passwordHash,
    'Jordan Park',
    'admin',
    null,
    1,
    JSON.stringify({ adminPolicyAccepted: true }),
    0,
    new Date(now.getTime() - 30 * 86400000).toISOString()
  );

  // Connect sources for Maya
  const srcHealthKitId = 'src_maya_healthkit';
  const srcHealthConnectId = 'src_maya_hc';
  const srcStravaId = 'src_maya_strava';
  const srcManualId = 'src_maya_manual';

  const insertSource = db.prepare(
    `INSERT INTO sources (id, user_id, provider, display_name, status, scopes_json, last_synced_at, sync_cursor, priority_rank, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
  const fourHoursAgo = new Date(now.getTime() - 4 * 3600 * 1000).toISOString();

  insertSource.run(
    srcHealthKitId,
    mayaId,
    'healthkit',
    'Apple HealthKit',
    'connected',
    JSON.stringify(['steps', 'heart_rate', 'resting_hr', 'hrv', 'sleep', 'spo2', 'vo2_max']),
    twoHoursAgo,
    twoHoursAgo,
    10,
    new Date(now.getTime() - 28 * 86400000).toISOString()
  );

  insertSource.run(
    srcHealthConnectId,
    mayaId,
    'health_connect',
    'Google Health Connect (Fitbit · Samsung Health)',
    'connected',
    JSON.stringify(['steps', 'weight', 'bp', 'glucose', 'nutrition']),
    fourHoursAgo,
    fourHoursAgo,
    9,
    new Date(now.getTime() - 25 * 86400000).toISOString()
  );

  insertSource.run(
    srcStravaId,
    mayaId,
    'strava',
    'Strava',
    'connected',
    JSON.stringify(['read', 'activity:read_all']),
    twoHoursAgo,
    twoHoursAgo,
    10,
    new Date(now.getTime() - 24 * 86400000).toISOString()
  );

  insertSource.run(
    srcManualId,
    mayaId,
    'manual',
    'Manual & CSV Logs',
    'connected',
    JSON.stringify(['meals', 'water', 'bp']),
    twoHoursAgo,
    twoHoursAgo,
    5,
    new Date(now.getTime() - 28 * 86400000).toISOString()
  );

  // Generate 30 days of realistic, slightly improving longitudinal health telemetry
  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const day = new Date(now.getTime() - dayOffset * 86400000);
    const isoNoon = `${day.toISOString().slice(0, 10)}T12:00:00.000Z`;
    const isoMorning = `${day.toISOString().slice(0, 10)}T07:30:00.000Z`;

    // Deterministic gentle wave + positive trend
    const wave = Math.sin(dayOffset * 0.55);
    const improvement = (29 - dayOffset) / 29; // 0 -> 1

    const steps = Math.round(7400 + improvement * 2200 + wave * 1600);
    const rhr = Math.round(62 - improvement * 4 - wave * 2);
    const hrv = Math.round(48 + improvement * 14 + wave * 6);
    const sleepMin = Math.round(415 + improvement * 30 + wave * 35);
    const deepMin = Math.round(sleepMin * 0.21);
    const remMin = Math.round(sleepMin * 0.24);
    const awakeMin = Math.round(18 - improvement * 5);
    const lightMin = Math.max(60, sleepMin - deepMin - remMin - awakeMin);
    const weight = Number((66.4 - improvement * 1.1 + wave * 0.2).toFixed(1));
    const sysBp = Math.round(123 - improvement * 5 + wave * 3);
    const diaBp = Math.round(79 - improvement * 3 + wave * 2);
    const glucose = Math.round(97 - improvement * 5 + wave * 4);
    const spo2 = Number((97.8 + wave * 0.6).toFixed(1));
    const vo2 = Number((43.2 + improvement * 1.8).toFixed(1));
    const waterMl = Math.round(2100 + improvement * 350 + wave * 200);

    // Primary wearable metrics via HealthKit
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'steps',
      value: steps,
      unit: 'count',
      timestamp: isoNoon,
    });
    // Also simulate overlapping steps from Health Connect (Samsung Health) to demonstrate dedup!
    if (dayOffset < 7) {
      upsertMetricWithResolution({
        userId: mayaId,
        sourceId: srcHealthConnectId,
        sourceProvider: 'health_connect',
        originApp: 'Samsung Health',
        type: 'steps',
        value: steps - 140,
        unit: 'count',
        timestamp: isoNoon,
      });
    }

    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'resting_hr',
      value: rhr,
      unit: 'bpm',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'hrv',
      value: hrv,
      unit: 'ms',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'sleep_duration',
      value: sleepMin,
      unit: 'min',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'sleep_deep',
      value: deepMin,
      unit: 'min',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'sleep_rem',
      value: remMin,
      unit: 'min',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'sleep_light',
      value: lightMin,
      unit: 'min',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'sleep_awake',
      value: awakeMin,
      unit: 'min',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'spo2',
      value: spo2,
      unit: '%',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthKitId,
      sourceProvider: 'healthkit',
      originApp: 'Apple Watch Series 10',
      type: 'vo2_max',
      value: vo2,
      unit: 'mL/kg/min',
      timestamp: isoNoon,
    });

    // Weight, BP, Glucose via Health Connect (Fitbit Aria / Withings / CGM bridge)
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthConnectId,
      sourceProvider: 'health_connect',
      originApp: 'Fitbit Aria Scale via Health Connect',
      type: 'weight',
      value: weight,
      unit: 'kg',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthConnectId,
      sourceProvider: 'health_connect',
      originApp: 'Omron Connect via Health Connect',
      type: 'bp_systolic',
      value: sysBp,
      unit: 'mmHg',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthConnectId,
      sourceProvider: 'health_connect',
      originApp: 'Omron Connect via Health Connect',
      type: 'bp_diastolic',
      value: diaBp,
      unit: 'mmHg',
      timestamp: isoMorning,
    });
    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcHealthConnectId,
      sourceProvider: 'health_connect',
      originApp: 'Dexcom Bridge via Health Connect',
      type: 'glucose',
      value: glucose,
      unit: 'mg/dL',
      timestamp: isoMorning,
    });

    upsertMetricWithResolution({
      userId: mayaId,
      sourceId: srcManualId,
      sourceProvider: 'manual',
      originApp: 'VitalHub Hydration Log',
      type: 'water',
      value: waterMl,
      unit: 'ml',
      timestamp: isoNoon,
    });
  }

  // Seed workouts from Strava + duplicate from HealthKit/Nike Run Club to show conflict resolution!
  const workoutSeeds = [
    { daysAgo: 1, type: 'Run', title: 'Morning Tempo 8K', dur: 2460, dist: 8120, elev: 74, cal: 512, hr: 156, maxHr: 174 },
    { daysAgo: 3, type: 'Ride', title: 'Bay Trail Endurance Ride', dur: 3900, dist: 31400, elev: 285, cal: 740, hr: 142, maxHr: 165 },
    { daysAgo: 5, type: 'Strength', title: 'Lower Body & Core Mobility', dur: 2700, dist: 0, elev: 0, cal: 310, hr: 124, maxHr: 148 },
    { daysAgo: 7, type: 'Run', title: 'Zone 2 Recovery Loop', dur: 2100, dist: 5800, elev: 42, cal: 365, hr: 138, maxHr: 151 },
    { daysAgo: 10, type: 'Run', title: 'Threshold Intervals 6x800m', dur: 2640, dist: 8600, elev: 55, cal: 548, hr: 161, maxHr: 181 },
    { daysAgo: 13, type: 'Swim', title: 'Pool Aerobic Lap Set', dur: 2280, dist: 1850, elev: 0, cal: 390, hr: 134, maxHr: 152 },
  ];

  workoutSeeds.forEach((w, idx) => {
    const start = new Date(now.getTime() - w.daysAgo * 86400000);
    start.setUTCHours(7, 15, 0, 0);
    const startIso = start.toISOString();
    const pace = w.dist > 0 ? Math.round((w.dur / w.dist) * 1000) : null;

    // HealthKit copy arrives first, then Strava supersedes it as primary for workouts!
    if (idx < 3) {
      upsertActivityWithResolution({
        userId: mayaId,
        externalId: `hk_workout_${idx}`,
        sourceProvider: 'healthkit',
        activityType: w.type,
        title: `${w.title} (Nike Run Club / Watch)`,
        startTime: startIso,
        durationSec: w.dur - 12,
        distanceM: w.dist - 40,
        elevationGainM: w.elev,
        calories: w.cal - 15,
        avgHr: w.hr,
        maxHr: w.maxHr,
        avgPaceSecPerKm: pace,
      });
    }

    upsertActivityWithResolution({
      userId: mayaId,
      externalId: `strava_act_${1000 + idx}`,
      sourceProvider: 'strava',
      activityType: w.type,
      title: w.title,
      startTime: startIso,
      durationSec: w.dur,
      distanceM: w.dist,
      elevationGainM: w.elev,
      calories: w.cal,
      avgHr: w.hr,
      maxHr: w.maxHr,
      avgPaceSecPerKm: pace,
    });
  });

  // Seed recent meals (last 5 days)
  const insertMeal = db.prepare(
    `INSERT INTO meals (id, user_id, source_provider, meal_type, title, logged_at, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, water_ml, micronutrients_json, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const mealTemplates: Array<{
    daysAgo: number;
    hour: number;
    mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    title: string;
    cal: number;
    p: number;
    c: number;
    f: number;
    fib: number;
    na: number;
    water: number;
    src: SourceProvider;
  }> = [
    { daysAgo: 0, hour: 8, mealType: 'breakfast', title: 'Greek yogurt, chia, blueberries & walnuts', cal: 410, p: 28, c: 36, f: 16, fib: 8, na: 140, water: 450, src: 'manual' },
    { daysAgo: 0, hour: 13, mealType: 'lunch', title: 'Grilled salmon quinoa bowl with avocado & greens', cal: 640, p: 44, c: 52, f: 26, fib: 11, na: 520, water: 600, src: 'health_connect' },
    { daysAgo: 0, hour: 16, mealType: 'snack', title: 'Matcha latte & roasted almonds', cal: 210, p: 8, c: 14, f: 14, fib: 3, na: 85, water: 350, src: 'manual' },
    { daysAgo: 1, hour: 8, mealType: 'breakfast', title: 'Steel-cut oats with whey & flaxseed', cal: 430, p: 30, c: 54, f: 10, fib: 9, na: 160, water: 500, src: 'health_connect' },
    { daysAgo: 1, hour: 13, mealType: 'lunch', title: 'Mediterranean chicken lentil salad', cal: 590, p: 46, c: 48, f: 22, fib: 12, na: 610, water: 500, src: 'manual' },
    { daysAgo: 1, hour: 19, mealType: 'dinner', title: 'Herb-roasted cod, sweet potato & broccolini', cal: 620, p: 45, c: 58, f: 20, fib: 9, na: 480, water: 550, src: 'manual' },
  ];

  mealTemplates.forEach((m) => {
    const dt = new Date(now.getTime() - m.daysAgo * 86400000);
    dt.setUTCHours(m.hour, 15, 0, 0);
    insertMeal.run(
      crypto.randomUUID(),
      mayaId,
      m.src,
      m.mealType,
      m.title,
      dt.toISOString(),
      m.cal,
      m.p,
      m.c,
      m.f,
      m.fib,
      m.na,
      m.water,
      JSON.stringify({ vitaminD_iu: 120, magnesium_mg: 95, potassium_mg: 620 }),
      null,
      dt.toISOString()
    );
  });

  // Seed 2 longitudinal confirmed lab reports so Lab Trends chart is immediately rich
  const labReport1Id = 'lab_rep_6mo_ago';
  const labReport2Id = 'lab_rep_recent';
  const sixMonthsAgo = new Date(now.getTime() - 180 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

  const insertReport = db.prepare(
    `INSERT INTO lab_reports (id, user_id, title, lab_name, collected_at, file_name, mime_type, file_size, encrypted_file_b64, file_iv, file_auth_tag, ocr_raw_text, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertReport.run(
    labReport1Id,
    mayaId,
    'Comprehensive Metabolic & Lipid Panel (Baseline)',
    'Quest Diagnostics',
    sixMonthsAgo,
    'quest_baseline_panel.pdf',
    'application/pdf',
    128400,
    Buffer.from('Baseline encrypted diagnostic placeholder').toString('base64'),
    'seed_iv_1',
    'seed_tag_1',
    'HbA1c: 5.7%, Fasting Glucose: 103 mg/dL, LDL Cholesterol: 126 mg/dL, HDL: 56 mg/dL, Triglycerides: 118 mg/dL, Vitamin D 25-OH: 24 ng/mL, hs-CRP: 1.6 mg/L',
    'confirmed',
    sixMonthsAgo
  );

  insertReport.run(
    labReport2Id,
    mayaId,
    'Follow-Up Cardiometabolic & Micronutrient Panel',
    'Labcorp Diagnostics',
    fourteenDaysAgo,
    'labcorp_followup_panel.pdf',
    'application/pdf',
    142800,
    Buffer.from('Follow-up encrypted diagnostic placeholder').toString('base64'),
    'seed_iv_2',
    'seed_tag_2',
    'HbA1c: 5.4%, Fasting Glucose: 93 mg/dL, LDL Cholesterol: 112 mg/dL, HDL: 62 mg/dL, Triglycerides: 94 mg/dL, Vitamin D 25-OH: 36 ng/mL, hs-CRP: 0.9 mg/L',
    'confirmed',
    fourteenDaysAgo
  );

  const insertLabRes = db.prepare(
    `INSERT INTO lab_results (id, report_id, user_id, test_name, test_code, value, unit, reference_low, reference_high, reference_text, flag, confirmed, collected_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const labMarkers = [
    // Baseline (6 months ago)
    { rep: labReport1Id, date: sixMonthsAgo, name: 'HbA1c', code: '4548-4', val: 5.7, unit: '%', low: 4.0, high: 5.6, ref: '4.0 - 5.6 %' },
    { rep: labReport1Id, date: sixMonthsAgo, name: 'Fasting Glucose', code: '1558-6', val: 103, unit: 'mg/dL', low: 70, high: 99, ref: '70 - 99 mg/dL' },
    { rep: labReport1Id, date: sixMonthsAgo, name: 'LDL Cholesterol', code: '13457-7', val: 126, unit: 'mg/dL', low: 0, high: 99, ref: '< 100 mg/dL' },
    { rep: labReport1Id, date: sixMonthsAgo, name: 'HDL Cholesterol', code: '2085-9', val: 56, unit: 'mg/dL', low: 45, high: 120, ref: '>= 45 mg/dL' },
    { rep: labReport1Id, date: sixMonthsAgo, name: 'Triglycerides', code: '2571-8', val: 118, unit: 'mg/dL', low: 0, high: 149, ref: '< 150 mg/dL' },
    { rep: labReport1Id, date: sixMonthsAgo, name: 'Vitamin D 25-OH', code: '1989-3', val: 24, unit: 'ng/mL', low: 30, high: 100, ref: '30 - 100 ng/mL' },
    { rep: labReport1Id, date: sixMonthsAgo, name: 'hs-CRP', code: '30522-7', val: 1.6, unit: 'mg/L', low: 0, high: 1.0, ref: '< 1.0 mg/L (Low Risk)' },
    // Recent (14 days ago)
    { rep: labReport2Id, date: fourteenDaysAgo, name: 'HbA1c', code: '4548-4', val: 5.4, unit: '%', low: 4.0, high: 5.6, ref: '4.0 - 5.6 %' },
    { rep: labReport2Id, date: fourteenDaysAgo, name: 'Fasting Glucose', code: '1558-6', val: 93, unit: 'mg/dL', low: 70, high: 99, ref: '70 - 99 mg/dL' },
    { rep: labReport2Id, date: fourteenDaysAgo, name: 'LDL Cholesterol', code: '13457-7', val: 112, unit: 'mg/dL', low: 0, high: 99, ref: '< 100 mg/dL' },
    { rep: labReport2Id, date: fourteenDaysAgo, name: 'HDL Cholesterol', code: '2085-9', val: 62, unit: 'mg/dL', low: 45, high: 120, ref: '>= 45 mg/dL' },
    { rep: labReport2Id, date: fourteenDaysAgo, name: 'Triglycerides', code: '2571-8', val: 94, unit: 'mg/dL', low: 0, high: 149, ref: '< 150 mg/dL' },
    { rep: labReport2Id, date: fourteenDaysAgo, name: 'Vitamin D 25-OH', code: '1989-3', val: 36, unit: 'ng/mL', low: 30, high: 100, ref: '30 - 100 ng/mL' },
    { rep: labReport2Id, date: fourteenDaysAgo, name: 'hs-CRP', code: '30522-7', val: 0.9, unit: 'mg/L', low: 0, high: 1.0, ref: '< 1.0 mg/L (Low Risk)' },
  ];

  labMarkers.forEach((m) => {
    insertLabRes.run(
      crypto.randomUUID(),
      m.rep,
      mayaId,
      m.name,
      m.code,
      m.val,
      m.unit,
      m.low,
      m.high,
      m.ref,
      evaluateLabFlag(m.val, m.low, m.high, m.name),
      1,
      m.date,
      m.date
    );
  });

  // Seed share grant to Dr. Elena Vance
  const shareId = 'shr_maya_elena';
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 86400000).toISOString();
  db.prepare(
    `INSERT INTO shares (id, owner_user_id, grantee_email, grantee_name, grantee_role, share_token, scopes_json, range_days, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    shareId,
    mayaId,
    'dr.elena@vitalhub.app',
    'Dr. Elena Vance, MD',
    'doctor',
    'vh_share_elena_demo_2026',
    JSON.stringify(['vitals', 'sleep', 'activity', 'labs']), // Notice 'diet' is intentionally unshared to demonstrate granular RBAC!
    30,
    thirtyDaysFromNow,
    null,
    new Date(now.getTime() - 10 * 86400000).toISOString()
  );

  // Seed clinician note & care team messages
  db.prepare(
    `INSERT INTO notes (id, patient_user_id, author_user_id, author_name, author_role, category, content, is_recommendation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    mayaId,
    drElenaId,
    'Dr. Elena Vance, MD',
    'doctor',
    'Cardiometabolic Follow-Up',
    'HbA1c improved from 5.7% to 5.4% and Vitamin D normalized to 36 ng/mL. Keep Zone 2 aerobic sessions at 150+ min/week and re-check LDL-C in 90 days alongside soluble fiber targets.',
    1,
    new Date(now.getTime() - 5 * 86400000).toISOString()
  );

  db.prepare(
    `INSERT INTO messages (id, patient_user_id, professional_email, sender_user_id, sender_name, sender_role, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    mayaId,
    'dr.elena@vitalhub.app',
    drElenaId,
    'Dr. Elena Vance, MD',
    'doctor',
    'Hi Maya, I reviewed your Labcorp follow-up and recent Apple Watch resting HR trend. Great progress on your sleep consistency.',
    new Date(now.getTime() - 4 * 86400000).toISOString()
  );

  // Seed initial AI Health Evaluation
  db.prepare(
    `INSERT INTO ai_evaluations (id, user_id, overall_score, sub_scores_json, summary, strengths_json, concerns_json, trends_json, correlations_json, recommendations_json, escalation_alert_json, disclaimer, model_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    mayaId,
    84,
    JSON.stringify({
      cardiovascular: 86,
      sleep: 81,
      activity: 88,
      nutrition: 82,
      metabolicLabs: 79,
      recoveryStress: 85,
    }),
    'Cardiorespiratory fitness and glycemic control have improved meaningfully over the past 30 days, anchored by consistent Zone 2 training and longer sleep duration. LDL cholesterol (112 mg/dL) remains mildly above optimal (<100 mg/dL) and is the primary opportunity area.',
    JSON.stringify([
      'Resting heart rate trended down ~4 bpm over 30 days while HRV rose steadily into the high-50s ms range.',
      'HbA1c normalized from 5.7% to 5.4% and fasting glucose dropped from 103 to 93 mg/dL.',
      'Vitamin D 25-OH recovered from 24 to 36 ng/mL.',
    ]),
    JSON.stringify([
      'LDL Cholesterol (112 mg/dL) remains slightly above the <100 mg/dL optimal reference threshold.',
      'Mid-week sleep duration occasionally dips below 7 hours on high-volume training days.',
    ]),
    JSON.stringify({
      days7: 'Average 9,200+ steps/day, 7h 20m sleep, resting HR 58 bpm.',
      days30: 'Consistent upward trajectory in HRV (+11 ms) and VO2 max (+1.5 mL/kg/min).',
      days90: 'Longitudinal lab markers show clear cardiometabolic improvement from baseline.',
    }),
    JSON.stringify([
      {
        pair: 'Sleep Duration vs. Resting HR',
        finding: 'Nights exceeding 7h 15m of sleep consistently precede a 2-3 bpm lower next-morning resting HR.',
      },
      {
        pair: 'Aerobic Volume vs. Fasting Glucose',
        finding: 'Weeks with 3+ Strava endurance sessions correspond with fasting glucose averaging 91-94 mg/dL.',
      },
    ]),
    JSON.stringify([
      {
        priority: 1,
        title: 'Target 30g+ daily soluble fiber to support LDL reduction',
        rationale: 'Pairing oats, chia, legumes, and psyllium with reduced saturated fat can nudge LDL-C closer to <100 mg/dL before your next lipid panel.',
        category: 'nutrition',
      },
      {
        priority: 2,
        title: 'Protect a 7.5-hour sleep floor after threshold runs',
        rationale: 'HRV dips are clustered after high-intensity intervals when sleep falls under 6h 45m.',
        category: 'sleep',
      },
      {
        priority: 3,
        title: 'Maintain 2 weekly Zone 2 aerobic sessions (45-60 min)',
        rationale: 'Supports sustained VO2 max gains and insulin sensitivity without overtaxing recovery.',
        category: 'activity',
      },
    ]),
    JSON.stringify({ triggered: false, level: 'none', message: '', triggers: [] }),
    'Informational only — not medical advice, diagnosis, or a substitute for clinical care.',
    'gemini-4-hydrogen',
    new Date(now.getTime() - 1 * 86400000).toISOString()
  );

  writeAuditLog({
    userId: mayaId,
    actorUserId: drElenaId,
    actorEmail: 'dr.elena@vitalhub.app',
    actorRole: 'doctor',
    action: 'VIEW_SHARED_RECORD',
    resourceType: 'share',
    resourceId: shareId,
    details: { scopes: ['vitals', 'sleep', 'activity', 'labs'], rangeDays: 30 },
  });
}
