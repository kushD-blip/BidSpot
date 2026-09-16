/* js/analytics.js — analytics.html: real totals computed from live Supabase data.
   No fabricated numbers — every figure here is derived straight from `listings`. */

import { fetchApprovedListings, fetchCategories } from './supabase-client.js';
import { mapSupabaseListing } from './listing-mapper.js';
import { isSupabaseConfigured } from './config.js';

const INR = (n) => '₹' + n.toLocaleString('en-IN');

async function render() {
  const kpiListings = document.getElementById('kpi-listings');
  const kpiVolume = document.getElementById('kpi-volume');
  const kpiClicks = document.getElementById('kpi-clicks');
  const kpiCategories = document.getElementById('kpi-categories');
  const breakdown = document.getElementById('category-breakdown');

  if (!isSupabaseConfigured) {
    if (breakdown) breakdown.innerHTML = '<div class="empty-state-block"><h3>Not connected yet</h3><p>Analytics needs Supabase configured in js/config.js.</p></div>';
    return;
  }

  const [listings, categories] = await Promise.all([
    fetchApprovedListings({ limit: 1000 }),
    fetchCategories(),
  ]);

  const items = listings.map((row) => mapSupabaseListing(row));
  const totalVolumeINR = items.reduce((sum, i) => sum + i.amountINR, 0);
  const totalClicks = items.reduce((sum, i) => sum + i.clicks, 0);

  const rows = categories
    .map((cat) => {
      const inCategory = items.filter((i) => i.category === cat.name);
      const volume = inCategory.reduce((sum, i) => sum + i.amountINR, 0);
      return { cat, count: inCategory.length, volume };
    })
    .sort((a, b) => b.volume - a.volume);

  const activeCategories = rows.filter((r) => r.count > 0).length;

  if (kpiListings) kpiListings.textContent = items.length.toLocaleString('en-IN');
  if (kpiVolume) kpiVolume.textContent = INR(totalVolumeINR);
  if (kpiClicks) kpiClicks.textContent = totalClicks.toLocaleString('en-IN');
  if (kpiCategories) kpiCategories.textContent = activeCategories.toLocaleString('en-IN');

  if (!breakdown) return;
  if (categories.length === 0) {
    breakdown.innerHTML = '<div class="empty-state-block"><h3>No categories yet</h3><p>Run schema.sql in Supabase to seed the category list.</p></div>';
    return;
  }

  const maxVolume = Math.max(1, ...rows.map((r) => r.volume));

  breakdown.innerHTML = rows
    .map(
      (r) => `
    <div class="analytics-cat-row">
      <div class="analytics-cat-icon">${r.cat.icon || '🏷️'}</div>
      <div class="analytics-cat-body">
        <span class="analytics-cat-name">${r.cat.name}</span>
        <div class="analytics-cat-bar-track">
          <div class="analytics-cat-bar-fill" style="width:${Math.round((r.volume / maxVolume) * 100)}%"></div>
        </div>
      </div>
      <div class="analytics-cat-meta">
        ${r.count} listing${r.count === 1 ? '' : 's'}<br>
        <strong>${INR(r.volume)}</strong>
      </div>
    </div>`
    )
    .join('');
}

render();
