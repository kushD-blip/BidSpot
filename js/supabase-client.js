/* js/supabase-client.js — frontend Supabase access (anon key, RLS-restricted).
   Imported by state.js, ui.js, app.js, product.js, and today.js whenever
   js/config.js has real Supabase credentials configured; falls back to the demo
   dataset in state.js otherwise.

   Anon key can only do what schema.sql's RLS policies allow:
     - read listings where status = 'approved'
     - insert a new listing with status = 'pending'
   Everything else (bids, approving listings) goes through /api routes using the
   service-role key on the server. */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from "./config.js";

export const supabase = isSupabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export async function fetchApprovedListings({ orderBy = "total_bid_alltime", limit = 100 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("listings")
    .select("*, categories(slug, name, icon)")
    .eq("status", "approved")
    .order(orderBy, { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchApprovedListings error:", error);
    return [];
  }
  return data;
}

/** Single approved listing by id — used by product.html's detail page. */
export async function fetchListingById(id) {
  if (!supabase || !id) return null;
  const { data, error } = await supabase
    .from("listings")
    .select("*, categories(slug, name, icon)")
    .eq("id", id)
    .eq("status", "approved")
    .single();

  if (error) {
    console.error("fetchListingById error:", error);
    return null;
  }
  return data;
}

export async function fetchActivityFeed({ limit = 20 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("activity_feed")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchActivityFeed error:", error);
    return [];
  }
  return data;
}

export async function fetchCategories() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("categories").select("*").order("sort_order");
  if (error) {
    console.error("fetchCategories error:", error);
    return [];
  }
  return data;
}

export async function fetchWeeklyWinners({ limit = 20 } = {}) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("weekly_winners")
    .select("*, listings(name, url, logo_url), categories(name, icon)")
    .order("week_start", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("fetchWeeklyWinners error:", error);
    return [];
  }
  return data;
}

/** Submits a new listing as 'pending' (RLS only allows that status via the anon key).
    Generates the id client-side rather than reading it back after insert — a 'pending'
    row isn't covered by the public-read policy (only 'approved' is), so `.select()`
    right after insert would fail under RLS even though the insert itself succeeded. */
export async function submitListing({ name, url, tagline, logoUrl, categoryId, ownerEmail }) {
  if (!supabase) return { error: { message: "Supabase not configured yet." } };
  const id = crypto.randomUUID();
  const { error } = await supabase.from("listings").insert({
    id,
    name,
    url,
    tagline,
    logo_url: logoUrl || null,
    category_id: categoryId,
    owner_email: ownerEmail || null,
    status: "pending",
  });

  if (error) return { error };
  return { data: { id } };
}

/** Fire-and-forget click counter for a listing's outbound link. Goes through an
    RPC (increment_listing_clicks in schema.sql) rather than a plain update because
    the anon key has no UPDATE grant on listings at all under RLS — the function
    runs as SECURITY DEFINER and only ever does one atomic `clicks = clicks + 1`. */
export async function trackClick(listingId) {
  if (!supabase || !listingId) return;
  const { error } = await supabase.rpc('increment_listing_clicks', { p_listing_id: listingId });
  if (error) console.error("trackClick error:", error);
}

/** Realtime subscription: calls `onChange` whenever any listing row changes (used to
    re-render the leaderboard live instead of polling). Returns an unsubscribe function. */
export function subscribeToListingChanges(onChange) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel("listings-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, onChange)
    .subscribe();

  return () => supabase.removeChannel(channel);
}
