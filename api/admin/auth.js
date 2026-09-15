// api/admin/auth.js  (POST /api/admin/auth)
// Password gate for /admin.html. Deliberately minimal: one env-var-configured
// secret, one signed cookie, no user table. This is an operator dashboard for one
// person (Kushagra), not a user account system — a real user system would drag in
// registration, password reset, email verification, and none of it is warranted
// for a single-operator tool.
//
// The signed cookie is validated on every /api/admin/* endpoint (see
// verifyAdminCookie in lib/admin-auth.js). Nothing on the client is trusted —
// dropping a fake cookie into DevTools produces an invalid signature and every
// admin API returns 401.

import { signAdminCookie } from "../../lib/admin-auth.js";

const RATE_MS = 800; // deliberate min-latency to slow bulk password guessing
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) {
    console.warn("[admin/auth] ADMIN_PASSWORD env var not set — admin is disabled");
    return res.status(503).json({ error: "Admin not configured yet." });
  }

  const { password } = req.body || {};
  const started = Date.now();

  // Constant-time-ish comparison via length + char accumulator. Node's built-in
  // timingSafeEqual would need Buffer padding for different lengths; this is
  // simple and good enough for a single-user secret behind a rate limit.
  let ok = typeof password === "string" && password.length === configured.length;
  if (ok) {
    let diff = 0;
    for (let i = 0; i < configured.length; i++) diff |= configured.charCodeAt(i) ^ password.charCodeAt(i);
    ok = diff === 0;
  }

  // Fixed minimum latency so a wrong password isn't distinguishable from a right
  // one by response timing, and bulk guessing is throttled.
  const elapsed = Date.now() - started;
  if (elapsed < RATE_MS) await sleep(RATE_MS - elapsed);

  if (!ok) return res.status(401).json({ error: "Wrong password." });

  const cookie = signAdminCookie();
  // 12h session, HttpOnly so JS can't read it, SameSite=Lax so it's sent on
  // top-level nav to /admin.html but not on cross-site image tags etc.
  const maxAge = 12 * 60 * 60;
  const isSecure = (req.headers["x-forwarded-proto"] || "").includes("https");
  res.setHeader("Set-Cookie",
    `bidspot_admin=${cookie}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`);
  return res.status(200).json({ ok: true });
}
