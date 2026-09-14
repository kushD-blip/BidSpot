// lib/razorpay.js
// Server-side only. Never import this from frontend code (js/*.js) — the service-role
// key bypasses Row Level Security entirely.

import Razorpay from "razorpay";
import { createClient } from "@supabase/supabase-js";

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET, // server env var, never expose to the client
});

// Service-role client: bypasses RLS. Only use inside /api routes.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server env var only
);
