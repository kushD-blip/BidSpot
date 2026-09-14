// api/cron/reset-daily.js  (Vercel Cron -> GET /api/cron/reset-daily, scheduled in vercel.json)
// Resets every listing's `total_bid_today` counter to 0 at the start of each day (IST),
// so "Today's Board" reflects fresh daily competition instead of accumulating forever.
// total_bid_alltime is untouched — that's the permanent leaderboard.

import { supabaseAdmin } from "../../lib/razorpay.js";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { error } = await supabaseAdmin
    .from("listings")
    .update({ total_bid_today: 0 })
    .neq("id", "00000000-0000-0000-0000-000000000000"); // update every row

  if (error) {
    console.error("reset-daily error:", error);
    return res.status(500).json({ error: "Reset failed." });
  }

  return res.status(200).json({ ok: true, resetAt: new Date().toISOString() });
}
