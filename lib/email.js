// lib/email.js — thin Resend wrapper used by /api/verify-payment.js.
//
// No SDK: Resend's HTTP API is one POST endpoint, so we call it with fetch() and
// skip a whole npm dependency (Vercel builds are faster and there's one less thing
// to keep in step). Requires two env vars:
//   RESEND_API_KEY      — from Resend dashboard (Settings > API Keys)
//   RECEIPT_FROM_EMAIL  — a verified sender address on your domain, e.g.
//                         "BidSpot <noreply@bidspot.in>". Until this is set,
//                         sendEmail() is a no-op that logs and returns { skipped }
//                         — everything else in the payment path keeps working.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Send a transactional email. On any config gap or provider failure, logs and
    returns without throwing — a receipt going missing must never break a real
    payment that's already been captured and credited. */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RECEIPT_FROM_EMAIL;

  if (!apiKey || !from) {
    console.log(`[email] skipped: ${!apiKey ? "RESEND_API_KEY" : "RECEIPT_FROM_EMAIL"} not set (to=${to || "?"}, subject=${subject || "?"})`);
    return { skipped: true, reason: "not configured" };
  }
  if (!to || !subject || (!html && !text)) {
    console.log(`[email] skipped: missing to/subject/body`);
    return { skipped: true, reason: "missing fields" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[email] send failed (${res.status}):`, body);
      return { skipped: false, error: body?.message || `status ${res.status}` };
    }
    return { skipped: false, id: body?.id };
  } catch (err) {
    // Network failure, DNS issue, cold start timeout — the bid is already recorded,
    // don't propagate to the caller and don't crash the request.
    console.error("[email] send threw:", err);
    return { skipped: false, error: err?.message || String(err) };
  }
}
