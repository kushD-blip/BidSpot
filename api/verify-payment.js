// api/verify-payment.js  (Vercel serverless function -> POST /api/verify-payment)
// Called client-side from the Razorpay checkout success handler. For production,
// also configure the same logic as a Razorpay webhook (Dashboard > Webhooks,
// event: payment.captured) pointed at this same URL — the webhook is the source
// of truth; the client callback just makes the UI feel instant.

import crypto from "crypto";
import { razorpay, supabaseAdmin } from "../lib/razorpay.js";

// How many listings earn the Founding Bidder badge. Awarded to the first listings
// that ever clear a payment — an earned, factual marker of being early, not a
// fabricated scarcity counter. Raising this later only affects listings that go
// live after the change; badges already awarded are never revoked.
const FOUNDING_BIDDER_LIMIT = 20;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "Missing payment fields." });
  }

  const generatedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    return res.status(400).json({ error: "Signature mismatch — payment not trusted." });
  }

  const { data: bid, error: bidErr } = await supabaseAdmin
    .from("bids")
    .select("*")
    .eq("razorpay_order_id", razorpay_order_id)
    .single();

  if (bidErr || !bid) {
    return res.status(404).json({ error: "Bid record not found." });
  }

  if (bid.status === "paid") {
    // Already processed (webhook + client callback both fired) — don't double count.
    return res.status(200).json({ ok: true, alreadyProcessed: true });
  }

  // Belt-and-suspenders: the signature already cryptographically ties order_id to
  // payment_id, but independently re-fetch the payment from Razorpay's own API and
  // confirm it was actually captured for exactly the amount we created the order
  // for. Nothing in this flow lets a payer edit the amount in the checkout widget
  // (it's locked to the server-created order), but this guards against that concern
  // regardless of how the payment was completed.
  let payment;
  try {
    payment = await razorpay.payments.fetch(razorpay_payment_id);
  } catch (err) {
    console.error("verify-payment: could not fetch payment from Razorpay:", err);
    return res.status(502).json({ error: "Could not confirm payment with Razorpay." });
  }

  if (payment.order_id !== razorpay_order_id || payment.amount !== bid.amount) {
    console.error("verify-payment: amount/order mismatch", { expected: bid.amount, got: payment.amount, bid, payment });
    return res.status(400).json({ error: "Payment amount didn't match the order — not crediting this bid." });
  }

  if (payment.status !== "captured") {
    return res.status(400).json({ error: `Payment not captured yet (status: ${payment.status}).` });
  }

  await supabaseAdmin
    .from("bids")
    .update({
      status: "paid",
      razorpay_payment_id,
      razorpay_signature,
      verified_at: new Date().toISOString(),
    })
    .eq("id", bid.id);

  await supabaseAdmin.rpc("increment_listing_totals", {
    p_listing_id: bid.listing_id,
    p_amount: bid.amount,
  });

  // First paid bid on a listing takes it live — there's no admin approval queue
  // yet, so a cleared payment is what actually publishes a new submission. The
  // same call awards the Founding Bidder badge if this is one of the first
  // FOUNDING_BIDDER_LIMIT listings to go live; it's one atomic SQL function so a
  // burst of simultaneous payments can't over-award the badge (see schema.sql).
  // A repeat bid on an already-live listing (a top-up) leaves both untouched.
  const { data: listing } = await supabaseAdmin
    .from("listings")
    .select("name, status")
    .eq("id", bid.listing_id)
    .single();

  const { error: approveErr } = await supabaseAdmin.rpc("approve_listing_and_award_founding", {
    p_listing_id: bid.listing_id,
    p_limit: FOUNDING_BIDDER_LIMIT,
  });

  // The bid itself is already recorded and credited above — a failure to publish
  // the listing shouldn't discard a real payment, so log loudly and continue.
  if (approveErr) {
    console.error("verify-payment: could not approve listing", bid.listing_id, approveErr);
  }

  await supabaseAdmin.from("activity_feed").insert({
    listing_id: bid.listing_id,
    listing_name: listing?.name || "Someone",
    amount: bid.amount,
    city: pickRandomIndianCity(),
  });

  return res.status(200).json({ ok: true });
}

function pickRandomIndianCity() {
  const cities = ["Bengaluru", "Mumbai", "Delhi NCR", "Hyderabad", "Pune", "Chennai", "Ahmedabad", "Mysuru"];
  return cities[Math.floor(Math.random() * cities.length)];
}
