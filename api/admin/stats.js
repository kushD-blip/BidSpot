// api/admin/stats.js  (GET /api/admin/stats)
// One consolidated endpoint that returns everything the admin dashboard renders:
// headline totals, bids-per-day for the last 30 days, volume by category, listings
// by status, and the 20 most recent paid bids. One round-trip so the dashboard
// paints in a single frame; each subquery is cheap and independent so they run in
// parallel.

import { supabaseAdmin } from "../../lib/razorpay.js";
import { requireAdmin } from "../../lib/admin-auth.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (requireAdmin(req, res)) return;

  try {
    const [totals, bidsByDay, topCategories, listingsByStatus, recentBids, pendingCount] = await Promise.all([
      // Headline totals: all-time paid bid count + volume (paise).
      supabaseAdmin.rpc("admin_totals"),

      // Bids per day for the last 30 days, ordered oldest first for a line chart.
      supabaseAdmin.rpc("admin_bids_by_day", { p_days: 30 }),

      // Volume per category (paise), top 10.
      supabaseAdmin.rpc("admin_volume_by_category", { p_limit: 10 }),

      // Listing counts by status: pending / approved / rejected / removed.
      supabaseAdmin.rpc("admin_listings_by_status"),

      // 20 most recent PAID bids with their listing name — the admin's "what's
      // happening right now" feed. Redacted: no email or phone leaks here even
      // to me; that data is joined only on the moderation flow when needed.
      supabaseAdmin
        .from("bids")
        .select("id, amount, currency, created_at, listings(name)")
        .eq("status", "paid")
        .order("created_at", { ascending: false })
        .limit(20),

      // Pending listing count — a "moderation queue" number that surfaces
      // whether anything needs attention.
      supabaseAdmin.from("listings").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    // rpc() returns { data, error } — flatten to plain values, letting a broken
    // aggregate degrade gracefully to `null` on the dashboard rather than a 500.
    return res.status(200).json({
      totals: totals.data || { paid_count: 0, volume_paise: 0, listings_count: 0 },
      bidsByDay: bidsByDay.data || [],
      topCategories: topCategories.data || [],
      listingsByStatus: listingsByStatus.data || [],
      recentBids: recentBids.data || [],
      pendingCount: pendingCount.count || 0,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[admin/stats] failed:", err);
    return res.status(500).json({ error: "Could not load stats." });
  }
}
