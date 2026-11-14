import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db.ts';

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

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser;
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET || 'vitalhub-local-dev-jwt-secret-change-in-prod';
}

export function signSessionToken(user: { id: string; role: UserRole }): string {
  return jwt.sign({ sub: user.id, role: user.role }, getJwtSecret(), { expiresIn: '7d' });
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie('vitalhub_session', token, {
    httpOnly: true,
    secure: true, // Required for SameSite=None in AI Studio preview iframe
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie('vitalhub_session', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  });
}

export function loadUserById(userId: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT id, email, name, role, avatar_url, onboarding_completed, consent_flags_json, biometric_lock_enabled, height_cm, weight_kg
       FROM users WHERE id = ?`
    )
    .get(userId) as
    | {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        avatar_url: string | null;
        onboarding_completed: number;
        consent_flags_json: string;
        biometric_lock_enabled: number;
        height_cm: number | null;
        weight_kg: number | null;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url,
    onboardingCompleted: row.onboarding_completed === 1,
    consentFlags: JSON.parse(row.consent_flags_json || '{}'),
    biometricLockEnabled: row.biometric_lock_enabled === 1,
    heightCm: row.height_cm ?? null,
    weightKg: row.weight_kg ?? null,
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const cookieToken = req.cookies?.vitalhub_session as string | undefined;
  const token = bearer || cookieToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { sub: string; role: UserRole };
    const user = loadUserById(decoded.sub);
    if (!user) {
      res.status(401).json({ error: 'Session user no longer exists' });
      return;
    }
    req.authUser = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Insufficient role permissions for this resource' });
      return;
    }
    next();
  };
}
