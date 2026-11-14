import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  askHealthDataWithGemini,
  extractLabReportWithGemini,
  generateHealthEvaluationWithGemini,
} from './server/ai.ts';
import {
  acknowledgeAllHealthAlerts,
  acknowledgeHealthAlert,
  evaluateAndStoreHealthAlerts,
  listHealthAlerts,
} from './server/alerts.ts';
import {
  clearSessionCookie,
  loadUserById,
  requireAuth,
  requireRole,
  setSessionCookie,
  signSessionToken,
  type AuthenticatedRequest,
  type UserRole,
} from './server/auth.ts';
import { parseNutritionCsv } from './server/connectors/nutritionConnectors.ts';
import {
  listSupportedConnectors,
  propagateBodyMetricsToConnectedApps,
  syncSourceForUser,
} from './server/connectors/registry.ts';
import { stravaConnector } from './server/connectors/strava.ts';
import { decryptBuffer, encryptBuffer, encryptField } from './server/crypto.ts';
import {
  db,
  runMigrations,
  seedDemoDataIfEmpty,
  upsertMetricWithResolution,
  writeAuditLog,
} from './server/db.ts';
import {
  evaluateLabFlag,
  getSourcePriority,
  normalizeMetricUnit,
  type SourceProvider,
} from './server/normalization.ts';
import { buildUserHealthSnapshot } from './server/queries.ts';

runMigrations();
seedDemoDataIfEmpty();

const app = express();
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

function getAppBaseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// 1. AUTHENTICATION, DEMO SWITCHER & CONSENT
// ---------------------------------------------------------------------------

app.post('/api/auth/register', (req, res) => {
  const { email, password, name, role } = req.body as {
    email?: string;
    password?: string;
    name?: string;
    role?: UserRole;
  };
  if (!email || !password || !name) {
    res.status(400).json({ error: 'Name, email, and password are required.' });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const assignedRole: UserRole = role === 'professional' ? 'professional' : 'individual';
  const id = `usr_${crypto.randomUUID().slice(0, 12)}`;
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, onboarding_completed, consent_flags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, normalizedEmail, passwordHash, name.trim(), assignedRole, assignedRole === 'professional' ? 1 : 0, '{}', now);

  writeAuditLog({
    userId: id,
    actorUserId: id,
    actorEmail: normalizedEmail,
    actorRole: assignedRole,
    action: 'USER_REGISTERED',
    resourceType: 'user',
    resourceId: id,
    ipAddress: req.ip,
  });

  const token = signSessionToken({ id, role: assignedRole });
  setSessionCookie(res, token);
  res.status(201).json({ user: loadUserById(id), token });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  const row = db
    .prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as
    | { id: string; email: string; password_hash: string; role: UserRole }
    | undefined;

  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  writeAuditLog({
    userId: row.id,
    actorUserId: row.id,
    actorEmail: row.email,
    actorRole: row.role,
    action: 'USER_LOGIN',
    resourceType: 'session',
    ipAddress: req.ip,
  });

  const token = signSessionToken({ id: row.id, role: row.role });
  setSessionCookie(res, token);
  res.json({ user: loadUserById(row.id), token });
});

app.post('/api/auth/demo', (req, res) => {
  const { role } = req.body as { role?: UserRole };
  const targetEmail =
    role === 'professional'
      ? 'dr.elena@vitalhub.app'
      : role === 'admin'
        ? 'admin@vitalhub.app'
        : 'maya.lin@vitalhub.app';

  const row = db
    .prepare('SELECT id, email, role FROM users WHERE email = ?')
    .get(targetEmail) as { id: string; email: string; role: UserRole } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Demo account not found.' });
    return;
  }

  const token = signSessionToken({ id: row.id, role: row.role });
  setSessionCookie(res, token);
  res.json({ user: loadUserById(row.id), token });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser });
});

app.post('/api/auth/consent', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { consentFlags, completeOnboarding } = req.body as {
    consentFlags: Record<string, unknown>;
    completeOnboarding?: boolean;
  };
  const updated = {
    ...user.consentFlags,
    ...consentFlags,
    updatedAt: new Date().toISOString(),
  };

  db.prepare(
    'UPDATE users SET consent_flags_json = ?, onboarding_completed = COALESCE(?, onboarding_completed) WHERE id = ?'
  ).run(JSON.stringify(updated), completeOnboarding ? 1 : null, user.id);

  writeAuditLog({
    userId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'CONSENT_UPDATED',
    resourceType: 'user',
    resourceId: user.id,
    details: updated,
    ipAddress: req.ip,
  });

  res.json({ user: loadUserById(user.id) });
});

app.post('/api/auth/biometric', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { enabled } = req.body as { enabled: boolean };
  db.prepare('UPDATE users SET biometric_lock_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, user.id);
  res.json({ user: loadUserById(user.id) });
});

// ---------------------------------------------------------------------------
// 2. DATA SOURCES & PLUGGABLE CONNECTORS (HEALTH CONNECT, HEALTHKIT, STRAVA)
// ---------------------------------------------------------------------------

