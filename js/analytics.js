/* js/analytics.js — analytics.html: real totals computed from live Supabase data.
   No fabricated numbers — every figure here is derived straight from `listings`. */

import { fetchApprovedListings, fetchCategories } from './supabase-client.js';
import { mapSupabaseListing } from './listing-mapper.js';
import { isSupabaseConfigured } from './config.js';

async function render() {
  const statCards = document.getElementById('stat-cards');
  const breakdown = document.getElementById('category-breakdown');
  if (!statCards || !breakdown) return;

  if (!isSupabaseConfigured) {
    statCards.innerHTML = `<div class="empty-state-block"><h3>Not connected yet</h3><p>Analytics needs Supabase configured in js/config.js.</p></div>`;
    return;
  }

  const [listings, categories] = await Promise.all([fetchApprovedListings({ limit: 1000 }), fetchCategories()]);
  const items = listings.map((row) => mapSupabaseListing(row));

  const totalVolumeINR = items.reduce((sum, i) => sum + i.amountINR, 0);
  const totalClicks = items.reduce((sum, i) => sum + i.clicks, 0);

  statCards.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-value">${items.length.toLocaleString('en-IN')}</div>
      <div class="stat-card-label">live listings</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">₹${totalVolumeINR.toLocaleString('en-IN')}</div>
      <div class="stat-card-label">total volume bid</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-value">${totalClicks.toLocaleString('en-IN')}</div>
      <div class="stat-card-label">total clicks</div>
    </div>
  `;

  if (categories.length === 0) {
    breakdown.innerHTML = `<div class="empty-state-block"><h3>No categories yet</h3><p>Run schema.sql in Supabase to seed the category list.</p></div>`;
    return;
  }

  const rows = categories
    .map((cat) => {
      const inCategory = items.filter((i) => i.category === cat.name);
      const volume = inCategory.reduce((sum, i) => sum + i.amountINR, 0);
      return { cat, count: inCategory.length, volume };
    })
    .sort((a, b) => b.volume - a.volume);

  const maxVolume = Math.max(1, ...rows.map((r) => r.volume));

  breakdown.innerHTML = rows
    .map(
      (r) => `
    <div style="display:flex; align-items:center; gap:12px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-sm); padding:12px 16px;">
      <span style="font-size:1.1rem;">${r.cat.icon || '🏷️'}</span>
      <span style="flex:0 0 130px; font-weight:600; color:var(--text-primary); font-size:0.88rem;">${r.cat.name}</span>
      <div style="flex:1; background:var(--bg-secondary); border-radius:var(--radius-full); height:8px; overflow:hidden;">
        <div style="width:${Math.round((r.volume / maxVolume) * 100)}%; height:100%; background:var(--accent-primary);"></div>
      </div>
      <span style="font-size:0.8rem; color:var(--text-muted); flex:0 0 auto; white-space:nowrap;">${r.count} listing${r.count === 1 ? '' : 's'} · ₹${r.volume.toLocaleString('en-IN')}</span>
    </div>
  `
    )
    .join('');
}

render();
