/* js/today.js — today.html: full "today" ranking (sorted by total_bid_today),
   using the same .leaderboard-card markup/classes as the home page for visual
   consistency, plus a small stats block at the bottom. */

import { fetchApprovedListings } from './supabase-client.js';
import { mapSupabaseListing } from './listing-mapper.js';
import { isSupabaseConfigured } from './config.js';
import { renderLogo } from './get-logo.js';

function formatINR(n) {
  return '₹' + Math.round(n || 0).toLocaleString('en-IN');
}

async function render() {
  const container = document.getElementById('today-list');
  const statCards = document.getElementById('stat-cards');
  if (!container) return;

  if (!isSupabaseConfigured) {
    container.innerHTML = `<div class="empty-state-block"><h3>Not connected yet</h3><p>Today's rankings need Supabase configured in js/config.js.</p></div>`;
    return;
  }

  const rows = await fetchApprovedListings({ orderBy: 'total_bid_today', limit: 50 });
  const allItems = rows.map((row) => mapSupabaseListing(row));
  const todayItems = allItems
    .map((item, idx) => ({ ...item, todayINR: Math.round((rows[idx].total_bid_today || 0) / 100) }))
    .filter((item) => item.todayINR > 0)
    .sort((a, b) => b.todayINR - a.todayINR)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  if (todayItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state-block">
        <h3>No bids yet today</h3>
        <p>Today's board resets daily at midnight IST — be the first bidder of the day.</p>
        <a href="./index.html" class="btn-primary" style="display:inline-flex; margin-top:12px;">Place a bid</a>
      </div>
    `;
  } else {
    container.innerHTML = todayItems
      .map(
        (item) => `
      <div class="leaderboard-card rank-${item.rank}">
        <div class="card-rank">#${item.rank}</div>
        <a class="card-logo" href="./product.html?id=${item.id}" style="background: ${item.logoBg}; text-decoration:none;">${item.logoText}</a>
        <div class="card-details">
          <div class="card-title-row">
            <h3 class="card-title"><a href="./product.html?id=${item.id}" style="color:inherit;">${item.title}</a></h3>
            ${item.verified ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` : ''}
          </div>
          <p class="card-tagline">${item.tagline}</p>
          <div class="card-meta">
            <a href="./index.html?category=${encodeURIComponent(item.category)}" class="category-tag">${item.category}</a>
            <span class="meta-item">${item.timestamp}</span>
            <a href="./product.html?id=${item.id}" class="meta-link">see details</a>
          </div>
        </div>
        <div class="card-price-section">
          <span class="card-price-label">TODAY</span>
          <span class="card-price">${formatINR(item.todayINR)}</span>
        </div>
      </div>
    `
      )
      .join('');

    container.querySelectorAll('.leaderboard-card').forEach((card, idx) => {
      const logoEl = card.querySelector('.card-logo');
      const item = todayItems[idx];
      if (logoEl && item) renderLogo(logoEl, item.domain, { text: item.logoText, bg: item.logoBg });
    });
  }

  if (statCards) {
    const todayVolume = todayItems.reduce((sum, i) => sum + i.todayINR, 0);
    statCards.innerHTML = `
      <div class="stat-card">
        <div class="stat-card-value">${todayItems.length}</div>
        <div class="stat-card-label">bidders today</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${formatINR(todayVolume)}</div>
        <div class="stat-card-label">today's volume</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-value">${allItems.length}</div>
        <div class="stat-card-label">total live listings</div>
      </div>
    `;
  }
}

render();