app.get('/api/sources', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const catalog = listSupportedConnectors();
  const userSources = db
    .prepare(
      `SELECT id, provider, display_name, status, scopes_json, last_synced_at, last_error, priority_rank
       FROM sources WHERE user_id = ?`
    )
    .all(user.id) as Array<{
    id: string;
    provider: string;
    display_name: string;
    status: string;
    scopes_json: string;
    last_synced_at: string | null;
    last_error: string | null;
    priority_rank: number;
  }>;

  const byProvider = new Map(userSources.map((s) => [s.provider, s]));
  const merged = catalog.map((c) => {
    const connected = byProvider.get(c.provider);
    return {
      ...c,
      connectedId: connected?.id ?? null,
      status: connected?.status ?? 'disconnected',
      lastSyncedAt: connected?.last_synced_at ?? null,
      lastError: connected?.last_error ?? null,
      priorityRank: connected?.priority_rank ?? getSourcePriority('vitals', c.provider),
      stravaOAuthConfigured: c.provider === 'strava' ? Boolean(process.env.STRAVA_CLIENT_ID) : undefined,
    };
  });

  res.json({ sources: merged });
});

app.get('/api/sources/strava/auth-url', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (!process.env.STRAVA_CLIENT_ID) {
    res.json({
      configured: false,
      callbackUrl: `${getAppBaseUrl()}/auth/callback`,
      message: 'STRAVA_CLIENT_ID not set — you can still test incremental sync using sandbox mode.',
    });
    return;
  }

  const statePayload = Buffer.from(JSON.stringify({ userId: user.id, nonce: crypto.randomUUID() })).toString(
    'base64url'
  );
  const redirectUri = `${getAppBaseUrl()}/auth/callback`;
  const url = stravaConnector.getAuthUrl!(user.id, redirectUri, statePayload);
  res.json({ configured: true, url, callbackUrl: redirectUri });
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error || !code || !state) {
    res.status(400).send(`<html><body><p>Strava OAuth cancelled or failed: ${error || 'missing code'}</p></body></html>`);
    return;
  }

  try {
    const decodedState = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { userId: string };
    const redirectUri = `${getAppBaseUrl()}/auth/callback`;
    const tokens = await stravaConnector.handleCallback!(code, redirectUri);

    const existing = db
      .prepare("SELECT id FROM sources WHERE user_id = ? AND provider = 'strava'")
      .get(decodedState.userId) as { id: string } | undefined;

    const now = new Date().toISOString();
    if (existing) {
      db.prepare(
        `UPDATE sources SET status = 'connected', access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?, scopes_json = ?, last_error = NULL
         WHERE id = ?`
      ).run(
        encryptField(tokens.accessToken),
        tokens.refreshToken ? encryptField(tokens.refreshToken) : null,
        tokens.expiresAt ?? null,
        JSON.stringify(tokens.scopes),
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO sources (id, user_id, provider, display_name, status, access_token_enc, refresh_token_enc, token_expires_at, scopes_json, priority_rank, created_at)
         VALUES (?, ?, 'strava', 'Strava', 'connected', ?, ?, ?, ?, 10, ?)`
      ).run(
        crypto.randomUUID(),
        decodedState.userId,
        encryptField(tokens.accessToken),
        tokens.refreshToken ? encryptField(tokens.refreshToken) : null,
        tokens.expiresAt ?? null,
        JSON.stringify(tokens.scopes),
        now
      );
    }

    const owner = loadUserById(decodedState.userId);
    if (owner) {
      await syncSourceForUser({
        userId: owner.id,
        actorEmail: owner.email,
        actorRole: owner.role,
        provider: 'strava',
      });
    }

    res.send(`
      <html>
        <body style="background:#0A0F14;color:#E2E8F0;font-family:sans-serif;padding:24px;">
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'strava' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Strava connected successfully. This window will close automatically.</p>
        </body>
      </html>
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    res.status(500).send(`<html><body><p>Strava OAuth error: ${msg}</p></body></html>`);
  }
});

