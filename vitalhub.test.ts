import { describe, expect, it } from 'vitest';
import { parseNutritionCsv } from '../server/connectors/nutritionConnectors.ts';
import { decryptBuffer, decryptField, encryptBuffer, encryptField } from '../server/crypto.ts';
import {
  buildActivityDedupKey,
  buildMetricDedupBucket,
  checkSafetyEscalation,
  detectMetricDeviations,
  evaluateLabFlag,
  getSourcePriority,
  normalizeMetricUnit,
} from '../server/normalization.ts';

describe('VitalHub Normalization & Unit Conversion', () => {
  it('converts pounds and grams to canonical kg', () => {
    expect(normalizeMetricUnit('weight', 154.32, 'lb')).toEqual({
      canonicalValue: 70,
      canonicalUnit: 'kg',
    });
    expect(normalizeMetricUnit('weight', 68500, 'g')).toEqual({
      canonicalValue: 68.5,
      canonicalUnit: 'kg',
    });
  });

  it('converts mmol/L glucose to mg/dL', () => {
    const res = normalizeMetricUnit('glucose', 5.5, 'mmol/L');
    expect(res.canonicalUnit).toBe('mg/dL');
    expect(res.canonicalValue).toBe(99);
  });

  it('converts fl oz hydration and hours of sleep to canonical ml and min', () => {
    expect(normalizeMetricUnit('water', 16, 'fl oz')).toEqual({
      canonicalValue: 473,
      canonicalUnit: 'ml',
    });
    expect(normalizeMetricUnit('sleep_duration', 7.5, 'hr')).toEqual({
      canonicalValue: 450,
      canonicalUnit: 'min',
    });
  });

  it('converts miles to meters and kilojoules to kcal', () => {
    expect(normalizeMetricUnit('distance', 3.1, 'mi')).toEqual({
      canonicalValue: 4989,
      canonicalUnit: 'm',
    });
    expect(normalizeMetricUnit('calories', 2092, 'kJ')).toEqual({
      canonicalValue: 500,
      canonicalUnit: 'kcal',
    });
  });
});

describe('Deduplication & Source Priority Conflict Resolution', () => {
  it('assigns higher priority to Strava for workouts and HealthKit for vitals', () => {
    expect(getSourcePriority('activity', 'strava')).toBeGreaterThan(
      getSourcePriority('activity', 'healthkit')
    );
    expect(getSourcePriority('resting_hr', 'healthkit')).toBeGreaterThan(
      getSourcePriority('resting_hr', 'strava')
    );
  });

  it('buckets daily metrics and intraday vitals deterministically for deduplication', () => {
    expect(buildMetricDedupBucket('steps', '2026-11-10T08:12:00.000Z')).toBe(
      buildMetricDedupBucket('steps', '2026-11-10T21:45:00.000Z')
    );
    expect(buildActivityDedupKey('Run', '2026-11-10T07:12:00.000Z')).toBe(
      buildActivityDedupKey('run', '2026-11-10T07:18:00.000Z')
    );
  });
});

describe('Lab Range Flagging & Urgent Safety Guardrails', () => {
  it('flags normal, out-of-range, and critical lab markers including partial bounds', () => {
    expect(evaluateLabFlag(5.4, 4.0, 5.6, 'HbA1c')).toBe('normal');
    expect(evaluateLabFlag(128, 0, 99, 'LDL Cholesterol')).toBe('high');
    expect(evaluateLabFlag(22, 30, 100, 'Vitamin D 25-OH')).toBe('low');
    expect(evaluateLabFlag(280, 70, 99, 'Fasting Glucose')).toBe('critical_high');
    expect(evaluateLabFlag(49, 70, 99, 'Fasting Glucose')).toBe('critical_low');
    // Handles missing upper reference bound gracefully
    expect(evaluateLabFlag(55, 45, null, 'HDL Cholesterol')).toBe('normal');
  });

  it('triggers urgent escalation on hypertensive crisis or severe hypoglycemia', () => {
    const bpAlert = checkSafetyEscalation({ latestSystolicBp: 184, latestDiastolicBp: 112 });
    expect(bpAlert.triggered).toBe(true);
    expect(bpAlert.level).toBe('urgent');

    const normal = checkSafetyEscalation({
      latestSystolicBp: 118,
      latestDiastolicBp: 76,
      latestGlucoseMgDl: 92,
      latestSpo2: 98,
    });
    expect(normal.triggered).toBe(false);
  });
});

