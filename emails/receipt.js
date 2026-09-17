// emails/receipt.js — HTML + plain-text templates for the payment receipt sent
// after verify-payment.js records a paid bid.
//
// Deliberately old-school table-based HTML with inline styles: modern flexbox/grid
// don't render in Outlook or Gmail's clipped-message view. Kept short — one focal
// action (see your listing) and one honest data block (what was paid, what rank
// resulted). No marketing copy in a receipt; that's a separate email if we ever
// send them.

const INR = (paise) => "₹" + Math.round((Number(paise) || 0) / 100).toLocaleString("en-IN");
const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
));

/** Build a receipt email for one paid bid.
    Inputs are already validated by verify-payment.js — this function only formats.
    Returns { subject, html, text } ready to hand to lib/email.js. */
export function buildReceiptEmail({
  bidderName,
  listingName,
  listingUrl,
  listingId,
  categoryName,
  rank,
  amountPaise,
  paymentId,
  isTopUp,
  siteUrl,
  supportEmail,
}) {
  const amount = INR(amountPaise);
  const displayName = escape(bidderName || "there");
  const listingSafe = escape(listingName || "your listing");
  const site = siteUrl || "https://bidspot.in";
  const bidspotListingHref = listingId ? escape(`${site}/product.html?id=${listingId}`) : escape(site);
  const externalHref = escape(listingUrl || site);
  const categorySafe = escape(categoryName || "");

  const headline = isTopUp
    ? `Your ${amount} top-up on ${listingSafe} was received`
    : `${listingSafe} is now live on BidSpot`;

  const subject = isTopUp
    ? `Bid received — ${listingSafe} is now #${rank}`
    : `Payment confirmed — ${listingSafe} is now #${rank}`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#F3ECE0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1A1A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3ECE0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FAF6EF;border:1px solid #E6DFC6;border-radius:12px;overflow:hidden;">

          <!-- Brand row -->
          <tr>
            <td style="padding:24px 28px 18px;border-bottom:1px solid #E6DFC6;">
              <div style="font-size:18px;font-weight:800;letter-spacing:-0.01em;">
                Bid<span style="color:#8B1E2E;">Spot</span>
              </div>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td style="padding:28px 28px 8px;">
              <div style="font-size:22px;font-weight:800;color:#1A1A1A;line-height:1.3;">
                ${escape(headline)}
              </div>
              <div style="font-size:14px;color:#5C564E;margin-top:8px;line-height:1.5;">
                Thanks, ${displayName}. Your payment cleared and your listing's rank
                is updated. Details below — keep this email for your records.
              </div>
            </td>
          </tr>

          <!-- Rank card -->
          <tr>
            <td style="padding:20px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:rgba(139,30,46,0.06);border:1px solid rgba(139,30,46,0.28);border-radius:10px;">
                <tr>
                  <td style="padding:20px;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8C8478;">New rank</div>
                    <div style="font-size:36px;font-weight:800;color:#8B1E2E;line-height:1.15;margin-top:2px;">#${escape(rank)}</div>
                    ${categorySafe ? `<div style="font-size:13px;color:#5C564E;margin-top:4px;">in ${categorySafe}</div>` : ""}
                  </td>
                  <td align="right" valign="top" style="padding:20px;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8C8478;">Paid</div>
                    <div style="font-size:22px;font-weight:800;color:#1A1A1A;margin-top:2px;">${amount}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:8px 28px 24px;" align="center">
              <a href="${bidspotListingHref}" style="display:inline-block;background:#8B1E2E;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:9999px;font-size:14px;font-weight:700;">
                See your listing on BidSpot →
              </a>
            </td>
          </tr>

          <!-- Details block -->
          <tr>
            <td style="padding:0 28px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:#5C564E;">
                <tr><td style="padding:6px 0;">Listing</td>            <td align="right" style="padding:6px 0;color:#1A1A1A;font-weight:600;">${listingSafe}</td></tr>
                ${categorySafe ? `<tr><td style="padding:6px 0;">Category</td>          <td align="right" style="padding:6px 0;color:#1A1A1A;font-weight:600;">${categorySafe}</td></tr>` : ""}
                <tr><td style="padding:6px 0;">Amount</td>             <td align="right" style="padding:6px 0;color:#1A1A1A;font-weight:600;">${amount}</td></tr>
                <tr><td style="padding:6px 0;">Payment ID</td>         <td align="right" style="padding:6px 0;color:#1A1A1A;font-weight:600;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;">${escape(paymentId || "-")}</td></tr>
                <tr><td style="padding:6px 0;">Type</td>               <td align="right" style="padding:6px 0;color:#1A1A1A;font-weight:600;">${isTopUp ? "Top-up bid" : "First bid on this listing"}</td></tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 28px;background:#F3ECE0;border-top:1px solid #E6DFC6;font-size:12px;color:#8C8478;line-height:1.6;">
              <div>
                Bids on BidSpot are final once payment clears. If you spot a problem with
                this payment${supportEmail ? `, reply to this email or write to <a href="mailto:${escape(supportEmail)}" style="color:#8B1E2E;">${escape(supportEmail)}</a>` : ""}.
              </div>
              <div style="margin-top:10px;">
                <a href="${escape(site)}" style="color:#8B1E2E;text-decoration:none;">bidspot.in</a>
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Gmail's "clipped" view and any plain-text-only client (Outlook rules, some
  // corporate filters) get a readable fallback rather than a wall of nothing.
  const text = [
    headline,
    "",
    `Hi ${bidderName || "there"},`,
    "",
    isTopUp
      ? `Your top-up on ${listingName} was received. It now sits at rank #${rank}${categoryName ? ` in ${categoryName}` : ""}.`
      : `${listingName} is now live on BidSpot at rank #${rank}${categoryName ? ` in ${categoryName}` : ""}.`,
    "",
    `Amount:     ${amount}`,
    `Payment ID: ${paymentId || "-"}`,
    `Listing:    ${listingId ? `${site}/product.html?id=${listingId}` : site}`,
    "",
    supportEmail
      ? `Questions about this payment? Reply here or write to ${supportEmail}.`
      : `Questions about this payment? Reply to this email.`,
    "",
    site,
  ].join("\n");

  return { subject, html, text };
}