app.post('/api/sources/:provider/sync', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const provider = req.params.provider as SourceProvider;
  try {
    const result = await syncSourceForUser({
      userId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      provider,
      payload: req.body?.payload,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

app.post('/api/sources/:provider/disconnect', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const provider = req.params.provider;
  db.prepare(
    "UPDATE sources SET status = 'disconnected', access_token_enc = NULL, refresh_token_enc = NULL WHERE user_id = ? AND provider = ?"
  ).run(user.id, provider);

  writeAuditLog({
    userId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'SOURCE_DISCONNECTED',
    resourceType: 'source',
    details: { provider },
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 3. DASHBOARD, METRICS, ACTIVITIES, NUTRITION & MANUAL/CSV LOGGING
// ---------------------------------------------------------------------------

app.get('/api/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const rangeDays = Math.min(90, Math.max(7, Number(req.query.rangeDays || 30)));
  const snapshot = buildUserHealthSnapshot(user.id, rangeDays);
  res.json(snapshot);
});

app.post('/api/metrics', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { type, value, unit, timestamp } = req.body as {
    type?: string;
    value?: number;
    unit?: string;
    timestamp?: string;
  };
  if (!type || typeof value !== 'number' || !unit) {
    res.status(400).json({ error: 'type, numeric value, and unit are required.' });
    return;
  }

  const ts = timestamp || new Date().toISOString();
  const result = upsertMetricWithResolution({
    userId: user.id,
    sourceProvider: 'manual',
    originApp: 'VitalHub Manual Entry',
    type,
    value,
    unit,
    timestamp: ts,
    confidence: 0.9,
  });

  if (type === 'weight') {
    const normalized = normalizeMetricUnit('weight', value, unit);
    db.prepare('UPDATE users SET weight_kg = ? WHERE id = ?').run(normalized.canonicalValue, user.id);
  } else if (type === 'height') {
    const normalized = normalizeMetricUnit('height', value, unit);
    db.prepare('UPDATE users SET height_cm = ? WHERE id = ?').run(normalized.canonicalValue, user.id);
  }

  const newAlerts = evaluateAndStoreHealthAlerts(user.id);
  res.status(201).json({ ...result, newAlerts });
});

// ---------------------------------------------------------------------------
// 3b. HEALTH ALERTS & BODY PROFILE (HEIGHT / WEIGHT -> ALL CONNECTED APPS)
// ---------------------------------------------------------------------------

app.get('/api/alerts', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  res.json(listHealthAlerts(user.id));
});

app.post('/api/alerts/scan', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const newAlerts = evaluateAndStoreHealthAlerts(user.id);
  res.json({
    newAlerts,
    ...listHealthAlerts(user.id),
  });
});

app.post('/api/alerts/:id/acknowledge', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const ok = acknowledgeHealthAlert(user.id, req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Alert not found.' });
    return;
  }
  res.json({ ok: true, ...listHealthAlerts(user.id) });
});

app.post('/api/alerts/acknowledge-all', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const count = acknowledgeAllHealthAlerts(user.id);
  res.json({ ok: true, acknowledgedCount: count, ...listHealthAlerts(user.id) });
});

app.post('/api/profile/body-metrics', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { heightValue, heightUnit, weightValue, weightUnit, propagateToConnectedApps } = req.body as {
    heightValue?: number;
    heightUnit?: string;
    weightValue?: number;
    weightUnit?: string;
    propagateToConnectedApps?: boolean;
  };

  if (
    (heightValue === undefined || heightValue === null) &&
    (weightValue === undefined || weightValue === null)
  ) {
    res.status(400).json({ error: 'Provide heightValue and/or weightValue.' });
    return;
  }

  const nowIso = new Date().toISOString();
  let heightCm: number | null = user.heightCm;
  let weightKg: number | null = user.weightKg;

  if (typeof heightValue === 'number' && Number.isFinite(heightValue) && heightValue > 0) {
    const normH = normalizeMetricUnit('height', heightValue, heightUnit || 'cm');
    if (normH.canonicalValue < 50 || normH.canonicalValue > 275) {
      res.status(400).json({ error: 'Height must be between 50 cm and 275 cm.' });
      return;
    }
    heightCm = normH.canonicalValue;
    db.prepare('UPDATE users SET height_cm = ? WHERE id = ?').run(heightCm, user.id);
    upsertMetricWithResolution({
      userId: user.id,
      sourceProvider: 'manual',
      originApp: 'VitalHub Body Profile',
      type: 'height',
      value: heightCm,
      unit: 'cm',
      timestamp: nowIso,
      confidence: 1.0,
    });
  }

  if (typeof weightValue === 'number' && Number.isFinite(weightValue) && weightValue > 0) {
    const normW = normalizeMetricUnit('weight', weightValue, weightUnit || 'kg');
    if (normW.canonicalValue < 20 || normW.canonicalValue > 400) {
      res.status(400).json({ error: 'Weight must be between 20 kg and 400 kg.' });
      return;
    }
    weightKg = normW.canonicalValue;
    db.prepare('UPDATE users SET weight_kg = ? WHERE id = ?').run(weightKg, user.id);
    upsertMetricWithResolution({
      userId: user.id,
      sourceProvider: 'manual',
      originApp: 'VitalHub Body Profile',
      type: 'weight',
      value: weightKg,
      unit: 'kg',
      timestamp: nowIso,
      confidence: 1.0,
    });
  }

  const bmi =
    typeof heightCm === 'number' && heightCm > 0 && typeof weightKg === 'number' && weightKg > 0
      ? Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1))
      : null;

  if (bmi !== null) {
    upsertMetricWithResolution({
      userId: user.id,
      sourceProvider: 'manual',
      originApp: 'VitalHub Body Profile',
      type: 'bmi',
      value: bmi,
      unit: 'kg/m2',
      timestamp: nowIso,
      confidence: 1.0,
    });
  }

  const newAlerts = evaluateAndStoreHealthAlerts(user.id);
  const propagationResults =
    propagateToConnectedApps === false
      ? []
      : await propagateBodyMetricsToConnectedApps({
          userId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          heightCm,
          weightKg,
          bmi,
        });

  res.status(201).json({
    user: loadUserById(user.id),
    bodyProfile: { heightCm, weightKg, bmi },
    propagationResults,
    newAlerts,
  });
});

