import crypto from 'crypto';
import { evaluateAndStoreHealthAlerts } from '../alerts.ts';
import { decryptField, encryptField } from '../crypto.ts';
import { db, upsertActivityWithResolution, upsertMetricWithResolution, writeAuditLog } from '../db.ts';
import { getSourcePriority, type SourceProvider } from '../normalization.ts';
import { healthConnectConnector } from './healthConnect.ts';
import { healthKitConnector } from './healthKit.ts';
import { healthifyStubConnector, myFitnessPalStubConnector } from './nutritionConnectors.ts';
import { stravaConnector } from './strava.ts';
import type { HealthSourceConnector } from './types.ts';

export const CONNECTOR_REGISTRY: Partial<Record<SourceProvider, HealthSourceConnector>> = {
  health_connect: healthConnectConnector,
  healthkit: healthKitConnector,
  strava: stravaConnector,
  myfitnesspal: myFitnessPalStubConnector,
  healthify: healthifyStubConnector,
};

export function listSupportedConnectors() {
  return Object.values(CONNECTOR_REGISTRY).map((c) => ({
    provider: c!.provider,
    displayName: c!.displayName,
    category: c!.category,
    capabilities: c!.capabilities,
    authMode: c!.authMode,
    notes: c!.notes,
  }));
}

/**
 * Execute an incremental sync for a user's connected source, refreshing OAuth tokens if needed,
 * persisting normalized metrics/activities/meals, and resolving cross-source conflicts.
 */
export async function syncSourceForUser(params: {
  userId: string;
  actorEmail: string;
  actorRole: string;
  provider: SourceProvider;
  payload?: unknown;
}) {
  const connector = CONNECTOR_REGISTRY[params.provider];
  if (!connector) {
    throw new Error(`Unsupported source provider: ${params.provider}`);
  }

  let sourceRow = db
    .prepare('SELECT * FROM sources WHERE user_id = ? AND provider = ?')
    .get(params.userId, params.provider) as
    | {
        id: string;
        status: string;
        access_token_enc: string | null;
        refresh_token_enc: string | null;
        token_expires_at: string | null;
        sync_cursor: string | null;
      }
    | undefined;

  if (!sourceRow) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO sources (id, user_id, provider, display_name, status, scopes_json, priority_rank, created_at)
       VALUES (?, ?, ?, ?, 'connected', ?, ?, ?)`
    ).run(
      id,
      params.userId,
      params.provider,
      connector.displayName,
      JSON.stringify(connector.capabilities),
      getSourcePriority(connector.category === 'activity' ? 'activity' : 'vitals', params.provider),
      new Date().toISOString()
    );
    sourceRow = db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as typeof sourceRow;
  }

  db.prepare("UPDATE sources SET status = 'syncing', last_error = NULL WHERE id = ?").run(sourceRow!.id);

  try {
    let accessToken: string | null = sourceRow!.access_token_enc
      ? decryptField(sourceRow!.access_token_enc)
      : null;

    // Auto-refresh expired OAuth2 tokens
    if (
      accessToken &&
      sourceRow!.token_expires_at &&
      new Date(sourceRow!.token_expires_at).getTime() < Date.now() + 60_000 &&
      sourceRow!.refresh_token_enc &&
      connector.refreshToken
    ) {
      const refreshed = await connector.refreshToken(decryptField(sourceRow!.refresh_token_enc));
      accessToken = refreshed.accessToken;
      db.prepare(
        `UPDATE sources SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires_at = ? WHERE id = ?`
      ).run(
        encryptField(refreshed.accessToken),
        refreshed.refreshToken ? encryptField(refreshed.refreshToken) : null,
        refreshed.expiresAt ?? null,
        sourceRow!.id
      );
    }

    const result = await connector.syncIncremental({
      userId: params.userId,
      cursor: sourceRow!.sync_cursor,
      accessToken,
      payload: params.payload,
    });

    let metricsStored = 0;
    let metricsDeduplicated = 0;
    for (const m of result.metrics) {
      const res = upsertMetricWithResolution({
        userId: params.userId,
        sourceId: sourceRow!.id,
        sourceProvider: params.provider,
        originApp: m.originApp,
        type: m.type,
        value: m.value,
        unit: m.unit,
        timestamp: m.timestamp,
        confidence: m.confidence,
        metadata: m.metadata,
      });
      metricsStored++;
      if (!res.isPrimary || res.deduplicatedAgainst) metricsDeduplicated++;
    }

    let activitiesStored = 0;
    let activitiesDeduplicated = 0;
    for (const a of result.activities) {
      const res = upsertActivityWithResolution({
        userId: params.userId,
        externalId: a.externalId,
        sourceProvider: params.provider,
        activityType: a.activityType,
        title: a.title,
        startTime: a.startTime,
        durationSec: a.durationSec,
        distanceM: a.distanceM,
        elevationGainM: a.elevationGainM,
        calories: a.calories,
        avgHr: a.avgHr,
        maxHr: a.maxHr,
        avgPaceSecPerKm: a.avgPaceSecPerKm,
        raw: a.raw,
      });
      activitiesStored++;
      if (!res.isPrimary || res.supersededProvider) activitiesDeduplicated++;
    }

    const insertMeal = db.prepare(
      `INSERT INTO meals (id, user_id, source_provider, meal_type, title, logged_at, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, water_ml, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const meal of result.meals) {
      insertMeal.run(
        crypto.randomUUID(),
        params.userId,
        params.provider,
        meal.mealType,
        meal.title,
        meal.loggedAt,
        meal.calories,
        meal.proteinG,
        meal.carbsG,
        meal.fatG,
        meal.fiberG ?? 0,
        meal.sodiumMg ?? 0,
        meal.waterMl ?? 0,
        meal.notes ?? null,
        new Date().toISOString()
      );
    }

    const syncedAt = new Date().toISOString();
    db.prepare(
      "UPDATE sources SET status = 'connected', last_synced_at = ?, sync_cursor = ?, last_error = NULL WHERE id = ?"
    ).run(syncedAt, result.nextCursor, sourceRow!.id);

    writeAuditLog({
      userId: params.userId,
      actorUserId: params.userId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: 'SOURCE_SYNC_COMPLETED',
      resourceType: 'source',
      resourceId: sourceRow!.id,
      details: {
        provider: params.provider,
        metricsStored,
        metricsDeduplicated,
        activitiesStored,
        activitiesDeduplicated,
        summary: result.originSummary,
      },
    });

    const newAlerts = evaluateAndStoreHealthAlerts(params.userId);

    return {
      provider: params.provider,
      status: 'connected',
      lastSyncedAt: syncedAt,
      metricsStored,
      metricsDeduplicated,
      activitiesStored,
      activitiesDeduplicated,
      mealsStored: result.meals.length,
      summary: result.originSummary,
      alertsTriggered: newAlerts.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    db.prepare("UPDATE sources SET status = 'error', last_error = ? WHERE id = ?").run(msg, sourceRow!.id);
    throw err;
  }
}

