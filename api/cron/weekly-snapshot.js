// api/cron/weekly-snapshot.js  (Vercel Cron -> GET /api/cron/weekly-snapshot, Mondays 00:00 IST)
// Snapshots the previous 7 days into `weekly_winners`: the top bidder overall (Hall of Fame)
// plus the top bidder per category. Relies on the get_weekly_top_per_category() SQL function
// in schema.sql, which sums paid bids in the window — total_bid_today/alltime on `listings`
// don't carry weekly history, so this reads straight from the immutable `bids` ledger.

import { supabaseAdmin } from "../../lib/razorpay.js";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const weekEnd = new Date();
  weekEnd.setUTCHours(0, 0, 0, 0);
  const weekStart = new Date(weekEnd);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);

  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);

  const { data: rows, error } = await supabaseAdmin.rpc("get_weekly_top_per_category", {
    p_week_start: weekStartStr,
    p_week_end: weekEndStr,
  });

  if (error) {
    console.error("weekly-snapshot query error:", error);
    return res.status(500).json({ error: "Could not compute weekly winners." });
  }

  if (!rows || rows.length === 0) {
    return res.status(200).json({ ok: true, message: "No paid bids in the window — nothing to snapshot." });
  }

  // rows are ordered (category_id, total_bid_that_week desc) by the SQL function,
  // so the first row per category_id is that category's winner.
  const seenCategories = new Set();
  const categoryWinners = [];
  for (const row of rows) {
    if (!seenCategories.has(row.category_id)) {
      seenCategories.add(row.category_id);
      categoryWinners.push(row);
    }
  }

  const overallWinner = rows.reduce((best, row) =>
    !best || row.total_bid_that_week > best.total_bid_that_week ? row : best
  , null);

  const inserts = categoryWinners.map((row) => ({
    week_start: weekStartStr,
    week_end: weekEndStr,
    listing_id: row.listing_id,
    category_id: row.category_id,
    total_bid_that_week: row.total_bid_that_week,
  }));

  // Overall Hall-of-Fame row uses a null category_id to mean "all categories".
  if (overallWinner) {
    inserts.push({
      week_start: weekStartStr,
      week_end: weekEndStr,
      listing_id: overallWinner.listing_id,
      category_id: null,
      total_bid_that_week: overallWinner.total_bid_that_week,
    });
  }

  const { error: insertErr } = await supabaseAdmin.from("weekly_winners").insert(inserts);

  if (insertErr) {
    console.error("weekly-snapshot insert error:", insertErr);
    return res.status(500).json({ error: "Could not save weekly winners." });
  }

  return res.status(200).json({ ok: true, weekStart: weekStartStr, weekEnd: weekEndStr, winners: inserts.length });
}
