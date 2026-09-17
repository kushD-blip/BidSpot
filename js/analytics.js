/* js/analytics.js — Premium analytics dashboard.
   Every figure comes from live Supabase data — nothing fabricated. */

import { fetchApprovedListings, fetchCategories, fetchActivityFeed } from './supabase-client.js';
import { mapSupabaseListing, escapeHtml } from './listing-mapper.js';
import { isSupabaseConfigured } from './config.js';

const INR = (n) => '₹' + n.toLocaleString('en-IN');

let currentRange = 7;
let cachedActivity = [];
let cachedListings = [];
let cachedEls = {};

function shortTimeAgo(iso) {
  if (!iso) return 'Just now';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(d) {
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function formatDay(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'short' });
}

function buildBidEvents(activity, listings) {
  if (activity.length > 0) return activity;
  return listings.map((row) => ({
    listing_name: row.name,
    amount: row.total_bid_alltime || 0,
    created_at: row.created_at,
  }));
}

async function render() {
  const els = {
    kpiListings: document.getElementById('kpi-listings'),
    kpiVolume: document.getElementById('kpi-volume'),
    kpiClicks: document.getElementById('kpi-clicks'),
    kpiCategories: document.getElementById('kpi-categories'),
    chart: document.getElementById('daily-chart'),
    topCats: document.getElementById('top-categories'),
    recentBids: document.getElementById('recent-bids'),
    highlights: document.getElementById('highlights'),
    rangeTabs: document.getElementById('range-tabs'),
  };
  cachedEls = els;

  if (!isSupabaseConfigured) {
    const msg = '<div class="a-chart-empty">Analytics needs Supabase configured in js/config.js.</div>';
    if (els.chart) els.chart.innerHTML = msg;
    if (els.topCats) els.topCats.innerHTML = msg;
    if (els.recentBids) els.recentBids.innerHTML = msg;
    if (els.highlights) els.highlights.innerHTML = msg;
    return;
  }

  const [listings, categories, activity] = await Promise.all([
    fetchApprovedListings({ limit: 1000 }),
    fetchCategories(),
    fetchActivityFeed({ limit: 500 }),
  ]);

  cachedListings = listings;
  cachedActivity = buildBidEvents(activity, listings);

  const items = listings.map((row) => mapSupabaseListing(row));
  const totalVolume = items.reduce((s, i) => s + i.amountINR, 0);
  const totalClicks = items.reduce((s, i) => s + i.clicks, 0);

  const catRows = categories
    .map((cat) => {
      const inCat = items.filter((i) => i.category === cat.name);
      return {
        cat,
        count: inCat.length,
        volume: inCat.reduce((s, i) => s + i.amountINR, 0),
        clicks: inCat.reduce((s, i) => s + i.clicks, 0),
      };
    })
    .sort((a, b) => b.clicks - a.clicks);

  const activeCats = catRows.filter((r) => r.count > 0).length;

  if (els.kpiListings) els.kpiListings.textContent = items.length.toLocaleString('en-IN');
  if (els.kpiVolume) els.kpiVolume.textContent = INR(totalVolume);
  if (els.kpiClicks) els.kpiClicks.textContent = totalClicks.toLocaleString('en-IN');
  if (els.kpiCategories) els.kpiCategories.textContent = activeCats.toLocaleString('en-IN');

  renderChart(els.chart, cachedActivity, currentRange);
  renderTopCats(els.topCats, catRows);
  renderRecentBids(els.recentBids, cachedActivity);
  renderHighlights(els.highlights, items, catRows);

  if (els.rangeTabs) {
    els.rangeTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      currentRange = Number(btn.dataset.range);
      els.rangeTabs.querySelectorAll('.a-range-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderChart(els.chart, cachedActivity, currentRange);
    });
  }
}

