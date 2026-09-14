/* js/product.js — product.html: single listing detail, read by ?id= from the URL.
   The actual bid/outbid action always happens on index.html (single source of truth
   for payments) — this page just links there with ?outbid=<id>. */

import { fetchListingById, fetchApprovedListings, trackClick } from './supabase-client.js';
import { mapSupabaseListing } from './listing-mapper.js';
import { isSupabaseConfigured } from './config.js';
import { renderLogo } from './get-logo.js';

function formatINR(n) {
  return '₹' + Math.round(n || 0).toLocaleString('en-IN');
}

async function render() {
  const container = document.getElementById('product-detail');
  if (!container) return;

  const id = new URLSearchParams(location.search).get('id');

  if (!isSupabaseConfigured) {
    container.innerHTML = `<div class="empty-state-block"><h3>Not connected yet</h3><p>Listing pages need Supabase configured in js/config.js.</p></div>`;
    return;
  }

  if (!id) {
    container.innerHTML = `<div class="empty-state-block"><h3>No listing specified</h3><p><a href="./index.html">Back to the leaderboard</a></p></div>`;
    return;
  }

  const [row, allRows] = await Promise.all([fetchListingById(id), fetchApprovedListings({ limit: 1000 })]);

  if (!row) {
    container.innerHTML = `<div class="empty-state-block"><h3>Listing not found</h3><p>It may have been removed, or the link is incorrect.<br><a href="./index.html">Back to the leaderboard</a></p></div>`;
    return;
  }

  const item = mapSupabaseListing(row);
  const sortedIds = allRows.map((r) => r.id);
  const rank = sortedIds.indexOf(row.id) + 1;

  document.title = `${item.title} — BidSpot.in`;

  container.innerHTML = `
    <div class="product-hero-card">
      ${rank > 0 ? `<span class="product-hero-rank">#${rank}</span>` : ''}
      <div class="product-hero-logo" id="product-logo" style="background:${item.logoBg};">${item.logoText}</div>
      <h1 class="product-hero-title">
        ${item.title}
        ${item.verified ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Verified"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` : ''}
      </h1>
      <p class="product-hero-tagline">${item.tagline || 'No description provided.'}</p>
      <div class="product-hero-meta">
        <span class="category-tag">${item.category}</span>
        <span>${item.timestamp}</span>
        <a href="${item.url}" target="_blank" rel="noopener" class="meta-link">${item.domain}</a>
        <span>${item.clicks.toLocaleString('en-IN')} clicks</span>
      </div>
      <div>
        <div style="font-size:0.78rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted);">All-time floor bid</div>
        <div class="product-hero-price">${formatINR(item.amountINR)}</div>
      </div>
      <a href="./index.html?outbid=${item.id}" class="btn-primary" style="margin-top: 8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 13 5 5"></path><path d="m3 21 3-3"></path><path d="m9 15 2 2"></path><path d="m11 9 5 5"></path><path d="m13 3 6 6-6 6-6-6 6-6Z"></path></svg>
        <span>Claim this rank</span>
      </a>
    </div>
  `;

  const logoEl = document.getElementById('product-logo');
  if (logoEl) renderLogo(logoEl, item.domain, { text: item.logoText, bg: item.logoBg });

  const outboundLink = container.querySelector('.meta-link');
  if (outboundLink) outboundLink.addEventListener('click', () => trackClick(item.id));
}

render();
