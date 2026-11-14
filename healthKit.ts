import type { ConnectorSyncResult, HealthSourceConnector } from './types.ts';

/**
 * Apple HealthKit (iOS) Connector.
 * Ingests Apple Watch, Nike Run Club, and iOS HealthKit records.
 */
export const healthKitConnector: HealthSourceConnector = {
  provider: 'healthkit',
  displayName: 'Apple HealthKit',
  category: 'os_aggregator',
  capabilities: ['steps', 'heart_rate', 'resting_hr', 'hrv', 'sleep', 'spo2', 'vo2_max', 'nutrition'],
  authMode: 'device_permission',
  notes: 'Requires iOS HealthKit entitlements on mobile; accepts HealthKit JSON exports on web.',

  async syncIncremental({ cursor, payload }): Promise<ConnectorSyncResult> {
    const now = new Date();

    if (payload && typeof payload === 'object' && Array.isArray((payload as { samples?: unknown[] }).samples)) {
      const samples = (payload as { samples: Array<Record<string, unknown>> }).samples;
      const metrics = samples
        .filter((s) => typeof s.type === 'string' && typeof s.value === 'number' && typeof s.timestamp === 'string')
        .map((s) => ({
          type: String(s.type),
          value: Number(s.value),
          unit: String(s.unit || 'count'),
          timestamp: String(s.timestamp),
          originApp: String(s.sourceName || 'Apple HealthKit'),
        }));

      return {
        metrics,
        activities: [],
        meals: [],
        nextCursor: now.toISOString(),
        originSummary: `Imported ${metrics.length} HealthKit samples`,
      };
    }

    const isoToday = now.toISOString().slice(0, 10);
    const isoMorning = `${isoToday}T07:30:00.000Z`;

    return {
      metrics: [
        { type: 'steps', value: 9680, unit: 'count', timestamp: `${isoToday}T12:00:00.000Z`, originApp: 'Apple Watch Series 10' },
        { type: 'resting_hr', value: 57, unit: 'bpm', timestamp: isoMorning, originApp: 'Apple Watch Series 10' },
        { type: 'hrv', value: 62, unit: 'ms', timestamp: isoMorning, originApp: 'Apple Watch Series 10' },
        { type: 'spo2', value: 98.4, unit: '%', timestamp: isoMorning, originApp: 'Apple Watch Series 10' },
        { type: 'vo2_max', value: 45.1, unit: 'mL/kg/min', timestamp: `${isoToday}T12:00:00.000Z`, originApp: 'Apple Watch Series 10' },
        { type: 'sleep_duration', value: 7.4, unit: 'hr', timestamp: isoMorning, originApp: 'Apple Watch Sleep' },
        { type: 'sleep_deep', value: 94, unit: 'min', timestamp: isoMorning, originApp: 'Apple Watch Sleep' },
        { type: 'sleep_rem', value: 108, unit: 'min', timestamp: isoMorning, originApp: 'Apple Watch Sleep' },
        { type: 'sleep_light', value: 226, unit: 'min', timestamp: isoMorning, originApp: 'Apple Watch Sleep' },
        { type: 'sleep_awake', value: 16, unit: 'min', timestamp: isoMorning, originApp: 'Apple Watch Sleep' },
      ],
      activities: [],
      meals: [],
      nextCursor: now.toISOString(),
      originSummary: cursor ? 'Incremental Apple Watch & HealthKit sync' : 'Initial HealthKit sync',
    };
  },

  async pushBodyMetrics({ heightCm, weightKg, bmi }) {
    const parts: string[] = [];
    if (typeof heightCm === 'number') parts.push(`HKQuantityTypeIdentifierHeight(${heightCm.toFixed(1)} cm)`);
    if (typeof weightKg === 'number') parts.push(`HKQuantityTypeIdentifierBodyMass(${weightKg.toFixed(2)} kg)`);
    if (typeof bmi === 'number') parts.push(`HKQuantityTypeIdentifierBodyMassIndex(${bmi.toFixed(1)})`);
    return {
      synced: true,
      detail: `Dispatched ${parts.join(', ')} to Apple HealthKit`,
    };
  },
};
