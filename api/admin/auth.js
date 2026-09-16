/* api/admin/auth.js
 *
 *   POST /api/admin/auth       — { password } -> Set-Cookie + { ok: true }
 *   DELETE /api/admin/auth     — clear cookie -> { ok: true }
 *   GET /api/admin/auth        — reports whether the current cookie is valid,
 *                                used by the client to decide gate vs shell on
 *                                page load without needing to fetch a whole
 *                                data endpoint just to probe auth state.
 *
 * The password check has an intentional minimum latency so wrong-vs-right
 * responses take the same time from the outside, and bulk guessing is throttled.
 */

import {
  safeEquals,
  signSession,
  verifySession,
  sessionCookieHeader,
  clearCookieHeader,
} from '../../lib/admin-auth.js';

const MIN_LATENCY_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method === 'GET')    return handleProbe(req, res);
  if (req.method === 'POST')   return handleLogin(req, res);
  if (req.method === 'DELETE') return handleLogout(req, res);
  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}

function handleProbe(req, res) {
  return res.status(200).json({ authenticated: verifySession(req) });
}

async function handleLogin(req, res) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) {
    console.warn('[admin/auth] ADMIN_PASSWORD env var not set — admin is disabled');
    return res.status(503).json({ error: 'Admin is not configured yet.' });
  }

  const started = Date.now();
  const password = (req.body && typeof req.body === 'object') ? req.body.password : undefined;
  const ok = typeof password === 'string' && safeEquals(password, configured);

  const elapsed = Date.now() - started;
  if (elapsed < MIN_LATENCY_MS) await sleep(MIN_LATENCY_MS - elapsed);

  if (!ok) return res.status(401).json({ error: 'Wrong password.' });

  res.setHeader('Set-Cookie', sessionCookieHeader(req, signSession()));
  return res.status(200).json({ ok: true });
}

function handleLogout(req, res) {
  res.setHeader('Set-Cookie', clearCookieHeader());
  return res.status(200).json({ ok: true });
}