app.post('/api/meals', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { mealType, title, loggedAt, calories, proteinG, carbsG, fatG, fiberG, sodiumMg, waterMl, notes } =
    req.body as {
      mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
      title?: string;
      loggedAt?: string;
      calories?: number;
      proteinG?: number;
      carbsG?: number;
      fatG?: number;
      fiberG?: number;
      sodiumMg?: number;
      waterMl?: number;
      notes?: string;
    };

  if (!title || !mealType) {
    res.status(400).json({ error: 'mealType and title are required.' });
    return;
  }

  const id = crypto.randomUUID();
  const ts = loggedAt || new Date().toISOString();
  db.prepare(
    `INSERT INTO meals (id, user_id, source_provider, meal_type, title, logged_at, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, water_ml, notes, created_at)
     VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.id,
    mealType,
    title.trim(),
    ts,
    Number(calories || 0),
    Number(proteinG || 0),
    Number(carbsG || 0),
    Number(fatG || 0),
    Number(fiberG || 0),
    Number(sodiumMg || 0),
    Number(waterMl || 0),
    notes || null,
    new Date().toISOString()
  );

  if (Number(waterMl || 0) > 0) {
    upsertMetricWithResolution({
      userId: user.id,
      sourceProvider: 'manual',
      originApp: 'VitalHub Meal Logger',
      type: 'water',
      value: Number(waterMl),
      unit: 'ml',
      timestamp: ts,
    });
  }

  res.status(201).json({ id, loggedAt: ts });
});

app.post('/api/meals/import-csv', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { csvText } = req.body as { csvText?: string };
  if (!csvText) {
    res.status(400).json({ error: 'csvText is required.' });
    return;
  }

  const parsed = parseNutritionCsv(csvText);
  if (parsed.length === 0) {
    res.status(400).json({ error: 'No valid meal rows found in CSV. Include header row and at least 1 data row.' });
    return;
  }

  const insert = db.prepare(
    `INSERT INTO meals (id, user_id, source_provider, meal_type, title, logged_at, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, water_ml, created_at)
     VALUES (?, ?, 'csv', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const m of parsed) {
      insert.run(
        crypto.randomUUID(),
        user.id,
        m.mealType,
        m.title,
        m.loggedAt,
        m.calories,
        m.proteinG,
        m.carbsG,
        m.fatG,
        m.fiberG ?? 0,
        m.sodiumMg ?? 0,
        m.waterMl ?? 0,
        now
      );
    }
  });
  tx();

  res.status(201).json({ importedCount: parsed.length });
});

// ---------------------------------------------------------------------------
// 4. LAB REPORT PIPELINE (ENCRYPTED STORAGE + GEMINI OCR + CONFIRMATION)
// ---------------------------------------------------------------------------

app.get('/api/labs', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const reports = db
    .prepare(
      `SELECT id, title, lab_name, collected_at, file_name, mime_type, file_size, ocr_raw_text, status, created_at
       FROM lab_reports WHERE user_id = ? ORDER BY collected_at DESC`
    )
    .all(user.id) as Array<Record<string, unknown>>;

  const results = db
    .prepare(
      `SELECT id, report_id, test_name, test_code, value, unit, reference_low, reference_high, reference_text, flag, confirmed, collected_at
       FROM lab_results WHERE user_id = ? ORDER BY collected_at DESC, test_name ASC`
    )
    .all(user.id) as Array<Record<string, unknown>>;

  res.json({ reports, results });
});

