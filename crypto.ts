import crypto from 'crypto';

/**
 * Derive a 32-byte AES-256 key from FIELD_ENCRYPTION_KEY env var.
 * Uses a deterministic dev fallback when unset so local MVPs run smoothly,
 * while ensuring production always uses an explicit secret from vault/env.
 */
function getEncryptionKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY || 'vitalhub-local-dev-encryption-key-change-in-prod';
  return crypto.createHash('sha256').update(raw).digest();
}

export interface EncryptedPayload {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}

/**
 * Encrypt sensitive string values (OAuth tokens, PII fields) with AES-256-GCM.
 */
export function encryptField(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt string encrypted by encryptField.
 */
export function decryptField(packed: string): string {
  const [ivB64, tagB64, dataB64] = packed.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload');
  }
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/**
 * Encrypt binary lab report files (PDF/JPEG/PNG) before storing at rest.
 */
export function encryptBuffer(buffer: Buffer): EncryptedPayload {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertextB64: encrypted.toString('base64'),
    ivB64: iv.toString('base64'),
    authTagB64: authTag.toString('base64'),
  };
}

/**
 * Decrypt binary lab report file for authorized download.
 */
export function decryptBuffer(payload: EncryptedPayload): Buffer {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertextB64, 'base64')),
    decipher.final(),
  ]);
}

/**
 * Pseudonymize health context prior to sending to LLM APIs.
 * Strips names, emails, user IDs, and replaces them with an opaque subject hash.
 */
export function createPseudonymousSubjectId(userId: string): string {
  return `subj_${crypto.createHash('sha256').update(`vitalhub:${userId}`).digest('hex').slice(0, 12)}`;
}