export interface BodyMetricsPropagationResult {
  provider: string;
  displayName: string;
  synced: boolean;
  detail: string;
}

/**
 * Push updated height, weight, and BMI to every connected app/source for the user.
 */
export async function propagateBodyMetricsToConnectedApps(params: {
  userId: string;
  actorEmail: string;
  actorRole: string;
  heightCm?: number | null;
  weightKg?: number | null;
  bmi?: number | null;
}): Promise<BodyMetricsPropagationResult[]> {
  const connectedSources = db
    .prepare(
      `SELECT id, provider, display_name, access_token_enc, refresh_token_enc, token_expires_at
       FROM sources
       WHERE user_id = ? AND status = 'connected' AND provider != 'manual'`
    )
    .all(params.userId) as Array<{
    id: string;
    provider: SourceProvider;
    display_name: string;
    access_token_enc: string | null;
    refresh_token_enc: string | null;
    token_expires_at: string | null;
  }>;

  const nowIso = new Date().toISOString();
  const results: BodyMetricsPropagationResult[] = [];

  for (const src of connectedSources) {
    const connector = CONNECTOR_REGISTRY[src.provider];
    if (!connector?.pushBodyMetrics) {
      results.push({
        provider: src.provider,
        displayName: src.display_name,
        synced: false,
        detail: `${src.display_name} does not support outbound body profile writes.`,
      });
      continue;
    }

    try {
      let accessToken = src.access_token_enc ? decryptField(src.access_token_enc) : null;
      if (
        accessToken &&
        src.token_expires_at &&
        new Date(src.token_expires_at).getTime() < Date.now() + 60_000 &&
        src.refresh_token_enc &&
        connector.refreshToken
      ) {
        const refreshed = await connector.refreshToken(decryptField(src.refresh_token_enc));
        accessToken = refreshed.accessToken;
        db.prepare(
          `UPDATE sources SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires_at = ? WHERE id = ?`
        ).run(
          encryptField(refreshed.accessToken),
          refreshed.refreshToken ? encryptField(refreshed.refreshToken) : null,
          refreshed.expiresAt ?? null,
          src.id
        );
      }

      const pushRes = await connector.pushBodyMetrics({
        userId: params.userId,
        accessToken,
        heightCm: params.heightCm,
        weightKg: params.weightKg,
        bmi: params.bmi,
        timestamp: nowIso,
      });

      if (pushRes.synced) {
        db.prepare('UPDATE sources SET last_synced_at = ?, last_error = NULL WHERE id = ?').run(nowIso, src.id);
      }

      results.push({
        provider: src.provider,
        displayName: src.display_name,
        synced: pushRes.synced,
        detail: pushRes.detail,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Propagation failed';
      results.push({
        provider: src.provider,
        displayName: src.display_name,
        synced: false,
        detail: msg,
      });
    }
  }

  writeAuditLog({
    userId: params.userId,
    actorUserId: params.userId,
    actorEmail: params.actorEmail,
    actorRole: params.actorRole,
    action: 'BODY_METRICS_PROPAGATED',
    resourceType: 'source',
    details: {
      heightCm: params.heightCm ?? null,
      weightKg: params.weightKg ?? null,
      bmi: params.bmi ?? null,
      results,
    },
  });

  return results;
}
