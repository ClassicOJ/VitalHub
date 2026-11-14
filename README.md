# VitalHub Intelligence

A full-stack unified health, fitness, nutrition, and lab intelligence dashboard built with React, TypeScript, Tailwind CSS, Express, SQLite, and the Google Gemini API.

## Features

- **Unified Telemetry & Normalization**: Aggregates metrics, workouts, sleep, and nutrition from pluggable `HealthSourceConnector` adapters (Health Connect, Apple HealthKit, Strava, MyFitnessPal, Healthify, CSV, and manual logging) with priority-based deduplication.
- **Health Alerts Engine**: Automatically evaluates baseline vs. recent biometric readings (resting heart rate, HRV, SpO2, blood pressure, glucose, sleep) and flags significant deviations.
- **Body Metrics Propagation**: Updating height and weight recalculates BMI and synchronizes across connected health apps.
- **Lab Report Extraction & AI Evaluation**: Upload lab reports (PDF/images) for structured biomarker extraction, composite wellness scoring, and interactive data Q&A.
- **Role-Based Care Team Sharing**: Scoped, expirable, revocable sharing with healthcare professionals plus clinical notes and an admin console.

## Local Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Set `GEMINI_API_KEY`, `JWT_SECRET`, and `FIELD_ENCRYPTION_KEY` in `.env` (plus optional `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`).

3. **Run the development server**
   ```bash
   npm run dev
   ```
   The app and API server run on `http://localhost:3000`.

4. **Run checks & tests**
   ```bash
   npm run lint
   npm test
   npm run build
   ```
