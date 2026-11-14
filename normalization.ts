export type SourceProvider =
  | 'health_connect'
  | 'healthkit'
  | 'strava'
  | 'myfitnesspal'
  | 'healthify'
  | 'manual'
  | 'csv';

export type MetricCategory =
  | 'steps'
  | 'heart_rate'
  | 'resting_hr'
  | 'hrv'
  | 'sleep_duration'
  | 'sleep_deep'
  | 'sleep_rem'
  | 'sleep_light'
  | 'sleep_awake'
  | 'spo2'
  | 'weight'
  | 'bmi'
  | 'bp_systolic'
  | 'bp_diastolic'
  | 'glucose'
  | 'vo2_max'
  | 'water';

export type LabFlag = 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';

/**
 * Source priority matrix per domain. Higher number wins when overlapping
 * records arrive for the same time bucket across multiple sources.
 * - Wearables/OS aggregators win for physiological vitals & sleep.
 * - Strava wins for dedicated workouts/runs/rides.
 * - Nutrition apps & manual logs win for meals/hydration.
 */
export const SOURCE_PRIORITY: Record<'vitals' | 'sleep' | 'activity' | 'nutrition', Record<SourceProvider, number>> = {
  vitals: {
    healthkit: 10,
    health_connect: 9,
    strava: 5,
    manual: 4,
    csv: 3,
    myfitnesspal: 2,
    healthify: 2,
  },
  sleep: {
    healthkit: 10,
    health_connect: 9,
    manual: 4,
    csv: 3,
    strava: 1,
    myfitnesspal: 1,
    healthify: 1,
  },
  activity: {
    strava: 10,
    healthkit: 8,
    health_connect: 8,
    manual: 5,
    csv: 4,
    myfitnesspal: 2,
    healthify: 2,
  },
  nutrition: {
    myfitnesspal: 10,
    healthify: 10,
    manual: 9,
    health_connect: 7,
    healthkit: 7,
    csv: 6,
    strava: 1,
  },
};

export function getMetricDomain(type: string): 'vitals' | 'sleep' | 'activity' | 'nutrition' {
  if (type.startsWith('sleep_')) return 'sleep';
  if (type === 'steps' || type === 'vo2_max') return 'activity';
  if (type === 'water') return 'nutrition';
  return 'vitals';
}

export function getSourcePriority(typeOrDomain: string, provider: SourceProvider): number {
  const domain =
    typeOrDomain === 'vitals' ||
    typeOrDomain === 'sleep' ||
    typeOrDomain === 'activity' ||
    typeOrDomain === 'nutrition'
      ? typeOrDomain
      : getMetricDomain(typeOrDomain);
  return SOURCE_PRIORITY[domain][provider] ?? 1;
}

/**
 * Convert heterogeneous incoming units into VitalHub canonical SI/clinical units.
 */
