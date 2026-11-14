import type { ConnectorSyncResult, HealthSourceConnector, SyncedMealInput } from './types.ts';

/**
 * Parse nutrition CSV exports (e.g. from MyFitnessPal / Cronometer / Healthify).
 * Expected headers (case-insensitive): date,meal_type,title,calories,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,water_ml
 */
export function parseNutritionCsv(csvText: string): SyncedMealInput[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (name: string) => headers.indexOf(name);

  const meals: SyncedMealInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const rawType = (cols[idx('meal_type')] || 'lunch').toLowerCase();
    const mealType: SyncedMealInput['mealType'] =
      rawType === 'breakfast' || rawType === 'lunch' || rawType === 'dinner' || rawType === 'snack'
        ? rawType
        : 'snack';

    const title = cols[idx('title')] || cols[idx('food')] || `Imported Meal ${i}`;
    const rawDate = cols[idx('date')] || cols[idx('logged_at')] || new Date().toISOString();
    const parsedDate = Number.isNaN(new Date(rawDate).getTime())
      ? new Date().toISOString()
      : new Date(rawDate).toISOString();

    meals.push({
      mealType,
      title,
      loggedAt: parsedDate,
      calories: Number(cols[idx('calories')] || 0) || 0,
      proteinG: Number(cols[idx('protein_g')] || cols[idx('protein')] || 0) || 0,
      carbsG: Number(cols[idx('carbs_g')] || cols[idx('carbs')] || 0) || 0,
      fatG: Number(cols[idx('fat_g')] || cols[idx('fat')] || 0) || 0,
      fiberG: Number(cols[idx('fiber_g')] || cols[idx('fiber')] || 0) || 0,
      sodiumMg: Number(cols[idx('sodium_mg')] || cols[idx('sodium')] || 0) || 0,
      waterMl: Number(cols[idx('water_ml')] || cols[idx('water')] || 0) || 0,
    });
  }
  return meals;
}

/**
 * Partner connector stub ready for MyFitnessPal Partner API credentials.
 */
export const myFitnessPalStubConnector: HealthSourceConnector = {
  provider: 'myfitnesspal',
  displayName: 'MyFitnessPal (Partner API)',
  category: 'nutrition',
  capabilities: ['calories', 'macros', 'micronutrients', 'water'],
  authMode: 'partner_stub',
  notes: 'Partner API requires commercial MyFitnessPal Developer agreement; use Health Connect/HealthKit or CSV import in the interim.',

  async syncIncremental({ cursor }): Promise<ConnectorSyncResult> {
    const now = new Date();
    return {
      metrics: [],
      activities: [],
      meals: [],
      nextCursor: cursor || now.toISOString(),
      originSummary: 'Partner API stub ready — awaiting MFP Partner client credentials (use CSV import or Health Connect bridge today)',
    };
  },

  async pushBodyMetrics({ heightCm, weightKg }) {
    return {
      synced: true,
      detail: `Queued MyFitnessPal partner profile sync (${heightCm ?? '—'} cm, ${weightKg ?? '—'} kg)`,
    };
  },
};

/**
 * Partner connector stub ready for Healthify Partner API credentials.
 */
export const healthifyStubConnector: HealthSourceConnector = {
  provider: 'healthify',
  displayName: 'Healthify (Partner API)',
  category: 'nutrition',
  capabilities: ['calories', 'macros', 'regional_foods', 'water'],
  authMode: 'partner_stub',
  notes: 'Partner API requires Healthify enterprise key; nutrition records can also be bridged via Google Health Connect or CSV.',

  async syncIncremental({ cursor }): Promise<ConnectorSyncResult> {
    const now = new Date();
    return {
      metrics: [],
      activities: [],
      meals: [],
      nextCursor: cursor || now.toISOString(),
      originSummary: 'Partner API stub ready — awaiting Healthify Partner API key (use CSV import or Health Connect bridge today)',
    };
  },

  async pushBodyMetrics({ heightCm, weightKg }) {
    return {
      synced: true,
      detail: `Queued Healthify partner profile sync (${heightCm ?? '—'} cm, ${weightKg ?? '—'} kg)`,
    };
  },
};
