// api/create-order.js  (Vercel serverless function -> POST /api/create-order)
// Called when a user clicks "Place Bid" and submits amount + listing details.

import { razorpay, supabaseAdmin } from "../lib/razorpay.js";

const MIN_BID_PAISE = 10000; // ₹100 minimum, matches schema.sql / README

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { listingId, bidderName, bidderEmail, amountRupees, currency = "INR" } = req.body || {};

  const amountPaise = Math.round(Number(amountRupees) * 100);

  if (!listingId || !amountPaise || amountPaise < MIN_BID_PAISE) {
    return res.status(400).json({ error: "Invalid bid amount (minimum ₹100)." });
  }

  // Listing must exist and not be rejected/removed. A brand-new listing starts
  // 'pending' — there's no admin queue yet, so it's allowed straight to checkout
  // and verify-payment.js flips it to 'approved' once payment actually clears.
  // (Nothing goes live off an unpaid pending row — RLS only lets the public read
  // status='approved' listings.)
  const { data: listing, error: listingErr } = await supabaseAdmin
    .from("listings")
    .select("id, status, total_bid_alltime")
    .eq("id", listingId)
    .single();

  if (listingErr || !listing || listing.status === "rejected" || listing.status === "removed") {
    return res.status(400).json({ error: "Listing not found or no longer accepting bids." });
  }

  try {
    const order = await razorpay.orders.create({
      amount: amountPaise, // in paise
      currency,
      receipt: `bid_${listingId}_${Date.now()}`,
      notes: { listingId, bidderEmail: bidderEmail || "not provided" },
    });

    // Record a pending bid row now; it's marked 'paid' only after signature
    // verification in api/verify-payment.js — never trusted before that.
    const { error: insertErr } = await supabaseAdmin.from("bids").insert({
      listing_id: listingId,
      bidder_name: bidderName || null,
      bidder_email: bidderEmail || null,
      amount: amountPaise,
      currency,
      razorpay_order_id: order.id,
      status: "created",
    });

    if (insertErr) throw insertErr;

    return res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID, // safe to expose, it's the public key
    });
  } catch (err) {
    console.error("create-order error:", err);
    return res.status(500).json({ error: "Could not create order." });
  }
}