export function normalizeMetricUnit(
  type: string,
  value: number,
  unit: string
): { canonicalValue: number; canonicalUnit: string } {
  const normalizedUnit = unit.trim().toLowerCase();

  // Weight -> kg
  if (type === 'weight') {
    if (normalizedUnit === 'lb' || normalizedUnit === 'lbs' || normalizedUnit === 'pounds') {
      return { canonicalValue: Number((value * 0.45359237).toFixed(2)), canonicalUnit: 'kg' };
    }
    if (normalizedUnit === 'g') {
      return { canonicalValue: Number((value / 1000).toFixed(2)), canonicalUnit: 'kg' };
    }
    return { canonicalValue: Number(value.toFixed(2)), canonicalUnit: 'kg' };
  }

  // Height -> cm
  if (type === 'height') {
    if (normalizedUnit === 'm' || normalizedUnit === 'meters') {
      return { canonicalValue: Number((value * 100).toFixed(1)), canonicalUnit: 'cm' };
    }
    if (normalizedUnit === 'in' || normalizedUnit === 'inch' || normalizedUnit === 'inches') {
      return { canonicalValue: Number((value * 2.54).toFixed(1)), canonicalUnit: 'cm' };
    }
    if (normalizedUnit === 'ft' || normalizedUnit === 'feet') {
      return { canonicalValue: Number((value * 30.48).toFixed(1)), canonicalUnit: 'cm' };
    }
    return { canonicalValue: Number(value.toFixed(1)), canonicalUnit: 'cm' };
  }

  // Glucose -> mg/dL
  if (type === 'glucose') {
    if (normalizedUnit === 'mmol/l' || normalizedUnit === 'mmol') {
      return { canonicalValue: Math.round(value * 18.0182), canonicalUnit: 'mg/dL' };
    }
    return { canonicalValue: Math.round(value), canonicalUnit: 'mg/dL' };
  }

  // Hydration -> ml
  if (type === 'water') {
    if (normalizedUnit === 'l' || normalizedUnit === 'liters') {
      return { canonicalValue: Math.round(value * 1000), canonicalUnit: 'ml' };
    }
    if (normalizedUnit === 'fl oz' || normalizedUnit === 'oz') {
      return { canonicalValue: Math.round(value * 29.5735), canonicalUnit: 'ml' };
    }
    return { canonicalValue: Math.round(value), canonicalUnit: 'ml' };
  }

  // Sleep durations -> min
  if (type.startsWith('sleep_')) {
    if (normalizedUnit === 'hr' || normalizedUnit === 'hrs' || normalizedUnit === 'hours' || normalizedUnit === 'h') {
      return { canonicalValue: Math.round(value * 60), canonicalUnit: 'min' };
    }
    if (normalizedUnit === 'sec' || normalizedUnit === 's') {
      return { canonicalValue: Math.round(value / 60), canonicalUnit: 'min' };
    }
    return { canonicalValue: Math.round(value), canonicalUnit: 'min' };
  }

  // Distance -> m
  if (type === 'distance') {
    if (normalizedUnit === 'km') {
      return { canonicalValue: Math.round(value * 1000), canonicalUnit: 'm' };
    }
    if (normalizedUnit === 'mi' || normalizedUnit === 'miles') {
      return { canonicalValue: Math.round(value * 1609.344), canonicalUnit: 'm' };
    }
    return { canonicalValue: Math.round(value), canonicalUnit: 'm' };
  }

  // Energy -> kcal
  if (type === 'calories') {
    if (normalizedUnit === 'kj') {
      return { canonicalValue: Math.round(value / 4.184), canonicalUnit: 'kcal' };
    }
    return { canonicalValue: Math.round(value), canonicalUnit: 'kcal' };
  }

  // Default canonical mappings
  const canonicalUnits: Record<string, string> = {
    steps: 'count',
    heart_rate: 'bpm',
    resting_hr: 'bpm',
    hrv: 'ms',
    spo2: '%',
    height: 'cm',
    bmi: 'kg/m2',
    bp_systolic: 'mmHg',
    bp_diastolic: 'mmHg',
    vo2_max: 'mL/kg/min',
  };

  return {
    canonicalValue: Number(value.toFixed(2)),
    canonicalUnit: canonicalUnits[type] || unit,
  };
}

/**
 * Bucket timestamps for cross-source deduplication.
 * - Daily aggregates (steps, resting_hr, sleep_*, weight, height, bmi, water): UTC date bucket.
 * - Intraday vitals (heart_rate, glucose, bp_*): 15-minute bucket.
 */
