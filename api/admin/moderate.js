// api/admin/moderate.js  (POST /api/admin/moderate)
// Operator actions on a listing from the admin dashboard. One endpoint that
// dispatches by { action } rather than one endpoint per action because they all
// share the same auth gate, the same target (a listing id), and often the same
// audit-log-worthy metadata. Deliberately narrow — only actions that make sense
// for a solo operator without a real admin UX are here.

import { supabaseAdmin } from "../../lib/razorpay.js";
import { requireAdmin } from "../../lib/admin-auth.js";

const ACTIONS = new Set(["verify", "unverify", "remove", "restore"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (requireAdmin(req, res)) return;

  const { listingId, action } = req.body || {};
  if (!listingId || !ACTIONS.has(action)) {
    return res.status(400).json({ error: "Bad request" });
  }

  // What each action maps to. Kept as one lookup so the surface of what admin
  // is allowed to change is grep-able in one place, rather than scattered across
  // endpoints. "verify" here is the "established brand" flag, separate from the
  // automatic Founding Bidder badge which is never granted or revoked by hand.
  const updates = {
    verify:    { verified: true },
    unverify:  { verified: false },
    remove:    { status: "removed" },
    restore:   { status: "approved" },
  }[action];

  const { data, error } = await supabaseAdmin
    .from("listings")
    .update(updates)
    .eq("id", listingId)
    .select("id, status, verified")
    .single();

  if (error) {
    console.error("[admin/moderate] failed:", error);
    return res.status(500).json({ error: "Could not update listing." });
  }
  return res.status(200).json({ ok: true, listing: data });
}
