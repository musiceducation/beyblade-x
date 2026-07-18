import { createHash, randomBytes, timingSafeEqual, createHmac } from 'crypto';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12h

function tokenSecret() {
  return process.env.ROOM_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-room-secret';
}

export function hashRefereePassword(password: string, salt?: string) {
  const s = salt || randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(`${s}:${password}`).digest('hex');
  return `${s}$${hash}`;
}

export function verifyRefereePassword(password: string, stored: string) {
  const [salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const next = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'));
  } catch {
    return false;
  }
}

export function issueRefereeToken(code: string) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${code.toUpperCase()}.${exp}`;
  const sig = createHmac('sha256', tokenSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyRefereeToken(code: string, token: string | null | undefined) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tokenCode, expStr, sig] = parts;
  if (tokenCode.toUpperCase() !== code.toUpperCase()) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const payload = `${tokenCode}.${expStr}`;
  const expected = createHmac('sha256', tokenSecret()).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function generateRoomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