export function buildMetricDedupBucket(type: string, isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${isoTimestamp}`);
  }
  const dailyTypes = new Set([
    'steps',
    'resting_hr',
    'hrv',
    'sleep_duration',
    'sleep_deep',
    'sleep_rem',
    'sleep_light',
    'sleep_awake',
    'weight',
    'height',
    'bmi',
    'vo2_max',
    'water',
  ]);
  if (dailyTypes.has(type)) {
    return `${type}:${date.toISOString().slice(0, 10)}`;
  }
  const bucketMs = 15 * 60 * 1000;
  const floored = new Date(Math.floor(date.getTime() / bucketMs) * bucketMs).toISOString();
  return `${type}:${floored}`;
}

/**
 * Activity deduplication bucket: activity type + 10-minute start window
 * so a Strava run and a HealthKit run recorded at the same time collapse cleanly.
 */
export function buildActivityDedupKey(activityType: string, startTimeIso: string): string {
  const date = new Date(startTimeIso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid activity startTime: ${startTimeIso}`);
  }
  const bucketMs = 10 * 60 * 1000;
  const floored = new Date(Math.floor(date.getTime() / bucketMs) * bucketMs).toISOString();
  return `${activityType.toLowerCase()}:${floored}`;
}

/**
 * Flag lab biomarkers against reference intervals with critical thresholds.
 */
export function evaluateLabFlag(
  value: number,
  low: number | null | undefined,
  high: number | null | undefined,
  testName?: string
): LabFlag {
  const name = (testName || '').toLowerCase();

  // Critical threshold rules for common high-risk biomarkers
  if (name.includes('glucose') && (value >= 250 || value <= 54)) {
    return value >= 250 ? 'critical_high' : 'critical_low';
  }
  if (name.includes('potassium') && (value >= 6.0 || value <= 2.8)) {
    return value >= 6.0 ? 'critical_high' : 'critical_low';
  }
  if ((name.includes('hba1c') || name.includes('a1c')) && value >= 9.0) {
    return 'critical_high';
  }

  if (typeof high === 'number' && value > high) {
    if (value > high * 1.4 && high > 0) return 'critical_high';
    return 'high';
  }
  if (typeof low === 'number' && value < low) {
    if (value < low * 0.6 && low > 0) return 'critical_low';
    return 'low';
  }
  return 'normal';
}

export interface EscalationCheckInput {
  latestSystolicBp?: number | null;
  latestDiastolicBp?: number | null;
  latestGlucoseMgDl?: number | null;
  latestSpo2?: number | null;
  criticalLabs?: Array<{ testName: string; value: number; unit: string; flag: string }>;
}

export interface EscalationAlert {
  triggered: boolean;
  level: 'none' | 'urgent';
  message: string;
  triggers: string[];
}

/**
 * Deterministic safety guardrail checking vital signs & critical labs for urgent care escalation.
 */
export function checkSafetyEscalation(input: EscalationCheckInput): EscalationAlert {
  const triggers: string[] = [];

  if (
    (typeof input.latestSystolicBp === 'number' && input.latestSystolicBp >= 180) ||
    (typeof input.latestDiastolicBp === 'number' && input.latestDiastolicBp >= 120)
  ) {
    triggers.push(
      `Blood pressure reading (${input.latestSystolicBp ?? '?'}/${input.latestDiastolicBp ?? '?'} mmHg) meets hypertensive crisis threshold (>=180/120 mmHg).`
    );
  }

  if (typeof input.latestGlucoseMgDl === 'number') {
    if (input.latestGlucoseMgDl >= 250) {
      triggers.push(`Blood glucose (${input.latestGlucoseMgDl} mg/dL) is severely elevated (>=250 mg/dL).`);
    } else if (input.latestGlucoseMgDl <= 54) {
      triggers.push(`Blood glucose (${input.latestGlucoseMgDl} mg/dL) indicates clinically significant hypoglycemia (<=54 mg/dL).`);
    }
  }

  if (typeof input.latestSpo2 === 'number' && input.latestSpo2 <= 90) {
    triggers.push(`Blood oxygen saturation (${input.latestSpo2}%) is critically low (<=90%).`);
  }

  if (input.criticalLabs && input.criticalLabs.length > 0) {
    for (const lab of input.criticalLabs) {
      if (lab.flag === 'critical_high' || lab.flag === 'critical_low') {
        triggers.push(`Critical lab value: ${lab.testName} at ${lab.value} ${lab.unit}.`);
      }
    }
  }

  if (triggers.length === 0) {
    return { triggered: false, level: 'none', message: '', triggers: [] };
  }

  return {
    triggered: true,
    level: 'urgent',
    message:
      'One or more recent readings crossed urgent clinical thresholds. Seek prompt evaluation from a licensed physician or urgent care service, especially if experiencing chest pain, shortness of breath, dizziness, or confusion.',
    triggers,
  };
}