app.post('/api/labs/upload', aiLimiter, requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const file = req.file;
  const rawTextInput = req.body?.rawText as string | undefined;
  const customTitle = (req.body?.title as string | undefined) || file?.originalname || 'Uploaded Lab Panel';

  if (!file && !rawTextInput) {
    res.status(400).json({ error: 'Upload a PDF/image file or provide raw lab text.' });
    return;
  }

  try {
    const extracted = await extractLabReportWithGemini({
      fileBuffer: file?.buffer,
      mimeType: file?.mimetype,
      rawText: rawTextInput,
      fallbackTitle: customTitle,
    });

    const sourceBuffer = file?.buffer ?? Buffer.from(rawTextInput || '', 'utf8');
    const encrypted = encryptBuffer(sourceBuffer);
    const reportId = `lab_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO lab_reports (id, user_id, title, lab_name, collected_at, file_name, mime_type, file_size, encrypted_file_b64, file_iv, file_auth_tag, ocr_raw_text, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`
    ).run(
      reportId,
      user.id,
      customTitle,
      extracted.labName,
      extracted.collectedAt,
      file?.originalname || 'pasted_lab_report.txt',
      file?.mimetype || 'text/plain',
      sourceBuffer.length,
      encrypted.ciphertextB64,
      encrypted.ivB64,
      encrypted.authTagB64,
      extracted.ocrRawText,
      now
    );

    const insertRes = db.prepare(
      `INSERT INTO lab_results (id, report_id, user_id, test_name, test_code, value, unit, reference_low, reference_high, reference_text, flag, confirmed, collected_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    );

    const savedRows = extracted.results.map((r) => {
      const id = crypto.randomUUID();
      insertRes.run(
        id,
        reportId,
        user.id,
        r.testName,
        r.testCode,
        r.value,
        r.unit,
        r.referenceLow,
        r.referenceHigh,
        r.referenceText,
        r.flag,
        extracted.collectedAt,
        now
      );
      return { id, ...r, confirmed: 0 };
    });

    writeAuditLog({
      userId: user.id,
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'LAB_REPORT_EXTRACTED',
      resourceType: 'lab_report',
      resourceId: reportId,
      details: { testCount: savedRows.length, encryptedAtRest: true },
      ipAddress: req.ip,
    });

    res.status(201).json({
      report: {
        id: reportId,
        title: customTitle,
        labName: extracted.labName,
        collectedAt: extracted.collectedAt,
        status: 'pending_review',
        ocrRawText: extracted.ocrRawText,
      },
      results: savedRows,
    });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to extract lab report via Gemini AI',
    });
  }
});

app.post('/api/labs/:reportId/confirm', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { reportId } = req.params;
  const { collectedAt, labName, results } = req.body as {
    collectedAt?: string;
    labName?: string;
    results: Array<{
      id?: string;
      testName: string;
      testCode?: string;
      value: number;
      unit: string;
      referenceLow?: number | null;
      referenceHigh?: number | null;
      referenceText?: string;
    }>;
  };

  const report = db
    .prepare('SELECT id, collected_at FROM lab_reports WHERE id = ? AND user_id = ?')
    .get(reportId, user.id) as { id: string; collected_at: string } | undefined;

  if (!report) {
    res.status(404).json({ error: 'Lab report not found.' });
    return;
  }

  const finalDate = collectedAt || report.collected_at;

  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE lab_reports SET status = 'confirmed', lab_name = COALESCE(?, lab_name), collected_at = ? WHERE id = ?"
    ).run(labName || null, finalDate, reportId);

    db.prepare('DELETE FROM lab_results WHERE report_id = ? AND user_id = ?').run(reportId, user.id);

    const insert = db.prepare(
      `INSERT INTO lab_results (id, report_id, user_id, test_name, test_code, value, unit, reference_low, reference_high, reference_text, flag, confirmed, collected_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );

    const now = new Date().toISOString();
    for (const r of results) {
      const flag = evaluateLabFlag(Number(r.value), r.referenceLow, r.referenceHigh, r.testName);
      insert.run(
        r.id || crypto.randomUUID(),
        reportId,
        user.id,
        r.testName,
        r.testCode || '',
        Number(r.value),
        r.unit,
        typeof r.referenceLow === 'number' ? r.referenceLow : null,
        typeof r.referenceHigh === 'number' ? r.referenceHigh : null,
        r.referenceText || '',
        flag,
        finalDate,
        now
      );
    }
  });
  tx();

  writeAuditLog({
    userId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'LAB_RESULTS_CONFIRMED',
    resourceType: 'lab_report',
    resourceId: reportId,
    details: { confirmedCount: results.length },
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

app.get('/api/labs/:reportId/file', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const row = db
    .prepare(
      'SELECT file_name, mime_type, encrypted_file_b64, file_iv, file_auth_tag FROM lab_reports WHERE id = ? AND user_id = ?'
    )
    .get(req.params.reportId, user.id) as
    | {
        file_name: string;
        mime_type: string;
        encrypted_file_b64: string;
        file_iv: string;
        file_auth_tag: string;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: 'Encrypted lab file not found.' });
    return;
  }

  try {
    const buffer = decryptBuffer({
      ciphertextB64: row.encrypted_file_b64,
      ivB64: row.file_iv,
      authTagB64: row.file_auth_tag,
    });
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
    res.send(buffer);
  } catch {
    res.status(200).json({
      note: 'Seeded baseline lab placeholder; newly uploaded files decrypt binary contents via AES-256-GCM.',
    });
  }
});

// ---------------------------------------------------------------------------
// 5. AI HEALTH EVALUATION & GROUNDED "ASK MY DATA" CHAT
// ---------------------------------------------------------------------------

