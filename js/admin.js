/* js/admin.js — admin dashboard runtime.
   The password gate is a UX layer only; every /api/admin/* endpoint re-checks the
   signed cookie server-side, so nobody can bypass it by pushing the gate out of
   the DOM. Fetches once at load, again on demand (Refresh button / R key), and
   subscribes to Supabase presence so the "viewing right now" tile stays accurate
   without polling. */

import { subscribeToPresence } from './supabase-client.js';

const $ = (id) => document.getElementById(id);

/* ---------- Password gate ---------- */

const gate = $('admin-gate');
const shell = $('admin-shell');
const gateForm = $('admin-gate-form');
const gateSubmit = $('admin-gate-submit');
const gateError = $('admin-gate-error');

gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('admin-password').value;
  gateSubmit.disabled = true;
  gateError.hidden = true;
  try {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      gateError.textContent = body?.error || 'Wrong password.';
      gateError.hidden = false;
      return;
    }
    // Auth cookie now set. Reveal the shell and kick off the initial load.
    gate.hidden = true;
    shell.hidden = false;
    await refresh();
    initPresenceTile();
    bindRefresh();
  } finally {
    gateSubmit.disabled = false;
  }
});

// If we already have a valid cookie (browser refresh mid-session), try a data
// fetch immediately and skip the gate on success. Cheaper than a dedicated
// "am I authorized" endpoint.
(async () => {
  try {
    const res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (!res.ok) return; // fall through to the gate
    gate.hidden = true;
    shell.hidden = false;
    applyStats(await res.json());
    initPresenceTile();
    bindRefresh();
  } catch {
    // network / not-configured — leave the gate visible
  }
})();

/* ---------- Data + charts ---------- */

const INR = (paise) => '₹' + Math.round((Number(paise) || 0) / 100).toLocaleString('en-IN');
const INT = (n) => Number(n || 0).toLocaleString('en-IN');
const short = (paise) => {
  const inr = Math.round((Number(paise) || 0) / 100);
  if (inr >= 1e7) return '₹' + (inr / 1e7).toFixed(1) + ' Cr';
  if (inr >= 1e5) return '₹' + (inr / 1e5).toFixed(1) + ' L';
  if (inr >= 1e3) return '₹' + (inr / 1e3).toFixed(1) + 'k';
  return '₹' + inr;
};

const charts = { bids: null, status: null, categories: null };
const ACCENT = '#8B1E2E';
const TICK = '#8C8478';
const GRID = 'rgba(139, 30, 46, 0.08)';

/** Chart.js is loaded with <script defer>, so it may not exist yet when the
    module script runs. Poll briefly for it; on a healthy network it lands within
    a frame or two, and if the CDN is down we give up rather than block forever. */
async function ensureChartJs() {
  if (typeof window.Chart !== 'undefined') return true;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (typeof window.Chart !== 'undefined') return true;
  }
  console.warn('[admin] Chart.js failed to load — charts will be blank.');
  return false;
}

function makeChart(id, config) {
  const canvas = $(id);
  if (!canvas || typeof window.Chart === 'undefined') return null;
  return new window.Chart(canvas, config);
}

async function applyStats(stats) {
  $('admin-generated').textContent = 'Updated ' + new Date(stats.generatedAt).toLocaleTimeString();

  const t = stats.totals || {};
  $('tile-bids').textContent = INT(t.paid_count);
  $('tile-bids-sub').textContent = t.paid_count ? `${INT(t.paid_count)} paid, ledger source` : 'No bids yet';
  $('tile-volume').textContent = INR(t.volume_paise);
  $('tile-listings').textContent = INT(t.listings_count);
  $('tile-listings-sub').innerHTML = stats.pendingCount
    ? `<span class="pending-badge">${INT(stats.pendingCount)} pending payment</span>`
    : 'Nothing pending';

  renderRecentBids(stats.recentBids || []);
  // Charts require Chart.js — if the CDN is unreachable we still show the tiles
  // and recent-bids table rather than an all-or-nothing failure.
  await ensureChartJs();
  renderBidsChart(stats.bidsByDay || []);
  renderStatusChart(stats.listingsByStatus || []);
  renderCategoriesChart(stats.topCategories || []);
}

