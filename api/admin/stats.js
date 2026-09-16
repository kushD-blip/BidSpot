/* api/admin/stats.js  (GET /api/admin/stats)
 *
 * One consolidated read of everything the admin dashboard renders. Six queries
 * fan out in parallel and each one degrades independently — a broken aggregate
 * returns as an empty array/zero rather than a 500, so a single database issue
 * can't take the whole dashboard down.
 *
 * All aggregates are locked to service_role at the SQL layer (see schema.sql),
 * so this endpoint is the only path from the browser to the numbers.
 */

import { supabaseAdmin } from '../../lib/razorpay.js';
import { requireAdmin } from '../../lib/admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (requireAdmin(req, res)) return;

  // Runs each aggregate in a try wrapper so one bad aggregate returns []/0
  // and the rest of the dashboard still paints. Cheaper than a single try
  // around the whole Promise.all, which would blank every tile on any failure.
  const safe = async (label, run, fallback) => {
    try { return await run(); }
    catch (err) { console.error(`[admin/stats] ${label} failed:`, err); return fallback; }
  };

  const [totals, bidsByDay, topCategories, listingsByStatus, recentBids, pendingCount] =
    await Promise.all([
      safe('totals',
        async () => (await supabaseAdmin.rpc('admin_totals'))?.data?.[0]
          ?? { paid_count: 0, volume_paise: 0, listings_count: 0 },
        { paid_count: 0, volume_paise: 0, listings_count: 0 }),

      safe('bidsByDay',
        async () => (await supabaseAdmin.rpc('admin_bids_by_day', { p_days: 30 }))?.data ?? [],
        []),

      safe('topCategories',
        async () => (await supabaseAdmin.rpc('admin_volume_by_category', { p_limit: 10 }))?.data ?? [],
        []),

      safe('listingsByStatus',
        async () => (await supabaseAdmin.rpc('admin_listings_by_status'))?.data ?? [],
        []),

      // Direct query rather than an aggregate: recent bids need the joined
      // listing name, and it's fast enough for 20 rows.
      safe('recentBids',
        async () => (await supabaseAdmin
          .from('bids')
          .select('id, amount, currency, created_at, listings(name)')
          .eq('status', 'paid')
          .order('created_at', { ascending: false })
          .limit(20))?.data ?? [],
        []),

      safe('pendingCount',
        async () => (await supabaseAdmin
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending'))?.count ?? 0,
        0),
    ]);

  return res.status(200).json({
    totals,
    bidsByDay,
    topCategories,
    listingsByStatus,
    recentBids,
    pendingCount,
    generatedAt: new Date().toISOString(),
  });
}