app.post('/api/ai/evaluate', aiLimiter, requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const snapshot = buildUserHealthSnapshot(user.id, 90);

  // Build compact statistical summary per metric type to send pseudonymized data
  const grouped: Record<string, number[]> = {};
  for (const m of snapshot.metrics) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(m.canonical_value);
  }
  const metricsSummary: Record<string, unknown> = {};
  for (const [k, vals] of Object.entries(grouped)) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    metricsSummary[k] = {
      count: vals.length,
      latest: vals[vals.length - 1],
      avg: Number(avg.toFixed(2)),
      min: Math.min(...vals),
      max: Math.max(...vals),
      unit: snapshot.latestByType[k]?.unit || '',
    };
  }

  const nutritionSummary = {
    loggedMealsCount: snapshot.meals.length,
    avgCaloriesPerMeal: snapshot.meals.length
      ? Math.round(snapshot.meals.reduce((s, m) => s + Number(m.calories || 0), 0) / snapshot.meals.length)
      : 0,
    avgProteinPerMealG: snapshot.meals.length
      ? Math.round(snapshot.meals.reduce((s, m) => s + Number(m.protein_g || 0), 0) / snapshot.meals.length)
      : 0,
  };

  try {
    const evaluation = await generateHealthEvaluationWithGemini({
      userId: user.id,
      metricsSummary,
      activitiesSummary: snapshot.activities.slice(0, 15).map((a) => ({
        type: a.activity_type,
        date: String(a.start_time).slice(0, 10),
        durationMin: Math.round(Number(a.duration_sec) / 60),
        distanceKm: Number((Number(a.distance_m) / 1000).toFixed(2)),
        avgHr: a.avg_hr,
        source: a.source_provider,
      })),
      nutritionSummary,
      labResults: snapshot.labResults.map((l) => ({
        testName: l.test_name,
        value: l.value,
        unit: l.unit,
        referenceText: l.reference_text,
        flag: l.flag,
        collectedAt: String(l.collected_at).slice(0, 10),
      })),
      safetyInput: snapshot.safetyInput,
    });

    const evalId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO ai_evaluations (id, user_id, overall_score, sub_scores_json, summary, strengths_json, concerns_json, trends_json, correlations_json, recommendations_json, escalation_alert_json, disclaimer, model_used, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evalId,
      user.id,
      evaluation.overallScore,
      JSON.stringify(evaluation.subScores),
      evaluation.summary,
      JSON.stringify(evaluation.strengths),
      JSON.stringify(evaluation.concerns),
      JSON.stringify(evaluation.trends),
      JSON.stringify(evaluation.correlations),
      JSON.stringify(evaluation.recommendations),
      JSON.stringify(evaluation.escalationAlert),
      evaluation.disclaimer,
      evaluation.modelUsed,
      now
    );

    res.status(201).json({ evaluation: { id: evalId, createdAt: now, ...evaluation } });
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to generate AI health evaluation.',
    });
  }
});

app.post('/api/ai/chat', aiLimiter, requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { question, history } = req.body as {
    question?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!question || !question.trim()) {
    res.status(400).json({ error: 'question is required.' });
    return;
  }

  const snapshot = buildUserHealthSnapshot(user.id, 90);
  const groundedContext = {
    latestMetrics: snapshot.latestByType,
    recentDailySeries: snapshot.metrics.slice(-45).map((m) => ({
      type: m.type,
      value: m.canonical_value,
      unit: m.canonical_unit,
      date: m.timestamp.slice(0, 10),
      source: m.source_provider,
    })),
    recentActivities: snapshot.activities.slice(0, 10),
    recentMeals: snapshot.meals.slice(0, 10),
    confirmedLabs: snapshot.labResults,
  };

  try {
    const reply = await askHealthDataWithGemini({
      userId: user.id,
      question: question.trim(),
      history: history || [],
      groundedContext,
      safetyInput: snapshot.safetyInput,
    });
    res.json(reply);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Failed to query Gemini AI.',
    });
  }
});

// ---------------------------------------------------------------------------
// 6. SHARING, ACCESS LOGS, PROFESSIONAL VIEW, NOTES & MESSAGING
// ---------------------------------------------------------------------------

app.get('/api/shares', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const shares = db
    .prepare(
      `SELECT id, grantee_email, grantee_name, grantee_role, share_token, scopes_json, range_days, expires_at, revoked_at, created_at
       FROM shares WHERE owner_user_id = ? ORDER BY created_at DESC`
    )
    .all(user.id) as Array<Record<string, unknown>>;

  res.json({
    shares: shares.map((s) => ({
      ...s,
      scopes: JSON.parse(String(s.scopes_json)),
      shareUrl: `${getAppBaseUrl()}/?share=${s.share_token}`,
    })),
  });
});

app.post('/api/shares', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { granteeEmail, granteeName, granteeRole, scopes, rangeDays, expiryDays } = req.body as {
    granteeEmail?: string;
    granteeName?: string;
    granteeRole?: 'doctor' | 'coach' | 'dietician';
    scopes?: string[];
    rangeDays?: number;
    expiryDays?: number;
  };

  if (!granteeEmail || !scopes || scopes.length === 0) {
    res.status(400).json({ error: 'granteeEmail and at least one scope are required.' });
    return;
  }

  const id = `shr_${crypto.randomUUID().slice(0, 12)}`;
  const shareToken = `vh_${crypto.randomBytes(12).toString('hex')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (expiryDays || 30) * 86400000).toISOString();

  db.prepare(
    `INSERT INTO shares (id, owner_user_id, grantee_email, grantee_name, grantee_role, share_token, scopes_json, range_days, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.id,
    granteeEmail.trim().toLowerCase(),
    granteeName?.trim() || granteeEmail.trim(),
    granteeRole || 'doctor',
    shareToken,
    JSON.stringify(scopes),
    rangeDays || 30,
    expiresAt,
    now.toISOString()
  );

  writeAuditLog({
    userId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'SHARE_GRANTED',
    resourceType: 'share',
    resourceId: id,
    details: { granteeEmail, granteeRole, scopes, rangeDays: rangeDays || 30, expiresAt },
    ipAddress: req.ip,
  });

  res.status(201).json({
    id,
    shareToken,
    shareUrl: `${getAppBaseUrl()}/?share=${shareToken}`,
    expiresAt,
  });
});