async function refresh() {
  const res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
  if (!res.ok) return;
  applyStats(await res.json());
}

// Same reason as initPresenceTile: both auth paths call this. Adding the same
// event listeners twice is wasteful (fine) and a global R keybind would fire
// refresh twice (annoying).
let refreshBound = false;
function bindRefresh() {
  if (refreshBound) return;
  refreshBound = true;
  $('admin-refresh')?.addEventListener('click', refresh);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      refresh();
    }
  });
}

/* ---------- Presence tile ---------- */

// Guarded because both auth paths (fresh login and cookie-still-valid) call this.
// A second subscribe on the same channel throws "cannot add callbacks after
// subscribe()" in Supabase Realtime v2. One channel per page, always.
let presenceBound = false;
function initPresenceTile() {
  if (presenceBound) return;
  presenceBound = true;
  subscribeToPresence((count) => {
    // Never below 1: I'm here, at minimum. The main site does the same.
    $('tile-viewing').textContent = INT(count > 0 ? count : 1);
  });
}

/* ---------- Charts ---------- */

function renderBidsChart(rows) {
  const labels = rows.map((r) => {
    // r.day is an ISO date "YYYY-MM-DD"
    const d = new Date(r.day + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  });
  const counts = rows.map((r) => Number(r.paid_count || 0));

  if (charts.bids) charts.bids.destroy();
  charts.bids = makeChart('chart-bids', {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Paid bids',
        data: counts,
        borderColor: ACCENT,
        backgroundColor: 'rgba(139, 30, 46, 0.10)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: ACCENT,
        tension: 0.28,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: TICK, maxTicksLimit: 8, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK, precision: 0 } },
      },
      interaction: { mode: 'index', intersect: false },
    },
  });
}

function renderStatusChart(rows) {
  // Consistent order regardless of what the DB returned.
  const order = ['approved', 'pending', 'rejected', 'removed'];
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count || 0)]));
  const labels = order.map((s) => s[0].toUpperCase() + s.slice(1));
  const data = order.map((s) => byStatus[s] || 0);
  const colors = ['rgba(139, 30, 46, 0.85)', 'rgba(217, 119, 6, 0.85)', 'rgba(107, 114, 128, 0.85)', 'rgba(75, 85, 99, 0.85)'];

  if (charts.status) charts.status.destroy();
  charts.status = makeChart('chart-status', {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#FAF6EF', borderWidth: 2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#1A1A1A', boxWidth: 10, boxHeight: 10, font: { size: 11 } } },
      },
    },
  });
}

function renderCategoriesChart(rows) {
  const labels = rows.map((r) => r.category_name || 'Uncategorized');
  const data = rows.map((r) => Math.round((Number(r.volume_paise) || 0) / 100));

  if (charts.categories) charts.categories.destroy();
  charts.categories = makeChart('chart-categories', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Volume (₹)',
        data,
        backgroundColor: 'rgba(139, 30, 46, 0.75)',
        borderRadius: 6,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => '₹' + Number(ctx.parsed.x || 0).toLocaleString('en-IN') } },
      },
      scales: {
        x: { beginAtZero: true, grid: { color: GRID }, ticks: { color: TICK, callback: (v) => short(v * 100) } },
        y: { grid: { display: false }, ticks: { color: '#1A1A1A' } },
      },
    },
  });
}

/* ---------- Recent bids ---------- */

function renderRecentBids(rows) {
  const box = $('admin-recent');
  if (!rows.length) {
    box.innerHTML = `<div class="recent-empty">No paid bids yet.</div>`;
    return;
  }
  box.innerHTML = rows.map((r) => {
    const name = escapeHtml(r.listings?.name || 'Deleted listing');
    const when = shortTimeAgo(r.created_at);
    return `
      <div class="recent-row">
        <div class="recent-name" title="${name}">${name}</div>
        <div class="recent-amount">${INR(r.amount)}</div>
        <div class="recent-time">${when}</div>
      </div>
    `;
  }).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shortTimeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
