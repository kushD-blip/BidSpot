// lib/admin-auth.js — shared cookie signing/verification for /api/admin/*.
//
// Uses a plain HMAC of "issued_at" against ADMIN_PASSWORD as the signing key so
// there's no separate "admin session secret" to keep in sync — one env var = one
// gate. The cookie carries the timestamp in cleartext next to the HMAC so we can
// enforce a hard 12h TTL server-side; nothing else is stored anywhere.
//
// Not JWT: this is a single-purpose cookie for one operator. A JWT header/claims
// stack doesn't buy anything here — just more surface for a stray dependency.

import crypto from "crypto";

const TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = "bidspot_admin";

function key() {
  const secret = process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("ADMIN_PASSWORD not set");
  return secret;
}

/** Returns a "issuedAtMs.signature" string ready to drop into Set-Cookie. */
export function signAdminCookie() {
  const iat = Date.now();
  const sig = crypto.createHmac("sha256", key()).update(String(iat)).digest("hex");
  return `${iat}.${sig}`;
}

/** Parses the request's cookies, finds ours, and validates the HMAC + TTL.
    Returns true on a good, unexpired cookie; false on any parse or validation
    failure. Never throws — callers just gate on the boolean. */
export function verifyAdminCookie(req) {
  try {
    if (!process.env.ADMIN_PASSWORD) return false;

    const raw = req.headers.cookie || "";
    const match = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE_NAME + "="));
    if (!match) return false;
    const value = match.slice(COOKIE_NAME.length + 1);
    const [iatStr, sig] = value.split(".");
    if (!iatStr || !sig) return false;

    const iat = Number(iatStr);
    if (!Number.isFinite(iat)) return false;
    if (Date.now() - iat > TTL_MS) return false;

    const expected = crypto.createHmac("sha256", key()).update(String(iat)).digest("hex");
    if (sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/** Sends a 401 and returns true if the request isn't authorized; false otherwise.
    Handy at the top of every /api/admin/* endpoint. */
export function requireAdmin(req, res) {
  if (verifyAdminCookie(req)) return false;
  res.status(401).json({ error: "Unauthorized" });
  return true;
}