app.post('/api/shares/:id/revoke', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const now = new Date().toISOString();
  const result = db
    .prepare('UPDATE shares SET revoked_at = ? WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL')
    .run(now, req.params.id, user.id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Active share not found.' });
    return;
  }

  writeAuditLog({
    userId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'SHARE_REVOKED',
    resourceType: 'share',
    resourceId: req.params.id,
    ipAddress: req.ip,
  });

  res.json({ ok: true, revokedAt: now });
});

app.get('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const logs = db
    .prepare(
      `SELECT id, actor_email, actor_role, action, resource_type, resource_id, details_json, ip_address, created_at
       FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .all(user.id) as Array<Record<string, unknown>>;

  res.json({
    logs: logs.map((l) => ({ ...l, details: JSON.parse(String(l.details_json || '{}')) })),
  });
});

app.get('/api/pro/patients', requireAuth, requireRole('professional', 'admin'), (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const nowIso = new Date().toISOString();

  const shares = db
    .prepare(
      `SELECT s.*, u.name as patient_name, u.email as patient_email, u.avatar_url as patient_avatar
       FROM shares s
       JOIN users u ON u.id = s.owner_user_id
       WHERE s.grantee_email = ? AND s.revoked_at IS NULL AND s.expires_at > ?
       ORDER BY s.created_at DESC`
    )
    .all(user.email, nowIso) as Array<Record<string, unknown>>;

  res.json({
    patients: shares.map((s) => ({
      shareId: s.id,
      patientId: s.owner_user_id,
      patientName: s.patient_name,
      patientEmail: s.patient_email,
      patientAvatar: s.patient_avatar,
      scopes: JSON.parse(String(s.scopes_json)),
      rangeDays: s.range_days,
      expiresAt: s.expires_at,
    })),
  });
});

app.get('/api/pro/patient/:patientId', requireAuth, requireRole('professional', 'admin'), (req: AuthenticatedRequest, res) => {
  const pro = req.authUser!;
  const { patientId } = req.params;
  const nowIso = new Date().toISOString();

  const share = db
    .prepare(
      `SELECT * FROM shares
       WHERE owner_user_id = ? AND grantee_email = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(patientId, pro.email, nowIso) as Record<string, unknown> | undefined;

  if (!share) {
    res.status(403).json({ error: 'No active share grant for this patient.' });
    return;
  }

  const scopes = new Set<string>(JSON.parse(String(share.scopes_json)));
  const rangeDays = Number(share.range_days || 30);
  const full = buildUserHealthSnapshot(patientId, rangeDays);
  const patient = loadUserById(patientId);

  // Strictly enforce granular scopes! Unshared categories are stripped before response.
  const filteredMetrics = full.metrics.filter((m) => {
    if (m.type.startsWith('sleep_')) return scopes.has('sleep');
    if (m.type === 'steps' || m.type === 'vo2_max') return scopes.has('activity');
    if (m.type === 'water') return scopes.has('diet');
    return scopes.has('vitals');
  });

  const filteredLatest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full.latestByType)) {
    if (k.startsWith('sleep_') && scopes.has('sleep')) filteredLatest[k] = v;
    else if ((k === 'steps' || k === 'vo2_max') && scopes.has('activity')) filteredLatest[k] = v;
    else if (k === 'water' && scopes.has('diet')) filteredLatest[k] = v;
    else if (!k.startsWith('sleep_') && k !== 'steps' && k !== 'vo2_max' && k !== 'water' && scopes.has('vitals')) {
      filteredLatest[k] = v;
    }
  }

  const notes = db
    .prepare('SELECT * FROM notes WHERE patient_user_id = ? ORDER BY created_at DESC')
    .all(patientId);

  writeAuditLog({
    userId: patientId,
    actorUserId: pro.id,
    actorEmail: pro.email,
    actorRole: pro.role,
    action: 'PRO_VIEWED_PATIENT_RECORD',
    resourceType: 'share',
    resourceId: String(share.id),
    details: { scopes: Array.from(scopes), rangeDays },
    ipAddress: req.ip,
  });

  res.json({
    patient: {
      id: patient?.id,
      name: patient?.name,
      email: patient?.email,
      avatarUrl: patient?.avatarUrl,
    },
    share: {
      id: share.id,
      scopes: Array.from(scopes),
      rangeDays,
      expiresAt: share.expires_at,
      granteeRole: share.grantee_role,
    },
    latestByType: filteredLatest,
    metrics: filteredMetrics,
    activities: scopes.has('activity') ? full.activities : [],
    meals: scopes.has('diet') ? full.meals : [],
    labResults: scopes.has('labs') ? full.labResults : [],
    notes,
  });
});

