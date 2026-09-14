/* js/categories.js — categories.html: "Most active" spotlight (top 3 by volume)
   plus a full grid of every category, each showing its own top-3 mini-ranking.
   Modeled on outbid.lol/categories. */

import { fetchApprovedListings, fetchCategories } from './supabase-client.js';
import { mapSupabaseListing } from './listing-mapper.js';
import { isSupabaseConfigured } from './config.js';
import { renderLogo } from './get-logo.js';

function miniRankRow(item, rank) {
  return `
    <div class="mini-rank-row">
      <span class="mini-rank-num">#${rank}</span>
      <span class="mini-rank-logo" data-domain="${item.domain}" data-text="${item.logoText}" data-bg="${item.logoBg}" style="background:${item.logoBg};">${item.logoText}</span>
      <span class="mini-rank-title">${item.title}</span>
      <span class="mini-rank-price">₹${item.amountINR.toLocaleString('en-IN')}</span>
    </div>
  `;
}

function hydrateLogos(root) {
  root.querySelectorAll('.mini-rank-logo').forEach((el) => {
    renderLogo(el, el.dataset.domain, { text: el.dataset.text, bg: el.dataset.bg });
  });
}

async function render() {
  const spotlight = document.getElementById('most-active-grid');
  const grid = document.getElementById('category-grid');
  if (!grid) return;

  if (!isSupabaseConfigured) {
    grid.innerHTML = `<div class="empty-state-block"><h3>Not connected yet</h3><p>Category data needs Supabase configured in js/config.js.</p></div>`;
    return;
  }

  const [categories, listings] = await Promise.all([fetchCategories(), fetchApprovedListings({ limit: 1000 })]);
  const items = listings.map((row) => mapSupabaseListing(row));

  if (categories.length === 0) {
    grid.innerHTML = `<div class="empty-state-block"><h3>No categories yet</h3><p>Run schema.sql in Supabase to seed the category list.</p></div>`;
    return;
  }

  const byCategory = categories.map((cat) => {
    const inCategory = items.filter((item) => item.category === cat.name).sort((a, b) => b.amountINR - a.amountINR);
    const volume = inCategory.reduce((sum, i) => sum + i.amountINR, 0);
    return { cat, inCategory, volume };
  });

  // "Most active" — top 3 categories by total volume that actually have at least one bid.
  if (spotlight) {
    const topThree = byCategory
      .filter((c) => c.inCategory.length > 0)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 3);

    if (topThree.length === 0) {
      spotlight.closest('.most-active-panel').style.display = 'none';
    } else {
      spotlight.innerHTML = topThree
        .map(({ cat, inCategory }, idx) => `
          <a class="category-overview-card" href="./index.html?category=${encodeURIComponent(cat.name)}">
            <span class="most-active-rank-badge">#${idx + 1}${idx === 0 ? ' hottest' : ''}</span>
            <div class="category-overview-head">
              <span class="category-overview-icon">${cat.icon || '🏷️'}</span>
              <span class="category-overview-name">${cat.name}</span>
              <span class="category-overview-count">${inCategory.length} listing${inCategory.length === 1 ? '' : 's'}</span>
            </div>
            <div class="category-overview-top">${miniRankRow(inCategory[0], 1)}</div>
          </a>
        `)
        .join('');
      hydrateLogos(spotlight);
    }
  }

  grid.innerHTML = byCategory
    .map(({ cat, inCategory }) => `
      <a class="category-overview-card" href="./index.html?category=${encodeURIComponent(cat.name)}">
        <div class="category-overview-head">
          <span class="category-overview-icon">${cat.icon || '🏷️'}</span>
          <span class="category-overview-name">${cat.name}</span>
          <span class="category-overview-count">${inCategory.length} listing${inCategory.length === 1 ? '' : 's'}</span>
        </div>
        ${inCategory.length > 0
          ? `<div class="category-overview-top">${inCategory.slice(0, 3).map((item, i) => miniRankRow(item, i + 1)).join('')}</div>`
          : `<div class="category-overview-top"><span style="color:var(--text-muted);">No bids yet — be the first</span></div>`}
      </a>
    `)
    .join('');
  hydrateLogos(grid);
}

render();
