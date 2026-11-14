# VitalHub Architecture, Database Schema, API Spec, Prompts, Test Plan & Roadmap

## 1. Architecture Overview & Key Trade-Offs

### System Flow Description
- **Clients**: Web & Mobile-first React SPA (with native Expo/React Native bridge targets for Health Connect on Android and HealthKit on iOS).
- **API & Auth Gateway**: Express (`server.ts`) with JWT + HttpOnly `SameSite=None; Secure` cookies, role-based access control (`individual`, `professional`, `admin`), and express-rate-limit protection.
- **Pluggable Ingestion Layer (`HealthSourceConnector`)**:
  - `health_connect` (Android Health Connect, aggregating Samsung Health & Fitbit)
  - `healthkit` (iOS HealthKit, aggregating Apple Watch & Nike Run Club)
  - `strava` (Strava OAuth2 popup flow + incremental `/api/v3/athlete/activities` sync)
  - `myfitnesspal` / `healthify` (Partner API stubs) + CSV importer + manual entry
- **Normalization & Conflict Resolution**: Converts heterogeneous units (`lb -> kg`, `mmol/L -> mg/dL`, `fl oz -> ml`, `mi -> m`) into canonical units and assigns `is_primary` using per-domain priority rules (Strava > HealthKit for workouts; HealthKit/Health Connect > Strava for vitals & sleep).
- **Encrypted Lab Pipeline**: Uploads stored with AES-256-GCM field/buffer encryption; Gemini `gemini-4-hydrogen` extracts structured biomarkers; user edits & confirms before committing to `lab_results`.
- **AI Intelligence Engine**: Sends pseudonymized aggregates (`subj_<hash>`) to Gemini `gemini-4-hydrogen` with strict JSON schemas and deterministic clinical escalation guardrails (`BP >= 180/120`, `Glucose >= 250 or <= 54`, `SpO2 <= 90%`).

### Key Trade-Offs
1. **MVP SQLite (`better-sqlite3` WAL) vs. Production PostgreSQL + TimescaleDB**: Local SQLite enables zero-config immediate persistence in the MVP with full SQL migrations and composite time-series indexes, while keeping a clean 1:1 DDL path to TimescaleDB hypertables at scale.
2. **Soft-demotion deduplication (`is_primary = 0`) vs. destructive overwrite**: Preserving superseded duplicates retains full source provenance and makes conflict resolution auditable without double-counting dashboard aggregations.
3. **Human-in-the-loop lab confirmation**: Never committing OCR extractions directly to clinical records prevents transcription hallucinations from corrupting trend charts or AI evaluations.

---

## 2. Production PostgreSQL + TimescaleDB Schema (Mirroring `server/db.ts`)

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('individual', 'professional', 'admin')),
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  consent_flags_json JSONB NOT NULL DEFAULT '{}',
  biometric_lock_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sources (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected', 'syncing', 'error', 'disconnected')),
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes_json JSONB NOT NULL DEFAULT '[]',
  last_synced_at TIMESTAMPTZ,
  sync_cursor TEXT,
  last_error TEXT,
  priority_rank INTEGER NOT NULL DEFAULT 5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE metrics (
  id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  canonical_value DOUBLE PRECISION NOT NULL,
  canonical_unit TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
  source_provider TEXT NOT NULL,
  origin_app TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  dedup_key TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  metadata_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, timestamp)
);
SELECT create_hypertable('metrics', 'timestamp');
CREATE INDEX idx_metrics_user_type_ts ON metrics (user_id, type, timestamp DESC);
CREATE UNIQUE INDEX idx_metrics_dedup ON metrics (user_id, dedup_key, source_provider, timestamp);

-- Additional tables: activities, meals, lab_reports (encrypted_file_b64, file_iv, file_auth_tag),
-- lab_results, shares, notes, messages, ai_evaluations, audit_logs (all implemented in server/db.ts).
```

---

## 3. REST API Specification
- `POST /api/auth/register` | `POST /api/auth/login` | `POST /api/auth/demo` | `POST /api/auth/logout` | `GET /api/auth/me`
- `POST /api/auth/consent` | `POST /api/auth/biometric`
- `GET /api/sources` | `GET /api/sources/strava/auth-url` | `GET /auth/callback`
- `POST /api/sources/:provider/sync` | `POST /api/sources/:provider/disconnect`
- `GET /api/dashboard?rangeDays=30` | `POST /api/metrics`
- `POST /api/meals` | `POST /api/meals/import-csv`
- `GET /api/labs` | `POST /api/labs/upload` | `POST /api/labs/:reportId/confirm` | `GET /api/labs/:reportId/file`
- `POST /api/ai/evaluate` | `POST /api/ai/chat`
- `GET /api/shares` | `POST /api/shares` | `POST /api/shares/:id/revoke` | `GET /api/audit-logs`
- `GET /api/pro/patients` | `GET /api/pro/patient/:patientId` | `POST /api/pro/patient/:patientId/notes`
- `GET /api/notes` | `GET /api/messages` | `POST /api/messages`
- `GET /api/privacy/export` | `DELETE /api/privacy/delete-account`
- `GET /api/admin/overview` | `PATCH /api/admin/users/:id/role`

---

## 4. Phased Roadmap
- **MVP (Implemented)**: Auth & granular consent, Health Connect / HealthKit / Strava connectors, unit normalization & deduplication, manual & CSV meals, encrypted lab OCR + confirmation, 0-100 AI evaluation + grounded chat, scoped care-team sharing + one-tap revoke + audit logs, DPDP/GDPR export & deletion.
- **v1**: Native Expo React Native wrappers for background HealthKit & Health Connect sync, Redis + BullMQ scheduled sync workers, S3 KMS object storage for encrypted PDFs, push notifications for critical thresholds.
- **v2**: Direct OAuth for Garmin, Oura, Whoop, Dexcom/Freestyle Libre CGM streams, FHIR R4 EHR bidirectional export, and curated clinical care-team marketplace.