export interface MetricDeviationAlert {
  metricType: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  currentValue: number;
  baselineValue: number;
  unit: string;
  deltaPct: number;
  detectedAt: string;
  dedupKey: string;
}

/**
 * Evaluate the latest metric reading against the user's trailing baseline values
 * (and absolute physiological safety limits) to flag significant deviations.
 */
export function detectMetricDeviations(params: {
  type: string;
  latestValue: number;
  latestTimestamp: string;
  unit: string;
  baselineValues: number[];
}): MetricDeviationAlert | null {
  const { type, latestValue, latestTimestamp, unit, baselineValues } = params;
  if (!Number.isFinite(latestValue)) return null;

  const hasBaseline = baselineValues.length >= 3;
  const baselineAvg = hasBaseline
    ? baselineValues.reduce((sum, v) => sum + v, 0) / baselineValues.length
    : latestValue;

  const delta = latestValue - baselineAvg;
  const deltaPct = baselineAvg !== 0 ? Number(((delta / baselineAvg) * 100).toFixed(1)) : 0;
  const dayKey = latestTimestamp.slice(0, 10);

  if (type === 'resting_hr' && hasBaseline) {
    if (delta >= 14 || deltaPct >= 22) {
      return {
        metricType: type,
        severity: 'critical',
        title: 'Significant Resting Heart Rate Spike',
        message: `Resting HR jumped to ${Math.round(latestValue)} bpm (+${Math.round(delta)} bpm / +${deltaPct}% vs 14-day baseline of ${Math.round(baselineAvg)} bpm). Monitor recovery, hydration, or acute illness symptoms.`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:spike:${dayKey}`,
      };
    }
    if (delta >= 7 || deltaPct >= 12) {
      return {
        metricType: type,
        severity: 'warning',
        title: 'Elevated Resting Heart Rate',
        message: `Resting HR rose to ${Math.round(latestValue)} bpm (+${Math.round(delta)} bpm / +${deltaPct}% above your 14-day average of ${Math.round(baselineAvg)} bpm).`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:elevated:${dayKey}`,
      };
    }
  }

  if (type === 'hrv' && hasBaseline) {
    if (deltaPct <= -35) {
      return {
        metricType: type,
        severity: 'critical',
        title: 'Sharp HRV Suppression',
        message: `HRV dropped to ${Math.round(latestValue)} ms (${deltaPct}% below 14-day baseline of ${Math.round(baselineAvg)} ms), indicating high autonomic strain.`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:drop:${dayKey}`,
      };
    }
    if (deltaPct <= -20) {
      return {
        metricType: type,
        severity: 'warning',
        title: 'Low Heart Rate Variability',
        message: `HRV declined to ${Math.round(latestValue)} ms (${deltaPct}% below 14-day baseline of ${Math.round(baselineAvg)} ms). Consider lighter recovery today.`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:low:${dayKey}`,
      };
    }
  }

  if (type === 'bp_systolic') {
    if (latestValue >= 180) {
      return {
        metricType: type,
        severity: 'critical',
        title: 'Urgent Systolic Blood Pressure Spike',
        message: `Systolic BP reached ${Math.round(latestValue)} mmHg (baseline ${Math.round(baselineAvg)} mmHg). Seek prompt medical evaluation.`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:crisis:${dayKey}`,
      };
    }
    if (latestValue >= 140 || (hasBaseline && delta >= 15)) {
      return {
        metricType: type,
        severity: 'warning',
        title: 'Elevated Systolic Blood Pressure',
        message: `Systolic BP measured ${Math.round(latestValue)} mmHg (+${Math.round(delta)} mmHg vs recent baseline ${Math.round(baselineAvg)} mmHg).`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:elevated:${dayKey}`,
      };
    }
  }

  if (type === 'bp_diastolic') {
    if (latestValue >= 120) {
      return {
        metricType: type,
        severity: 'critical',
        title: 'Urgent Diastolic Blood Pressure Spike',
        message: `Diastolic BP reached ${Math.round(latestValue)} mmHg. Seek prompt medical evaluation.`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:crisis:${dayKey}`,
      };
    }
    if (latestValue >= 90 || (hasBaseline && delta >= 10)) {
      return {
        metricType: type,
        severity: 'warning',
        title: 'Elevated Diastolic Blood Pressure',
        message: `Diastolic BP measured ${Math.round(latestValue)} mmHg (baseline ${Math.round(baselineAvg)} mmHg).`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:elevated:${dayKey}`,
      };
    }
  }

  if (type === 'glucose') {
    if (latestValue >= 250 || latestValue <= 54) {
      return {
        metricType: type,
        severity: 'critical',
        title: latestValue >= 250 ? 'Severe Hyperglycemia Alert' : 'Severe Hypoglycemia Alert',
        message: `Blood glucose recorded at ${Math.round(latestValue)} mg/dL. Follow urgent clinical care guidance.`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:critical:${dayKey}`,
      };
    }
    if (latestValue >= 180 || (hasBaseline && deltaPct >= 25)) {
      return {
        metricType: type,
        severity: 'warning',
        title: 'Blood Glucose Spike Detected',
        message: `Glucose rose to ${Math.round(latestValue)} mg/dL (+${deltaPct}% vs 14-day average of ${Math.round(baselineAvg)} mg/dL).`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:spike:${dayKey}`,
      };
    }
  }

  if (type === 'spo2') {
    if (latestValue <= 90) {
      return {
        metricType: type,
        severity: 'critical',
        title: 'Critical SpO2 Drop',
        message: `Blood oxygen saturation dropped to ${latestValue}%. Seek prompt medical care.`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:critical:${dayKey}`,
      };
    }
    if (latestValue <= 94) {
      return {
        metricType: type,
        severity: 'warning',
        title: 'Below-Normal SpO2 Reading',
        message: `Oxygen saturation dipped to ${latestValue}% (baseline ${baselineAvg.toFixed(1)}%).`,
        currentValue: latestValue,
        baselineValue: Number(baselineAvg.toFixed(1)),
        unit,
        deltaPct,
        detectedAt: latestTimestamp,
        dedupKey: `${type}:low:${dayKey}`,
      };
    }
  }

  if (type === 'sleep_duration' && hasBaseline && deltaPct <= -25) {
    return {
      metricType: type,
      severity: 'warning',
      title: 'Acute Sleep Deficit',
      message: `Sleep fell to ${(latestValue / 60).toFixed(1)} hrs (${deltaPct}% vs 14-day baseline of ${(baselineAvg / 60).toFixed(1)} hrs).`,
      currentValue: latestValue,
      baselineValue: Number(baselineAvg.toFixed(1)),
      unit,
      deltaPct,
      detectedAt: latestTimestamp,
      dedupKey: `${type}:deficit:${dayKey}`,
    };
  }

  if (type === 'weight' && hasBaseline && Math.abs(deltaPct) >= 3) {
    return {
      metricType: type,
      severity: 'warning',
      title: delta > 0 ? 'Rapid Weight Increase' : 'Rapid Weight Decrease',
      message: `Body weight shifted to ${latestValue.toFixed(1)} kg (${deltaPct > 0 ? '+' : ''}${deltaPct}% vs 14-day baseline of ${baselineAvg.toFixed(1)} kg).`,
      currentValue: latestValue,
      baselineValue: Number(baselineAvg.toFixed(1)),
      unit,
      deltaPct,
      detectedAt: latestTimestamp,
      dedupKey: `${type}:shift:${dayKey}`,
    };
  }

  return null;
}