describe('Nutrition CSV Parser & AES-256-GCM Encryption', () => {
  it('parses nutrition CSV rows with defaults for missing optional fields', () => {
    const csv = `date,meal_type,title,calories,protein_g,carbs_g,fat_g\n2026-11-12,lunch,Salmon Bowl,620,42,50,24`;
    const meals = parseNutritionCsv(csv);
    expect(meals).toHaveLength(1);
    expect(meals[0].title).toBe('Salmon Bowl');
    expect(meals[0].calories).toBe(620);
  });

  it('encrypts and decrypts OAuth tokens and binary lab files cleanly', () => {
    const token = 'strava_secret_token_abc123';
    const packed = encryptField(token);
    expect(packed).not.toContain(token);
    expect(decryptField(packed)).toBe(token);

    const rawPdf = Buffer.from('%PDF-1.4 fake binary lab report');
    const enc = encryptBuffer(rawPdf);
    expect(decryptBuffer(enc).toString('utf8')).toBe(rawPdf.toString('utf8'));
  });
});

describe('Height Normalization & Health Alerts Deviation Monitor', () => {
  it('converts inches, feet, and meters to canonical cm', () => {
    expect(normalizeMetricUnit('height', 66, 'in')).toEqual({
      canonicalValue: 167.6,
      canonicalUnit: 'cm',
    });
    expect(normalizeMetricUnit('height', 5.5, 'ft')).toEqual({
      canonicalValue: 167.6,
      canonicalUnit: 'cm',
    });
    expect(normalizeMetricUnit('height', 1.72, 'm')).toEqual({
      canonicalValue: 172,
      canonicalUnit: 'cm',
    });
  });

  it('flags resting HR spikes and suppresses normal day-to-day fluctuations', () => {
    const baseline = [60, 59, 61, 60, 62, 58, 60];
    expect(
      detectMetricDeviations({
        type: 'resting_hr',
        latestValue: 62,
        latestTimestamp: '2026-11-13T08:00:00.000Z',
        unit: 'bpm',
        baselineValues: baseline,
      })
    ).toBeNull();

    const warning = detectMetricDeviations({
      type: 'resting_hr',
      latestValue: 69,
      latestTimestamp: '2026-11-13T08:00:00.000Z',
      unit: 'bpm',
      baselineValues: baseline,
    });
    expect(warning?.severity).toBe('warning');

    const critical = detectMetricDeviations({
      type: 'resting_hr',
      latestValue: 78,
      latestTimestamp: '2026-11-13T08:00:00.000Z',
      unit: 'bpm',
      baselineValues: baseline,
    });
    expect(critical?.severity).toBe('critical');
  });

  it('flags HRV drops, sleep deficit, glucose spikes, and weight shifts while respecting baseline rules', () => {
    const hrvDrop = detectMetricDeviations({
      type: 'hrv',
      latestValue: 32,
      latestTimestamp: '2026-11-13T08:00:00.000Z',
      unit: 'ms',
      baselineValues: [54, 56, 52, 55, 53],
    });
    expect(hrvDrop?.severity).toBe('critical');

    const sleepDeficit = detectMetricDeviations({
      type: 'sleep_duration',
      latestValue: 280,
      latestTimestamp: '2026-11-13T08:00:00.000Z',
      unit: 'min',
      baselineValues: [430, 440, 425, 435],
    });
    expect(sleepDeficit?.severity).toBe('warning');

    const weightShift = detectMetricDeviations({
      type: 'weight',
      latestValue: 68.2,
      latestTimestamp: '2026-11-13T08:00:00.000Z',
      unit: 'kg',
      baselineValues: [65.3, 65.2, 65.4, 65.1],
    });
    expect(weightShift?.severity).toBe('warning');

    // Insufficient baseline (< 3 readings) should NOT emit relative resting_hr alert
    expect(
      detectMetricDeviations({
        type: 'resting_hr',
        latestValue: 78,
        latestTimestamp: '2026-11-13T08:00:00.000Z',
        unit: 'bpm',
        baselineValues: [60, 61],
      })
    ).toBeNull();

    // Absolute clinical limits (e.g. SpO2 <= 90) still trigger even without baseline
    const criticalSpo2 = detectMetricDeviations({
      type: 'spo2',
      latestValue: 89,
      latestTimestamp: '2026-11-13T08:00:00.000Z',
      unit: '%',
      baselineValues: [],
    });
    expect(criticalSpo2?.severity).toBe('critical');
  });
});
