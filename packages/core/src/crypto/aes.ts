import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'qunkins-salt'; // Fixed salt for key derivation

/**
 * Encrypt plaintext using AES-256-GCM
 * @param plaintext - The text to encrypt
 * @param secret - The secret key
 * @returns Encrypted string in format: iv:authTag:ciphertext (all hex)
 */
export function encrypt(plaintext: string, secret: string): string {
  const key = crypto.scryptSync(secret, SALT, 32);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param ciphertext - The encrypted text (format: iv:authTag:ciphertext)
 * @param secret - The secret key
 * @returns Decrypted plaintext
 */
export function decrypt(ciphertext: string, secret: string): string {
  const key = crypto.scryptSync(secret, SALT, 32);
  
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
