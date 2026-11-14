export type UserRole = 'individual' | 'professional' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
  onboardingCompleted: boolean;
  consentFlags: Record<string, unknown>;
  biometricLockEnabled: boolean;
  heightCm: number | null;
  weightKg: number | null;
}

export interface SourceItem {
  provider: string;
  displayName: string;
  category: 'os_aggregator' | 'activity' | 'nutrition';
  capabilities: string[];
  authMode: 'oauth2' | 'device_permission' | 'partner_stub' | 'manual';
  notes: string;
  connectedId: string | null;
  status: 'connected' | 'syncing' | 'error' | 'disconnected';
  lastSyncedAt: string | null;
  lastError: string | null;
  priorityRank: number;
  stravaOAuthConfigured?: boolean;
}

export interface MetricPoint {
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
}

export interface ActivityRow {
  id: string;
  external_id: string;
  source_provider: string;
  activity_type: string;
  title: string;
  start_time: string;
  duration_sec: number;
  distance_m: number;
  elevation_gain_m: number;
  calories: number;
  avg_hr: number | null;
  max_hr: number | null;
  avg_pace_sec_per_km: number | null;
  is_primary: number;
}

export interface MealRow {
  id: string;
  source_provider: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  title: string;
  logged_at: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  water_ml: number;
  notes: string | null;
}

export interface LabReport {
  id: string;
  title: string;
  lab_name: string;
  collected_at: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  ocr_raw_text?: string;
  status: 'pending_review' | 'confirmed' | 'archived';
  created_at: string;
}

export interface LabResult {
  id: string;
  report_id: string;
  test_name: string;
  test_code: string;
  value: number;
  unit: string;
  reference_low: number | null;
  reference_high: number | null;
  reference_text: string;
  flag: 'normal' | 'low' | 'high' | 'critical_low' | 'critical_high';
  confirmed: number;
  collected_at: string;
}

export interface EscalationAlert {
  triggered: boolean;
  level: 'none' | 'urgent';
  message: string;
  triggers: string[];
}

export interface AIEvaluation {
  id: string;
  overallScore: number;
  subScores: {
    cardiovascular: number;
    sleep: number;
    activity: number;
    nutrition: number;
    metabolicLabs: number;
    recoveryStress: number;
  };
  summary: string;
  strengths: string[];
  concerns: string[];
  trends: {
    days7: string;
    days30: string;
    days90: string;
  };
  correlations: Array<{ pair: string; finding: string }>;
  recommendations: Array<{
    priority: number;
    title: string;
    rationale: string;
    category: string;
  }>;
  escalationAlert: EscalationAlert;
  disclaimer: string;
  modelUsed: string;
  createdAt: string;
}

export interface HealthAlertItem {
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

export interface BodyProfile {
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
}

export interface HealthSnapshot {
  rangeDays: number;
  latestByType: Record<
    string,
    { value: number; unit: string; timestamp: string; source: string; originApp: string }
  >;
  metrics: MetricPoint[];
  suppressedDuplicatesCount: number;
  activities: ActivityRow[];
  meals: MealRow[];
  labReports: LabReport[];
  labResults: LabResult[];
  latestEvaluation: AIEvaluation | null;
  safetyEscalation: EscalationAlert;
  alerts: {
    active: HealthAlertItem[];
    acknowledged: HealthAlertItem[];
  };
  bodyProfile: BodyProfile;
}

export interface ShareRecord {
  id: string;
  grantee_email: string;
  grantee_name: string;
  grantee_role: 'doctor' | 'coach' | 'dietician';
  share_token: string;
  shareUrl: string;
  scopes: string[];
  range_days: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  actor_email: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string;
  created_at: string;
}

export interface NoteRow {
  id: string;
  patient_user_id: string;
  author_name: string;
  author_role: string;
  category: string;
  content: string;
  is_recommendation: number;
  created_at: string;
}

export interface MessageRow {
  id: string;
  patient_user_id: string;
  professional_email: string;
  sender_user_id: string;
  sender_name: string;
  sender_role: string;
  body: string;
  created_at: string;
}
