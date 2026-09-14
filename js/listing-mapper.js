/* js/listing-mapper.js — shared Supabase-row -> UI-item mapping.
   Used by state.js (home page) and the read-only pages (today.html, product.html,
   categories.html, analytics.html) so every page renders listings identically
   without each re-implementing the paise->rupee conversion, logo color, etc. */

export const USD_TO_INR = 85.0; // Standard FX rate — canonical home, state.js re-exports it
export const MIN_BID_INR = 100; // The real floor — must match api/create-order.js's MIN_BID_PAISE

const LOGO_COLORS = [
  'linear-gradient(135deg, #8B1E2E, #B23A4A)',
  'linear-gradient(135deg, #1A1A1A, #5C564E)',
  'linear-gradient(135deg, #5C564E, #8C8478)',
  'linear-gradient(135deg, #721825, #8B1E2E)',
];

export function pickColorForId(id) {
  const str = String(id || '');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return LOGO_COLORS[hash % LOGO_COLORS.length];
}

/** Escapes text for safe insertion into innerHTML template strings (both element
    content and double-quoted attribute values). Listing title/tagline/url are
    real user input now (submitted via submitListing()) and get rendered via
    innerHTML across several pages — without this, a submitted listing could
    stored-XSS every visitor who views the leaderboard. */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

export function timeAgo(isoString) {
  if (!isoString) return 'Just now';
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Maps a Supabase `listings` row (with joined `categories(...)`) into the flat
    item shape every page's card template expects. `todayMode` sorts/displays by
    total_bid_today instead of the all-time total (used on today.html). */
export function mapSupabaseListing(row, { todayMode = false } = {}) {
  // Compute domain/id/href-safety from the RAW url before escaping for display —
  // escaping is for HTML output, not for parsing.
  const rawUrl = row.url || '';
  const domain = rawUrl.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
  const paise = todayMode ? row.total_bid_today : row.total_bid_alltime;
  const amountINR = Math.round((paise || 0) / 100);
  return {
    id: row.id,
    title: escapeHtml(row.name),
    tagline: escapeHtml(row.tagline || ''),
    // Not escaped, unlike the user-submitted fields below: category names come from
    // the admin-managed `categories` table (schema.sql), never from user input, and
    // this value is also used for exact-string category matching/filtering — an
    // escaped "Agencies &amp; Services" silently failed to match the unescaped
    // "Agencies & Services" from fetchCategories(), so that category's own listing
    // never showed up on its own category page even though the data was correct.
    category: row.categories?.name || 'Productivity',
    categorySlug: row.categories?.slug || '',
    url: escapeHtml(rawUrl),
    domain: escapeHtml(domain),
    logoText: escapeHtml((row.name || '?').slice(0, 2).toUpperCase()),
    logoBg: pickColorForId(row.id),
    clicks: row.clicks || 0,
    amountUSD: Math.round(amountINR / USD_TO_INR),
    amountINR,
    timestamp: timeAgo(row.created_at),
    verified: !!row.verified,
    country: 'India',
  };
}