app.post('/api/pro/patient/:patientId/notes', requireAuth, requireRole('professional', 'admin'), (req: AuthenticatedRequest, res) => {
  const pro = req.authUser!;
  const { patientId } = req.params;
  const { category, content, isRecommendation } = req.body as {
    category?: string;
    content?: string;
    isRecommendation?: boolean;
  };

  if (!content || !content.trim()) {
    res.status(400).json({ error: 'Note content is required.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const activeShare = db
    .prepare(
      'SELECT id, grantee_role FROM shares WHERE owner_user_id = ? AND grantee_email = ? AND revoked_at IS NULL AND expires_at > ?'
    )
    .get(patientId, pro.email, nowIso) as { id: string; grantee_role: string } | undefined;

  if (!activeShare) {
    res.status(403).json({ error: 'Active share required to leave clinical notes.' });
    return;
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO notes (id, patient_user_id, author_user_id, author_name, author_role, category, content, is_recommendation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    patientId,
    pro.id,
    pro.name,
    activeShare.grantee_role || 'doctor',
    category || 'Clinical Observation',
    content.trim(),
    isRecommendation ? 1 : 0,
    nowIso
  );

  writeAuditLog({
    userId: patientId,
    actorUserId: pro.id,
    actorEmail: pro.email,
    actorRole: pro.role,
    action: 'PRO_ADDED_NOTE',
    resourceType: 'note',
    resourceId: id,
    ipAddress: req.ip,
  });

  res.status(201).json({ id, createdAt: nowIso });
});

app.get('/api/notes', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const notes = db
    .prepare('SELECT * FROM notes WHERE patient_user_id = ? ORDER BY created_at DESC')
    .all(user.id);
  res.json({ notes });
});

app.get('/api/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const patientId = (req.query.patientId as string | undefined) || user.id;

  if (patientId !== user.id && user.role !== 'professional' && user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const rows = db
    .prepare('SELECT * FROM messages WHERE patient_user_id = ? ORDER BY created_at ASC')
    .all(patientId);
  res.json({ messages: rows });
});

app.post('/api/messages', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { patientId, professionalEmail, body } = req.body as {
    patientId?: string;
    professionalEmail?: string;
    body?: string;
  };
  if (!body || !body.trim()) {
    res.status(400).json({ error: 'Message body is required.' });
    return;
  }

  const targetPatientId = user.role === 'professional' ? patientId : user.id;
  if (!targetPatientId) {
    res.status(400).json({ error: 'patientId required for professional messages.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages (id, patient_user_id, professional_email, sender_user_id, sender_name, sender_role, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    targetPatientId,
    professionalEmail || (user.role === 'professional' ? user.email : 'dr.elena@vitalhub.app'),
    user.id,
    user.name,
    user.role,
    body.trim(),
    now
  );

  res.status(201).json({ id, createdAt: now });
});

// ---------------------------------------------------------------------------
// 7. PRIVACY (GDPR/DPDP EXPORT & DELETE) & ADMIN CONSOLE
// ---------------------------------------------------------------------------

app.get('/api/privacy/export', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const snapshot = buildUserHealthSnapshot(user.id, 3650);
  const shares = db.prepare('SELECT * FROM shares WHERE owner_user_id = ?').all(user.id);
  const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE user_id = ?').all(user.id);
  const notes = db.prepare('SELECT * FROM notes WHERE patient_user_id = ?').all(user.id);

  writeAuditLog({
    userId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: 'DATA_EXPORTED_GDPR_DPDP',
    resourceType: 'user',
    resourceId: user.id,
    ipAddress: req.ip,
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="vitalhub-export-${user.id}.json"`);
  res.send(
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        user,
        ...snapshot,
        shares,
        notes,
        auditLogs,
      },
      null,
      2
    )
  );
});

app.delete('/api/privacy/delete-account', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  if (user.email === 'maya.lin@vitalhub.app' || user.email === 'dr.elena@vitalhub.app' || user.email === 'admin@vitalhub.app') {
    // For seeded demo accounts, wipe health telemetry & reset onboarding while preserving demo login usability,
    // or delete completely for real user accounts!
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM metrics WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM activities WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM meals WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM lab_reports WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM ai_evaluations WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM shares WHERE owner_user_id = ?').run(user.id);
      db.prepare('DELETE FROM sources WHERE user_id = ?').run(user.id);
      db.prepare('DELETE FROM health_alerts WHERE user_id = ?').run(user.id);
    });
    tx();
    res.json({ ok: true, mode: 'demo_data_purged' });
    return;
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  clearSessionCookie(res);
  res.json({ ok: true, mode: 'account_deleted' });
});

app.get('/api/admin/overview', requireAuth, requireRole('admin'), (_req, res) => {
  const users = db
    .prepare('SELECT id, email, name, role, onboarding_completed, created_at FROM users ORDER BY created_at DESC')
    .all();
  const sourceStats = db
    .prepare('SELECT provider, status, COUNT(*) as count, MAX(last_synced_at) as latest_sync FROM sources GROUP BY provider, status')
    .all();
  const counts = {
    users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c,
    metrics: (db.prepare('SELECT COUNT(*) as c FROM metrics').get() as { c: number }).c,
    activities: (db.prepare('SELECT COUNT(*) as c FROM activities').get() as { c: number }).c,
    labReports: (db.prepare('SELECT COUNT(*) as c FROM lab_reports').get() as { c: number }).c,
    activeShares: (db.prepare('SELECT COUNT(*) as c FROM shares WHERE revoked_at IS NULL').get() as { c: number }).c,
  };
  res.json({ users, sourceStats, counts });
});

app.patch('/api/admin/users/:id/role', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res) => {
  const { role } = req.body as { role?: UserRole };
  if (!role || !['individual', 'professional', 'admin'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' });
    return;
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 8. VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVING
// ---------------------------------------------------------------------------

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VitalHub server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