function renderChart(el, activity, rangeDays = 7) {
  if (!el) return;

  const now = new Date();
  const buckets = [];

  if (rangeDays <= 7) {
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      buckets.push({ date: d, label: formatDate(d), sub: formatDay(d), volume: 0, count: 0 });
    }
  } else {
    const weeks = Math.ceil(rangeDays / 7);
    for (let i = weeks - 1; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      end.setHours(23, 59, 59, 999);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      buckets.push({ date: start, end, label: formatDate(start), sub: formatDate(end), volume: 0, count: 0 });
    }
  }

  const rangeStart = new Date(now);
  rangeStart.setDate(rangeStart.getDate() - rangeDays);
  rangeStart.setHours(0, 0, 0, 0);

  let totalVol = 0;
  let totalBids = 0;

  activity.forEach((a) => {
    const ad = new Date(a.created_at);
    if (ad < rangeStart) return;

    if (rangeDays <= 7) {
      const adStr = ad.toDateString();
      const match = buckets.find((b) => b.date.toDateString() === adStr);
      if (match) {
        const v = Math.round((a.amount || 0) / 100);
        match.volume += v;
        match.count++;
        totalVol += v;
        totalBids++;
      }
    } else {
      const match = buckets.find((b) => ad >= b.date && ad <= b.end);
      if (match) {
        const v = Math.round((a.amount || 0) / 100);
        match.volume += v;
        match.count++;
        totalVol += v;
        totalBids++;
      }
    }
  });

  const maxVol = Math.max(1, ...buckets.map((d) => d.volume));
  const periodLabel = rangeDays <= 7 ? 'this week' : rangeDays <= 30 ? 'this month' : 'last 3 months';

  const bars = buckets
    .map((d) => {
      const pct = Math.round((d.volume / maxVol) * 100);
      const hasData = d.volume > 0;
      return `
      <div class="a-bar-col">
        <div class="a-bar-val">${hasData ? INR(d.volume) : ''}</div>
        <div class="a-bar-track">
          <div class="a-bar-fill${hasData ? '' : ' a-bar-fill--empty'}" style="height:${hasData ? pct : 100}%"></div>
        </div>
        <div class="a-bar-date">${d.label}</div>
        <div class="a-bar-day">${d.sub}</div>
      </div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="a-bars">${bars}</div>
    <div class="a-chart-summary">
      <span class="a-chart-stat"><strong>${totalBids}</strong> bid${totalBids === 1 ? '' : 's'} ${periodLabel}</span>
      <span class="a-chart-stat"><strong>${INR(totalVol)}</strong> volume</span>
    </div>`;
}

function renderTopCats(el, catRows) {
  if (!el) return;
  const top = catRows.filter((r) => r.count > 0).slice(0, 5);

  if (top.length === 0) {
    el.innerHTML = '<div class="a-chart-empty">No active categories yet</div>';
    return;
  }

  const maxCl = Math.max(1, ...top.map((r) => r.clicks));

  el.innerHTML = top
    .map(
      (r) => `
    <div class="a-cat-row">
      <div class="a-cat-icon">${r.cat.icon || '🏷️'}</div>
      <div class="a-cat-body">
        <span class="a-cat-name">${r.cat.name}</span>
        <div class="a-cat-bar-track">
          <div class="a-cat-bar-fill" style="width:${Math.round((r.clicks / maxCl) * 100)}%"></div>
        </div>
      </div>
      <div class="a-cat-clicks">${r.clicks.toLocaleString('en-IN')} click${r.clicks === 1 ? '' : 's'}</div>
    </div>`
    )
    .join('');
}

function renderRecentBids(el, activity) {
  if (!el) return;

  if (activity.length === 0) {
    el.innerHTML = '<div class="a-chart-empty">No bids placed yet</div>';
    return;
  }

  const sorted = [...activity].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const rows = sorted.slice(0, 6);
  el.innerHTML = `
    <table class="a-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Listing</th>
          <th>Amount</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (a, i) => `
          <tr>
            <td class="col-num">${i + 1}</td>
            <td class="col-listing">${escapeHtml(a.listing_name)}</td>
            <td class="col-amount">${INR(Math.round((a.amount || 0) / 100))}</td>
            <td class="col-time">${shortTimeAgo(a.created_at)}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderHighlights(el, items, catRows) {
  if (!el) return;

  const insights = [];

  const topClickCat = catRows.filter((r) => r.clicks > 0)[0];
  if (topClickCat) {
    const totalCl = items.reduce((s, i) => s + i.clicks, 0);
    const pct = totalCl > 0 ? Math.round((topClickCat.clicks / totalCl) * 100) : 0;
    insights.push({
      icon: topClickCat.cat.icon || '📊',
      title: `${topClickCat.cat.name} is your top performer`,
      desc: `This category brought in ${pct}% of total clicks. Consider increasing your bid to maintain the lead.`,
    });
  }

  const topListing = [...items].sort((a, b) => b.amountINR - a.amountINR)[0];
  if (topListing) {
    insights.push({
      icon: '🏆',
      title: `${topListing.title} holds the #1 spot`,
      desc: `Leading the board with ${INR(topListing.amountINR)} in total bids placed.`,
    });
  }

  const topVolCat = [...catRows].sort((a, b) => b.volume - a.volume).filter((r) => r.count > 0)[0];
  if (topVolCat && topClickCat && topVolCat.cat.slug !== topClickCat.cat.slug) {
    insights.push({
      icon: '💰',
      title: `Highest spend in ${topVolCat.cat.name}`,
      desc: `${INR(topVolCat.volume)} total volume across ${topVolCat.count} listing${topVolCat.count === 1 ? '' : 's'}.`,
    });
  }

  const mostCompetitive = [...catRows].sort((a, b) => b.count - a.count).filter((r) => r.count > 1)[0];
  if (mostCompetitive) {
    insights.push({
      icon: '🔥',
      title: `${mostCompetitive.cat.name} is most competitive`,
      desc: `${mostCompetitive.count} listings competing for rank in this category.`,
    });
  }

  if (insights.length === 0) {
    el.innerHTML = '<div class="a-chart-empty">Insights will appear once listings are live.</div>';
    return;
  }

  el.innerHTML = insights
    .slice(0, 3)
    .map(
      (h) => `
    <div class="a-insight">
      <div class="a-insight-icon">${h.icon}</div>
      <div class="a-insight-body">
        <div class="a-insight-title">${h.title}</div>
        <div class="a-insight-desc">${h.desc}</div>
      </div>
      <div class="a-insight-arrow">→</div>
    </div>`
    )
    .join('');
}

render();
