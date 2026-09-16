/* lib/admin-auth.js — cookie signing + verification for /api/admin/*.
 *
 * One shared secret (env: ADMIN_PASSWORD) does two jobs:
 *   1. What the visitor types on the gate is compared against it.
 *   2. It's the HMAC key that signs the session cookie.
 * A separate SESSION_SECRET buys nothing here — this is a single-operator tool,
 * and needing to keep two envs aligned would just be another way to break the
 * page. Rotating the password invalidates every existing session, which is the
 * right behaviour.
 *
 * Cookie value shape: "<iat_ms>.<hmac_hex>". Cleartext timestamp so the TTL
 * can be enforced server-side without any server-side session store; the HMAC
 * guarantees a client can't forge one.
 */

import crypto from 'crypto';

export const COOKIE_NAME = 'bidspot_admin';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function secret() {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error('ADMIN_PASSWORD not set');
  return s;
}

function hmac(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

/** Constant-time string equality. Same-length required by timingSafeEqual, and
 *  differing lengths always leak "not equal" anyway, so short-circuit that.
 */
export function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Build the Set-Cookie value for a fresh 12h session. Called from
 *  api/admin/auth.js after the password check passes. */
export function signSession() {
  const iat = Date.now();
  return `${iat}.${hmac(String(iat))}`;
}

/** Returns true if the request's bidspot_admin cookie is a valid, unexpired
 *  session signed by ADMIN_PASSWORD. Returns false on any parse or crypto
 *  failure — callers just gate on the boolean, we don't distinguish "no
 *  cookie" from "bad cookie" from "expired" to the client. */
export function verifySession(req) {
  try {
    if (!process.env.ADMIN_PASSWORD) return false;

    const header = req.headers?.cookie || '';
    const match = header.split(/;\s*/).find((c) => c.startsWith(COOKIE_NAME + '='));
    if (!match) return false;

    const value = match.slice(COOKIE_NAME.length + 1);
    const dot = value.indexOf('.');
    if (dot <= 0) return false;

    const iatStr = value.slice(0, dot);
    const sig = value.slice(dot + 1);

    const iat = Number(iatStr);
    if (!Number.isFinite(iat) || iat <= 0) return false;
    if (Date.now() - iat > TTL_MS) return false;

    return safeEquals(sig, hmac(String(iat)));
  } catch {
    return false;
  }
}

/** Gate helper — send 401 and return true when the caller should stop.
 *  Every /api/admin/* endpoint starts with `if (requireAdmin(req, res)) return`. */
export function requireAdmin(req, res) {
  if (verifySession(req)) return false;
  res.status(401).json({ error: 'Unauthorized' });
  return true;
}

/** Build a Set-Cookie header for the session. Adds Secure only over HTTPS so
 *  the cookie still works over http://localhost during local dev with
 *  `vercel dev` / `node dev-server.mjs`. */
export function sessionCookieHeader(req, value) {
  const maxAgeSec = Math.floor(TTL_MS / 1000);
  const isSecure = String(req.headers?.['x-forwarded-proto'] || '').includes('https');
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
}

/** Build a Set-Cookie header that expires the session immediately (logout). */
export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
